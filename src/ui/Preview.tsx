/**
 * Live wall preview: draws the planned grid on a canvas and plays the reveal using the exact same
 * math (`planScreens` / `screenStateAt`) the AE build bakes into expressions. Inside the panel it
 * also pulls one real frame per video (file:// access is enabled for CEP) as screen thumbnails.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
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

function hashHue(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 360
}

export function Preview({ cfg: rawCfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const src = useSources(rawCfg, patch)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [t, setT] = useState(0)
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

  // playback clock
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT((cur) => {
        const next = cur + dt
        return next >= cfg.durationSec ? 0 : next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, cfg.durationSec])

  // draw
  useEffect(() => {
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
          if (cfg.fill === 'contain') {
            ctx.fillStyle = '#000'
            ctx.fillRect(px - w / 2, py - h / 2, w, h)
          }
        }
        ctx.drawImage(thumb, px - dw / 2, py - dh / 2, dw, dh)
      } else {
        const hue = hashHue(srcName)
        const g = ctx.createLinearGradient(px - w / 2, py - h / 2, px + w / 2, py + h / 2)
        g.addColorStop(0, `hsl(${hue} ${isComp ? 30 : 42}% ${isComp ? 30 : 38}%)`)
        g.addColorStop(1, `hsl(${(hue + 40) % 360} ${isComp ? 32 : 45}% ${isComp ? 18 : 22}%)`)
        ctx.fillStyle = g
        ctx.fillRect(px - w / 2, py - h / 2, w, h)
        if (isComp && w >= 46 && h >= 24) {
          ctx.fillStyle = 'rgba(255,255,255,.7)'
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
      if (s.featured && w >= 20) {
        const lw = Math.max(2, 3 * scale * cam.k)
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,.92)'
        ctx.lineWidth = lw
        ctx.shadowColor = 'rgba(0,0,0,.6)'
        ctx.shadowBlur = 10 * scale * cam.k
        rr(ctx, px - w / 2 + lw / 2, py - h / 2 + lw / 2, w - lw, h - lw, Math.max(0, radius - lw / 2))
        ctx.stroke()
        ctx.restore()
      }
    }
  }, [cfg, grid, screens, camera, t, thumbVersion])

  const pending = isCEP() ? cfg.videos.slice(0, 200).filter((p) => !thumbs.has(p) || thumbs.get(p) === 'loading').length : 0

  const replay = () => {
    setT(0)
    setPlaying(true)
  }

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
          <canvas ref={canvasRef} />
        </div>
        <div className="preview-meta">
          {grid.rows}×{grid.cols} · {screens.length} screens · {Math.round(grid.cellW)}×{Math.round(grid.cellH)}
          {sourceCount > 0 ? ` · ${sourceCount} source${sourceCount === 1 ? '' : 's'}` : ''}
          {pending > 0 ? ` · loading ${pending}` : ''}
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
        <input type="range" className="timeline" min={0} max={cfg.durationSec} step={1 / cfg.fps} value={Math.min(t, cfg.durationSec)} aria-label="Preview time" onChange={(e) => setT(parseFloat(e.target.value))} />
        <span className="time">
          {t.toFixed(1)} / {cfg.durationSec.toFixed(1)} s
        </span>
      </div>
    </>
  )
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (r <= 0.5) ctx.rect(x, y, w, h)
  else ctx.roundRect(x, y, w, h, Math.max(0, r))
}
