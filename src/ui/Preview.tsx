/**
 * Live wall preview: draws the planned grid on a canvas and plays the reveal using the exact same
 * math (`planScreens` / `screenStateAt`) the AE build bakes into expressions. Inside the panel it
 * also pulls one real frame per video (file:// access is enabled for CEP) as screen thumbnails.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Config } from '../core/types'
import { gridFor, cellCenter } from '../core/grid'
import { planScreens, screenStateAt } from '../core/reveal'
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

export function Preview({ cfg }: { cfg: Config }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [, setVersion] = useState(0)
  const grid = useMemo(() => gridFor(cfg), [cfg])
  const screens = useMemo(() => planScreens(cfg, grid), [cfg, grid])

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
    const maxW = 1280
    const scale = Math.min(1, maxW / cfg.compW)
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
    const cx0 = W / 2
    const cy0 = H / 2
    const radius = Math.min(cfg.cornerRadius * scale, cw / 2, ch / 2)
    const showLabels = cfg.labels && cw >= 42 && ch >= 26
    for (const s of screens) {
      const st = screenStateAt(t, s, cfg)
      const { x, y } = cellCenter(s.row, s.col, grid, cfg.gap)
      const px = cx0 + x * scale
      const py = cy0 + y * scale
      // faint dark panel where the screen is off ('static' hints at noise)
      if (st.opacity <= 0.01 || st.scale <= 0.01) {
        if (cfg.background === 'static') {
          ctx.fillStyle = 'rgba(128,128,128,' + (0.006 * cfg.staticBrightness).toFixed(3) + ')'
          rr(ctx, px - cw / 2, py - ch / 2, cw, ch, radius)
          ctx.fill()
        }
        continue
      }
      const sc = st.scale
      const w = cw * sc
      const h = ch * sc
      ctx.save()
      ctx.globalAlpha = st.opacity
      rr(ctx, px - w / 2, py - h / 2, w, h, radius * sc)
      ctx.clip()
      const thumb = thumbs.get(cfg.videos[s.v % Math.max(1, cfg.videos.length)] ?? '')
      if (thumb && typeof thumb !== 'string') {
        // same cover/contain/stretch math as the build
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
        const hue = hashHue(cfg.videos[s.v % Math.max(1, cfg.videos.length)] ?? String(s.v))
        const g = ctx.createLinearGradient(px - w / 2, py - h / 2, px + w / 2, py + h / 2)
        g.addColorStop(0, `hsl(${hue} 42% 38%)`)
        g.addColorStop(1, `hsl(${(hue + 40) % 360} 45% 22%)`)
        ctx.fillStyle = g
        ctx.fillRect(px - w / 2, py - h / 2, w, h)
      }
      if (showLabels) {
        ctx.fillStyle = 'rgba(255,255,255,.85)'
        ctx.font = `${Math.max(8, Math.round(ch * 0.13))}px ui-monospace, Menlo, monospace`
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${cfg.labelPrefix || 'CAM'} ${String(s.i + 1).padStart(String(screens.length).length > 2 ? String(screens.length).length : 2, '0')}`, px - w / 2 + ch * 0.07, py + h / 2 - ch * 0.05)
      }
      ctx.restore()
    }
  }, [cfg, grid, screens, t])

  const loaded = cfg.videos.filter((p) => {
    const th = thumbs.get(p)
    return th && typeof th !== 'string'
  }).length

  return (
    <>
      <div className="preview-wrap">
        <div className={'preview-stage' + (cfg.background === 'transparent' ? ' checker' : '')}>
          <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto' }} />
        </div>
        <div className="preview-meta">
          {grid.rows}×{grid.cols} · {grid.rows * grid.cols} screens · {Math.round(grid.cellW)}×{Math.round(grid.cellH)} px cells
          {cfg.videos.length > 0 && isCEP() ? ` · ${loaded}/${Math.min(cfg.videos.length, 200)} thumbnails` : ''}
        </div>
      </div>
      <div className="transport">
        <button type="button" className={'icon' + (playing ? '' : ' primary')} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
          {playing ? '❚❚' : '▶'}
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
  else ctx.roundRect(x, y, w, h, r)
}
