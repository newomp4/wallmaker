/**
 * Live wall preview: draws the planned grid on a canvas and plays the reveal using the exact same
 * math (`planScreens` / `screenStateAt`) the AE build bakes into expressions. Inside the panel it
 * also pulls one real frame per video (file:// access is enabled for CEP) as screen thumbnails.
 * With the Focus spotlight on, moving the mouse over the preview plays the Focus null.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Config } from '../core/types'
import { gridFor } from '../core/grid'
import { planScreens, screenStateAt, withAnimation } from '../core/reveal'
import { isCEP } from '../ae/cep'

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
    video.src = 'file://' + encodeURI(path).replace(/#/g, '%23')
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

function smoothstep(k: number): number {
  const c = Math.max(0, Math.min(1, k))
  return c * c * (3 - 2 * c)
}

export function Preview({ cfg: rawCfg }: { cfg: Config }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouse = useRef<{ x: number; y: number } | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [, setVersion] = useState(0)
  const cfg = useMemo(() => withAnimation(rawCfg), [rawCfg])
  const grid = useMemo(() => gridFor(cfg), [cfg])
  const screens = useMemo(() => planScreens(cfg, grid), [cfg, grid])
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

  // focus hover needs continuous redraws even when paused
  const [hoverTick, setHoverTick] = useState(0)

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
    if (cfg.background !== 'transparent') {
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(cfg.bgColor) ? cfg.bgColor : '#0a0a0c'
      ctx.fillRect(0, 0, W, H)
    }
    const cw = grid.cellW * scale
    const ch = grid.cellH * scale
    const gap = cfg.gap * scale
    const cx0 = W / 2
    const cy0 = H / 2
    const baseRadius = cfg.cornerRadius * scale
    const focus = cfg.focus && mouse.current ? mouse.current : null

    // borders sit under the screens: visible in gaps and where screens are off
    if (cfg.borders && cw > 7 && ch > 7) {
      ctx.strokeStyle = /^#[0-9a-f]{6}$/i.test(cfg.borderColor) ? cfg.borderColor : '#2a2a30'
      ctx.lineWidth = Math.max(0.75, cfg.borderWidth * scale)
      for (const s of screens) {
        const w = cw * s.span + gap * (s.span - 1)
        const h = ch * s.span + gap * (s.span - 1)
        const px = cx0 + (s.col + (s.span - 1) / 2 - (grid.cols - 1) / 2) * (cw + gap)
        const py = cy0 + (s.row + (s.span - 1) / 2 - (grid.rows - 1) / 2) * (ch + gap)
        rr(ctx, px - w / 2, py - h / 2, w, h, Math.min(baseRadius, w / 2, h / 2))
        ctx.stroke()
      }
    }

    const showLabels = cfg.labels && cw >= 42 && ch >= 26
    const pad = (n: number) => String(n).padStart(String(screens.length).length > 2 ? String(screens.length).length : 2, '0')
    for (const s of screens) {
      const st = screenStateAt(t, s, cfg)
      const w0 = cw * s.span + gap * (s.span - 1)
      const h0 = ch * s.span + gap * (s.span - 1)
      const px = cx0 + (s.col + (s.span - 1) / 2 - (grid.cols - 1) / 2) * (cw + gap)
      const py = cy0 + (s.row + (s.span - 1) / 2 - (grid.rows - 1) / 2) * (ch + gap)
      let opacity = st.opacity
      let sc = st.scale
      if (focus) {
        const dd = Math.hypot(px - focus.x, py - focus.y)
        const k = smoothstep(1 - dd / Math.max(1, cfg.focusRadius * scale))
        sc *= 1 + (cfg.focusZoom / 100 - 1) * k
        opacity *= 1 - Math.min(1, cfg.focusDim / 100) * (1 - k)
      }
      if (opacity <= 0.01 || sc <= 0.01) {
        if (cfg.background === 'static') {
          ctx.fillStyle = 'rgba(128,128,128,' + (0.006 * cfg.staticBrightness).toFixed(3) + ')'
          rr(ctx, px - w0 / 2, py - h0 / 2, w0, h0, Math.min(baseRadius, w0 / 2, h0 / 2))
          ctx.fill()
        }
        continue
      }
      const w = w0 * sc
      const h = h0 * sc
      const radius = Math.min(baseRadius * sc, w / 2, h / 2)
      ctx.save()
      ctx.globalAlpha = Math.min(1, opacity)
      rr(ctx, px - w / 2, py - h / 2, w, h, radius)
      ctx.clip()
      const isComp = s.v >= cfg.videos.length
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
      if (showLabels) {
        ctx.fillStyle = 'rgba(255,255,255,.85)'
        ctx.font = `${Math.max(8, Math.round(ch * 0.13))}px ui-monospace, Menlo, monospace`
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${cfg.labelPrefix || 'CAM'} ${pad(s.i + 1)}`, px - w / 2 + ch * 0.07, py + h / 2 - ch * 0.05)
      }
      ctx.restore()
    }

    // scanlines across the whole wall
    if (cfg.scanlines && cfg.scanStrength > 0) {
      const wallW = grid.wallW * scale
      const wallH = grid.wallH * scale
      ctx.save()
      ctx.globalAlpha = (cfg.scanStrength / 100) * 0.55
      ctx.fillStyle = '#000'
      const step = Math.max(2, 3 * scale)
      for (let y = cy0 - wallH / 2; y < cy0 + wallH / 2; y += step * 2) {
        ctx.fillRect(cx0 - wallW / 2, y, wallW, step)
      }
      ctx.restore()
    }
  }, [cfg, grid, screens, t, hoverTick])

  const loaded = cfg.videos.filter((p) => {
    const th = thumbs.get(p)
    return th && typeof th !== 'string'
  }).length

  const replay = () => {
    setT(0)
    setPlaying(true)
  }

  return (
    <>
      <div className="preview-wrap">
        <div className={'preview-stage' + (cfg.background === 'transparent' ? ' checker' : '')}>
          <canvas
            ref={canvasRef}
            style={{ maxWidth: '100%', height: 'auto', cursor: cfg.focus ? 'crosshair' : 'default' }}
            onMouseMove={(e) => {
              if (!cfg.focus) return
              const r = e.currentTarget.getBoundingClientRect()
              const kx = e.currentTarget.width / r.width
              mouse.current = { x: (e.clientX - r.left) * kx, y: (e.clientY - r.top) * kx }
              if (!playing) setHoverTick((v) => v + 1)
            }}
            onMouseLeave={() => {
              mouse.current = null
              if (!playing) setHoverTick((v) => v + 1)
            }}
          />
        </div>
        <div className="preview-meta">
          {grid.rows}×{grid.cols} · {screens.length} screens · {Math.round(grid.cellW)}×{Math.round(grid.cellH)} px cells
          {sourceCount > 0 ? ` · ${sourceCount} source${sourceCount === 1 ? '' : 's'}` : ''}
          {cfg.videos.length > 0 && isCEP() ? ` · ${loaded}/${Math.min(cfg.videos.length, 200)} thumbnails` : ''}
          {cfg.focus ? ' · move the mouse over the wall to play the Focus null' : ''}
        </div>
      </div>
      <div className="transport">
        <button type="button" className={'icon' + (playing ? '' : ' primary')} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="icon" aria-label="Replay from the start" title="Replay from the start" onClick={replay}>
          ⟲
        </button>
        <input type="range" min={0} max={cfg.durationSec} step={1 / cfg.fps} value={Math.min(t, cfg.durationSec)} onChange={(e) => setT(parseFloat(e.target.value))} />
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
