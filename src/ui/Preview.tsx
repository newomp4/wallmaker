/**
 * Live wall preview: draws the planned grid on a canvas and plays the reveal using the exact same
 * math (`planScreens` / `screenStateAt`) the AE build bakes into expressions. Inside the panel it
 * also pulls one real frame per video (file:// access is enabled for CEP) as screen thumbnails.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Config } from '../core/types'
import { gridFor } from '../core/grid'
import { planScreens, planCamera, cameraAt, screenStateAt, withAnimation } from '../core/reveal'
import { isCEP } from '../ae/cep'
import { QuickBar } from './QuickBar'
import { useSources } from './useSources'

// ---- thumbnail cache (module-level: survives tab switches) ----
const thumbs = new Map<string, HTMLCanvasElement | 'loading' | 'error'>()
let thumbQueue: string[] = []
let thumbActive = 0
let bumpVersion: (() => void) | null = null

function requestThumb(path: string) {
  if (!isCEP() || thumbs.has(path)) return
  thumbs.set(path, 'loading')
  thumbQueue.push(path)
  pumpThumbs()
}

function pumpThumbs() {
  while (thumbActive < 3 && thumbQueue.length) {
    const path = thumbQueue.shift()!
    thumbActive++
    loadThumb(path).finally(() => {
      thumbActive--
      bumpVersion?.()
      pumpThumbs()
    })
  }
}

function loadThumb(path: string): Promise<void> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    const done = (ok: boolean) => {
      if (ok) {
        const c = document.createElement('canvas')
        const w = Math.min(320, video.videoWidth || 320)
        c.width = Math.max(2, w)
        c.height = Math.max(2, Math.round((w * (video.videoHeight || 180)) / Math.max(1, video.videoWidth || 320)))
        try {
          c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
          thumbs.set(path, c)
        } catch {
          thumbs.set(path, 'error')
        }
      } else thumbs.set(path, 'error')
      video.removeAttribute('src')
      video.load()
      resolve()
    }
    const t = setTimeout(() => done(false), 8000)
    video.onerror = () => {
      clearTimeout(t)
      done(false)
    }
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.4, (video.duration || 1) * 0.1)
    }
    video.onseeked = () => {
      clearTimeout(t)
      done(true)
    }
    video.src = 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
  })
}

/** The two surface tones the panel's own controls use — read from CSS so the preview can never
 *  drift from the palette. Screens with no thumbnail are checkerboarded between them. */
