/**
 * The wall plan: which video each screen plays, when it comes alive, which screens are dead.
 * THIS IS THE SHARED SOURCE OF TRUTH — the panel preview simulates it and the AE build bakes the
 * same numbers into expressions, so what you see in the panel is what After Effects does.
 */
import type { Config, GridSpec, ScreenSpec } from './types'
import { gridFor } from './grid'
import { mulberry32, shuffled } from './rng'

/** 0..1 "how early does this screen turn on" before jitter/normalization, per reveal mode. */
function orderValue(mode: Config['reveal'], row: number, col: number, rows: number, cols: number, rng: () => number): number {
  const n = rows * cols
  const tie = (row * cols + col) / n * 0.001 // stable tiebreak inside a row/column band
  switch (mode) {
    case 'none': return 0
    case 'random': return rng()
    case 'rows': return row / Math.max(1, rows - 1 || 1) + tie
    case 'cols': return col / Math.max(1, cols - 1 || 1) + tie
    case 'scanline': return (row * cols + col) / n
    case 'center': {
      const dx = (col - (cols - 1) / 2) / Math.max(1, cols / 2)
      const dy = (row - (rows - 1) / 2) / Math.max(1, rows / 2)
      return Math.sqrt(dx * dx + dy * dy) / Math.SQRT2 + tie
    }
    case 'edges': {
      const dx = (col - (cols - 1) / 2) / Math.max(1, cols / 2)
      const dy = (row - (rows - 1) / 2) / Math.max(1, rows / 2)
      return 1 - Math.sqrt(dx * dx + dy * dy) / Math.SQRT2 + tie
    }
    case 'diagonal': return (row + col) / Math.max(1, rows + cols - 2) + tie
  }
}

/** Plan every screen. Deterministic from cfg.seed; each concern gets its own RNG stream so e.g. re-seeding the order keeps the video assignment readable. */
export function planScreens(cfg: Config, grid?: GridSpec): ScreenSpec[] {
  const g = grid ?? gridFor(cfg)
  const n = g.rows * g.cols
  const nv = Math.max(1, cfg.videos.length)
  const rngAssign = mulberry32(cfg.seed * 4 + 1)
  const rngOrder = mulberry32(cfg.seed * 4 + 2)
  const rngDead = mulberry32(cfg.seed * 4 + 3)
  const rngOffset = mulberry32(cfg.seed * 4 + 4)

  // video per screen
  let vids: number[]
  if (cfg.assign === 'shuffle') {
    const pool: number[] = []
    while (pool.length < n) for (let v = 0; v < nv && pool.length < n; v++) pool.push(v)
    vids = shuffled(pool, rngAssign)
  } else if (cfg.assign === 'random') {
    vids = Array.from({ length: n }, () => Math.floor(rngAssign() * nv))
  } else {
    vids = Array.from({ length: n }, (_, i) => i % nv)
  }

  // reveal order → evenly spread thresholds (one screen at a time when the mode is 'random' etc.)
  const base = Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / g.cols)
    const col = i % g.cols
    const v = orderValue(cfg.reveal, row, col, g.rows, g.cols, rngOrder)
    return cfg.reveal === 'none' ? 0 : v + (rngOrder() - 0.5) * 2 * cfg.jitter
  })
  const ranked = base.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i)
  const th = new Array<number>(n)
  for (let r = 0; r < n; r++) th[ranked[r].i] = cfg.reveal === 'none' ? 0 : ((r + 0.5) / n) * 100

  return Array.from({ length: n }, (_, i) => ({
    i,
    row: Math.floor(i / g.cols),
    col: i % g.cols,
    v: vids[i],
    th: Math.round(th[i] * 100) / 100,
    dead: Math.round(rngDead() * 10000) / 10000,
    offset: Math.round((cfg.randomStart ? rngOffset() * 0.95 : 0) * 10000) / 10000,
  }))
}

export interface ScreenState {
  /** 0..1 content opacity */
  opacity: number
  /** 1 = full size (pop animation scales up from 0) */
  scale: number
}

/**
 * The state of one screen at time t (seconds) — mirrors the expressions the AE build writes.
 * Flicker uses a per-frame hash so the preview looks like AE's seedRandom without promising bit-parity.
 */
export function screenStateAt(t: number, s: ScreenSpec, cfg: Config): ScreenState {
  if (s.dead * 100 < cfg.deadPct) return { opacity: 0, scale: 1 }
  const onTime = cfg.revealStart + (s.th / 100) * cfg.revealDuration
  const dt = t - onTime
  const dur = Math.max(1, cfg.screenAnimFrames) / cfg.fps
  if (dt < 0) return { opacity: 0, scale: cfg.screenAnim === 'pop' ? 0 : 1 }
  const p = Math.min(1, dt / dur)
  switch (cfg.screenAnim) {
    case 'cut': return { opacity: 1, scale: 1 }
    case 'fade': return { opacity: p, scale: 1 }
    case 'pop': {
      const c1 = 1.70158
      const c3 = c1 + 1
      const e = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
      return { opacity: 1, scale: Math.max(0, e) }
    }
    case 'flicker': {
      if (p >= 1) return { opacity: 1, scale: 1 }
      const frame = Math.floor(dt * cfg.fps)
      const h = hash01(s.i * 971 + frame * 7919)
      const on = h < 0.25 + 0.75 * p * p
      return { opacity: on ? 0.55 + 0.45 * hash01(s.i * 131 + frame * 37) : 0, scale: 1 }
    }
  }
}

function hash01(x: number): number {
  let h = x | 0
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