function tiles(): [string, string] {
  const css = getComputedStyle(document.documentElement)
  const a = css.getPropertyValue('--surface').trim() || '#191a1c'
  const b = css.getPropertyValue('--surface2').trim() || '#232428'
  return [a, b]
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function Preview({ cfg: rawCfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const src = useSources(rawCfg, patch)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // playback time lives in a ref, NOT in state: a setState per animation frame re-rendered the whole
  // panel 60x a second, which is what made editing the wall feel laggy. The clock writes straight to
  // the canvas and to the two DOM nodes that show it.
  const tRef = useRef(0)
  const drawRef = useRef<(t: number) => void>(() => {})
  const timeRef = useRef<HTMLSpanElement>(null)
  const scrubRef = useRef<HTMLInputElement>(null)
  const [playing, setPlaying] = useState(true)
  const [thumbVersion, setVersion] = useState(0)
  const cfg = useMemo(() => withAnimation(rawCfg), [rawCfg])
  const grid = useMemo(() => gridFor(cfg), [cfg])
  const screens = useMemo(() => planScreens(cfg, grid), [cfg, grid])
  const camera = useMemo(() => planCamera(cfg, grid, screens), [cfg, grid, screens])
  const sourceCount = cfg.videos.length + cfg.comps.length

  useEffect(() => {
    bumpVersion = () => setVersion((v) => v + 1)
    return () => {
      bumpVersion = null
    }
  }, [])

  // pull thumbnails for the first ~200 distinct videos
  useEffect(() => {
    const seen = new Set<string>()
    for (const p of cfg.videos) {
      if (seen.size >= 200) break
      if (!seen.has(p)) {
        seen.add(p)
        requestThumb(p)
      }
    }
  }, [cfg.videos])

  const showTime = useCallback(
    (t: number) => {
      if (timeRef.current) timeRef.current.textContent = `${t.toFixed(1)} / ${cfg.durationSec.toFixed(1)} s`
      if (scrubRef.current && document.activeElement !== scrubRef.current) scrubRef.current.value = String(t)
    },
    [cfg.durationSec],
  )

  // playback clock
  useEffect(() => {
    showTime(tRef.current)
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000) // a stalled tab must not jump the whole timeline
      last = now
      const next = tRef.current + dt
      tRef.current = next >= cfg.durationSec ? 0 : next
      drawRef.current(tRef.current)
      showTime(tRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, cfg.durationSec, showTime])

  // build the draw function whenever the plan changes, and repaint once with it
  useEffect(() => {
    const draw = (t: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const scale = Math.min(1, 1280 / cfg.compW, 900 / cfg.compH)
      const W = Math.round(cfg.compW * scale)
      const H = Math.round(cfg.compH * scale)
      if (canvas.width !== W) canvas.width = W
      if (canvas.height !== H) canvas.height = H
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, W, H)
      if (cfg.background === 'solid') {
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(cfg.bgColor) ? cfg.bgColor : '#0a0a0c'
        ctx.fillRect(0, 0, W, H)
      }
      // the camera move scales/offsets the whole wall exactly like the null keyframes do in AE
      const cam = cameraAt(t, camera, cfg.durationSec)
      const cw = grid.cellW * scale * cam.k
      const ch = grid.cellH * scale * cam.k
      const gap = cfg.gap * scale * cam.k
      const cx0 = W / 2 + cam.x * scale
      const cy0 = H / 2 + cam.y * scale
      const baseRadius = cfg.cornerRadius * scale * cam.k
      const tone = tiles()
      // the screen the camera locks onto: the pinned one, or whichever cell it would zoom to
      const marked = camera && (camera.intro || camera.outro || screens.some((sc) => sc.featured)) ? camera.target : -1

      for (const s of screens) {
        const st = screenStateAt(t, s, cfg)
        const px = cx0 + (s.col - (grid.cols - 1) / 2) * (cw + gap)
        const py = cy0 + (s.row - (grid.rows - 1) / 2) * (ch + gap)
        const opacity = st.opacity
        const sc = st.scale
        if (opacity <= 0.01 || sc <= 0.01) continue
        const w = cw * sc
        const h = ch * sc
        const radius = Math.min(baseRadius * sc, w / 2, h / 2)
        ctx.save()
        ctx.globalAlpha = Math.min(1, opacity)
        rr(ctx, px - w / 2, py - h / 2, w, h, radius)
        ctx.clip()
        const isComp = s.v >= cfg.videos.length && s.v - cfg.videos.length < cfg.comps.length
        const srcName = isComp ? (cfg.comps[s.v - cfg.videos.length]?.name ?? 'comp') : (cfg.videos[s.v] ?? String(s.v))
        const thumb = isComp ? undefined : thumbs.get(cfg.videos[s.v] ?? '')
        if (thumb && typeof thumb !== 'string') {
          const sw = thumb.width
          const sh = thumb.height
          let dw = w
          let dh = h
          if (cfg.fill !== 'stretch') {
            const k = cfg.fill === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh)
            dw = sw * k
            dh = sh * k
          }
          ctx.drawImage(thumb, px - dw / 2, py - dh / 2, dw, dh)
        } else {
          ctx.fillStyle = tone[(s.row + s.col) % 2]
          ctx.fillRect(px - w / 2, py - h / 2, w, h)
          if (isComp && w >= 46 && h >= 24) {
            ctx.fillStyle = 'rgba(255,255,255,.5)'
            ctx.font = `${Math.max(8, Math.round(Math.min(h * 0.16, 13)))}px -apple-system, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(srcName.slice(0, Math.floor(w / 7)), px, py)
            ctx.textAlign = 'start'
          }
        }
        ctx.restore()
        // the centered screen gets a ring -- drawn OUTSIDE the clip and inset, or half the stroke
        // disappears into the cell edge and the marker is invisible at preview scale
        if ((s.featured || s.i === marked) && w >= 20) {
          // viewfinder ticks rather than a border: they read as a target, and with the crosshair
          // below they make "perfectly centred" something you can SEE before you build anything
          const lw = Math.max(1.5, 2.5 * scale * cam.k)
          const tick = Math.min(w, h) * 0.2
          const x0 = px - w / 2 + lw / 2
          const x1 = px + w / 2 - lw / 2
          const y0 = py - h / 2 + lw / 2
          const y1 = py + h / 2 - lw / 2
          ctx.save()
          ctx.strokeStyle = 'rgba(255,255,255,.95)'
          ctx.lineWidth = lw
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.shadowColor = 'rgba(0,0,0,.65)'
          ctx.shadowBlur = 7 * scale
          ctx.beginPath()
          ctx.moveTo(x0, y0 + tick)
          ctx.lineTo(x0, y0)
          ctx.lineTo(x0 + tick, y0)
          ctx.moveTo(x1 - tick, y0)
          ctx.lineTo(x1, y0)
          ctx.lineTo(x1, y0 + tick)
          ctx.moveTo(x1, y1 - tick)
          ctx.lineTo(x1, y1)
          ctx.lineTo(x1 - tick, y1)
          ctx.moveTo(x0 + tick, y1)
          ctx.lineTo(x0, y1)
          ctx.lineTo(x0, y1 - tick)
          ctx.stroke()
          ctx.restore()
        }
      }

      // the comp's dead centre: if the ticked screen really is centred, this sits in its middle
      if (marked >= 0) {
        const arm = Math.max(7, 11 * scale)
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,.6)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(W / 2 - arm, H / 2)
        ctx.lineTo(W / 2 + arm, H / 2)
        ctx.moveTo(W / 2, H / 2 - arm)
        ctx.lineTo(W / 2, H / 2 + arm)
        ctx.stroke()
        ctx.restore()
      }
    }
    drawRef.current = draw
    draw(tRef.current)
  }, [cfg, grid, screens, camera, thumbVersion])

  const pending = isCEP() ? cfg.videos.slice(0, 200).filter((p) => !thumbs.has(p) || thumbs.get(p) === 'loading').length : 0

  const seek = (t: number) => {
    tRef.current = t
    drawRef.current(t)
    showTime(t)
  }
  const replay = () => {
    seek(0)
    setPlaying(true)
  }

  /** Click a screen on the wall to make its video the centre one (click it again to clear). */
  const pickCenter = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (sourceCount === 0) return
    const canvas = e.currentTarget
    const r = canvas.getBoundingClientRect()
    const x = (e.clientX - r.left) * (canvas.width / Math.max(1, r.width))
    const y = (e.clientY - r.top) * (canvas.height / Math.max(1, r.height))
    const scale = Math.min(1, 1280 / cfg.compW, 900 / cfg.compH)
    const cam = cameraAt(tRef.current, camera, cfg.durationSec)
    const cw = grid.cellW * scale * cam.k
    const ch = grid.cellH * scale * cam.k
    const gp = cfg.gap * scale * cam.k
    const cx0 = Math.round(cfg.compW * scale) / 2 + cam.x * scale
    const cy0 = Math.round(cfg.compH * scale) / 2 + cam.y * scale
    const col = Math.round((x - cx0) / (cw + gp) + (grid.cols - 1) / 2)
    const row = Math.round((y - cy0) / (ch + gp) + (grid.rows - 1) / 2)
    const hit = screens.find((sc) => sc.row === row && sc.col === col)
    if (!hit) return
    const px = cx0 + (col - (grid.cols - 1) / 2) * (cw + gp)
    const py = cy0 + (row - (grid.rows - 1) / 2) * (ch + gp)
    if (Math.abs(x - px) > cw / 2 || Math.abs(y - py) > ch / 2) return // landed in a gap
    patch({ featured: hit.featured ? -1 : hit.v })
  }

  const centerName =
    cfg.featured >= 0
      ? cfg.featured < cfg.videos.length
        ? basename(cfg.videos[cfg.featured])
        : (cfg.comps[cfg.featured - cfg.videos.length]?.name ?? null)
      : null

  return (
    <>
      <div className="preview-wrap">
        {sourceCount === 0 && (
          <div className="stage-empty">
            <h2>{src.inAE ? 'Add videos or comps' : 'Preview only \u2014 open the panel in After Effects'}</h2>
            <div className="btns">
              {src.inAE ? (
                <>
                  <button type="button" className="btn primary" onClick={src.addFolder}>
                    Folder
                  </button>
                  <button type="button" className="btn" onClick={src.addFiles}>
                    Files
                  </button>
                  <button type="button" className="btn" onClick={src.addSelection}>
                    From selection
                  </button>
                </>
              ) : (
                <button type="button" className="btn primary" onClick={src.addSamples}>
                  Use sample clips
                </button>
              )}
            </div>
            {src.error && <p className="hint err">{src.error}</p>}
          </div>
        )}
        <div
          className={'preview-stage' + (cfg.background === 'transparent' ? ' checker' : '') + (sourceCount === 0 ? ' dimmed' : '')}
          style={{ aspectRatio: `${cfg.compW} / ${cfg.compH}` }}
        >
          <canvas
            ref={canvasRef}
            onClick={pickCenter}
            style={{ cursor: sourceCount > 0 ? 'pointer' : 'default' }}
            title={sourceCount > 0 ? 'Click a screen to put its video in the centre' : undefined}
          />
        </div>
        <div className="preview-meta">
          {grid.rows}×{grid.cols} · {screens.length} screens · {Math.round(grid.cellW)}×{Math.round(grid.cellH)}
          {sourceCount > 0 ? ` · ${sourceCount} source${sourceCount === 1 ? '' : 's'}` : ''}
          {pending > 0 ? ` · loading ${pending}` : ''}
          {/* always present, set or not: an absent label is impossible to tell apart from "not shown" */}
          {sourceCount > 0 && <b className={centerName ? 'meta-on' : 'meta-off'}> · center: {centerName || 'none'}</b>}
        </div>
      </div>
      <QuickBar cfg={rawCfg} patch={patch} />
      <div className="transport">
        <button type="button" className={'icon' + (playing ? '' : ' primary')} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
          {playing ? (
            <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden>
              <rect x="1" y="1" width="3.2" height="10" rx="1" fill="currentColor" />
              <rect x="6.8" y="1" width="3.2" height="10" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden>
              <path d="M1.5 1.6c0-.8.9-1.3 1.6-.9l7.2 4.4c.7.4.7 1.4 0 1.8L3.1 11.3c-.7.4-1.6-.1-1.6-.9V1.6Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button type="button" className="icon" aria-label="Replay from the start" title="Replay from the start" onClick={replay}>
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
            <path d="M7 2.2a4.8 4.8 0 1 1-4.55 3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M2 1v3h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          ref={scrubRef}
          type="range"
          className="timeline"
          min={0}
          max={cfg.durationSec}
          step={1 / cfg.fps}
          defaultValue={0}
          aria-label="Preview time"
          onChange={(e) => seek(parseFloat(e.target.value))}
        />
        <span className="time" ref={timeRef} />
      </div>
    </>
  )
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (r <= 0.5) ctx.rect(x, y, w, h)
  else ctx.roundRect(x, y, w, h, Math.max(0, r))
}
