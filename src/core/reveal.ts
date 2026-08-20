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

/** The config the wall actually runs with: animation off = every screen simply on from frame 1. */
export function withAnimation(cfg: Config): Config {
  return cfg.animate ? cfg : { ...cfg, reveal: 'none', revealStart: 0, revealDuration: 0, screenAnim: 'cut' }
}

/** Plan every screen. Deterministic from cfg.seed; each concern gets its own RNG stream so e.g. re-seeding the order keeps the video assignment readable. */
export function planScreens(cfg: Config, grid?: GridSpec): ScreenSpec[] {
  const g = grid ?? gridFor(cfg)
  const rngAssign = mulberry32(cfg.seed * 4 + 1)
  const rngOrder = mulberry32(cfg.seed * 4 + 2)
  const rngDead = mulberry32(cfg.seed * 4 + 3)
  const rngOffset = mulberry32(cfg.seed * 4 + 4)
  const rngHero = mulberry32(cfg.seed * 4 + 5)

  // multi-cell screens occupy blocks of the slot grid; everything else is one slot each.
  // The featured screen (if any) reserves the centermost block FIRST, then heroes scatter.
  const occupied = new Uint8Array(g.rows * g.cols)
  const spanAt = new Map<number, { span: number; featured: boolean }>()
  const reserve = (row: number, col: number, span: number, featured: boolean): boolean => {
    if (row < 0 || col < 0 || row + span > g.rows || col + span > g.cols) return false
    for (let r = row; r < row + span; r++) for (let c = col; c < col + span; c++) if (occupied[r * g.cols + c]) return false
    for (let r = row; r < row + span; r++) for (let c = col; c < col + span; c++) occupied[r * g.cols + c] = 1
    spanAt.set(row * g.cols + col, { span, featured })
    return true
  }
  const nvAll = cfg.videos.length + cfg.comps.length
  const wantFeatured = cfg.featured >= 0 && nvAll > 0
  if (wantFeatured) {
    const span = cfg.featuredSpan >= 2 && g.rows >= 2 && g.cols >= 2 ? 2 : 1
    const placed = reserve(Math.floor((g.rows - span) / 2), Math.floor((g.cols - span) / 2), span, true)
    if (!placed) reserve(Math.floor((g.rows - 1) / 2), Math.floor((g.cols - 1) / 2), 1, true)
  }
  const wantHeroes = g.rows >= 2 && g.cols >= 2 ? Math.min(cfg.heroes, Math.floor((g.rows * g.cols) / 4)) : 0
  let placedHeroes = 0
  for (let attempt = 0; attempt < 400 && placedHeroes < wantHeroes; attempt++) {
    if (reserve(Math.floor(rngHero() * (g.rows - 1)), Math.floor(rngHero() * (g.cols - 1)), 2, false)) placedHeroes++
  }

  // one screen per reserved block + one per remaining free slot, in reading order
  const slots: { row: number; col: number; span: number; featured: boolean }[] = []
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const k = r * g.cols + c
      const block = spanAt.get(k)
      if (block) slots.push({ row: r, col: c, span: block.span, featured: block.featured })
      else if (!occupied[k]) slots.push({ row: r, col: c, span: 1, featured: false })
    }
  const n = slots.length
  const nv = Math.max(1, cfg.videos.length + cfg.comps.length)

  // video per screen. The featured source is pinned to its own screen — keep it OUT of the
  // general rotation (unless it is the only source), so "my video, centered" stays unique.
  const featuredIdx = wantFeatured ? Math.min(cfg.featured, nvAll - 1) : -1
  const pool: number[] = []
  for (let v = 0; v < nv; v++) if (v !== featuredIdx || nv === 1) pool.push(v)
  const np = pool.length
  let vids: number[]
  if (cfg.assign === 'shuffle') {
    const rep: number[] = []
    while (rep.length < n) for (let v = 0; v < np && rep.length < n; v++) rep.push(pool[v])
    vids = shuffled(rep, rngAssign)
  } else if (cfg.assign === 'random') {
    vids = Array.from({ length: n }, () => pool[Math.floor(rngAssign() * np)])
  } else {
    vids = Array.from({ length: n }, (_, i) => pool[i % np])
  }

  // reveal order → evenly spread thresholds (one screen at a time when the mode is 'random' etc.)
  const base = slots.map((slot) => {
    const v = orderValue(cfg.reveal, slot.row, slot.col, g.rows, g.cols, rngOrder)
    return cfg.reveal === 'none' ? 0 : v + (rngOrder() - 0.5) * 2 * cfg.jitter
  })
  const ranked = base.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i)
  const th = new Array<number>(n)
  for (let r = 0; r < n; r++) th[ranked[r].i] = cfg.reveal === 'none' ? 0 : ((r + 0.5) / n) * 100

  const featuredSrc = featuredIdx
  return slots.map((slot, i) => {
    const dead = Math.round(rngDead() * 10000) / 10000
    const offset = Math.round((cfg.randomStart ? rngOffset() * 0.95 : 0) * 10000) / 10000
    if (slot.featured) {
      // pinned: plays the chosen source from its start, on from the first moment, can't be dead
      return { i, row: slot.row, col: slot.col, v: featuredSrc, th: 0, dead: 1, offset: 0, span: slot.span, featured: true }
    }
    return { i, row: slot.row, col: slot.col, v: vids[i], th: Math.round(th[i] * 100) / 100, dead, offset, span: slot.span }
  })
}

// ---------------------------------------------------------------- camera

export interface CameraPlan {
  /** index (into the screens array) of the screen the camera starts on / returns to */
  target: number
  /** the target screen's center offset from the wall center, px */
  p: [number, number]
  /** Controls-null scale (%) at which the target screen fills the comp */
  scale: number
  /** zoomed from 0 until `hold`, fully home at `end` — ABSOLUTE seconds, already clamped to the comp */
  intro: { hold: number; end: number } | null
  /** home until `start`, fully zoomed at `end` (stays zoomed after) — absolute, clamped past the intro */
  outro: { start: number; end: number } | null
}

/** The camera move (if any): which screen it locks onto and how far in it must be to fill the comp. */
export function planCamera(cfg: Config, grid: GridSpec, screens: ScreenSpec[]): CameraPlan | null {
  if (cfg.intro === 'none' && cfg.outro === 'none') return null
  if (!screens.length) return null
  // the featured screen, else the one closest to the wall center
  let target = screens.findIndex((s) => s.featured)
  if (target < 0) {
    let bestD = Infinity
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i]
      const x = (s.col + (s.span - 1) / 2 - (grid.cols - 1) / 2) * (grid.cellW + cfg.gap)
      const y = (s.row + (s.span - 1) / 2 - (grid.rows - 1) / 2) * (grid.cellH + cfg.gap)
      const d = x * x + y * y - s.span * 0.5 // prefer bigger screens on ties
      if (d < bestD) {
        bestD = d
        target = i
      }
    }
  }
  const t = screens[target]
  const w = grid.cellW * t.span + cfg.gap * (t.span - 1)
  const h = grid.cellH * t.span + cfg.gap * (t.span - 1)
  // clamp both moves to the comp HERE, once — the host writes keyframes and the preview plays
  // from these same absolute times, so they cannot disagree on degenerate configs
  const D = cfg.durationSec
  let intro: CameraPlan['intro'] = null
  let introEnd = 0
  if (cfg.intro === 'zoomOut') {
    const hold = Math.min(Math.max(0, cfg.introHold), Math.max(0, D - 0.2))
    const end = Math.min(hold + Math.max(0.1, cfg.introDur), D)
    intro = { hold: r2(hold), end: r2(end) }
    introEnd = end
  }
  let outro: CameraPlan['outro'] = null
  if (cfg.outro === 'zoomIn') {
    const end = Math.min(Math.max(introEnd + 0.2, D - Math.max(0, cfg.outroHold)), D)
    const start = Math.max(introEnd + 0.1, end - Math.max(0.1, cfg.outroDur))
    if (start < D) outro = { start: r2(start), end: r2(end) }
  }
  if (!intro && !outro) return null
  return {
    target,
    p: [
      Math.round(((t.col + (t.span - 1) / 2 - (grid.cols - 1) / 2) * (grid.cellW + cfg.gap)) * 100) / 100,
      Math.round(((t.row + (t.span - 1) / 2 - (grid.rows - 1) / 2) * (grid.cellH + cfg.gap)) * 100) / 100,
    ],
    scale: Math.round(Math.max(cfg.compW / w, cfg.compH / h) * 100.2 * 100) / 100,
    intro,
    outro,
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100

export interface CameraState {
  /** 1 = neutral */
  k: number
  /** where the wall center sits, relative to the comp center, comp px */
  x: number
  y: number
}

/** The camera at time t — mirrors the eased keyframes the build writes on the Controls null. */
export function cameraAt(t: number, cam: CameraPlan | null, durationSec: number): CameraState {
  if (!cam) return { k: 1, x: 0, y: 0 }
  const kIn = cam.scale / 100
  const zoomed = { k: kIn, x: -kIn * cam.p[0], y: -kIn * cam.p[1] }
  const mix = (u: number): CameraState => {
    const e = u * u * (3 - 2 * u) // approximates the easy-eased keyframes
    return { k: kIn + (1 - kIn) * e, x: zoomed.x * (1 - e), y: zoomed.y * (1 - e) }
  }
  void durationSec
  if (cam.intro) {
    if (t <= cam.intro.hold) return zoomed
    if (t < cam.intro.end) return mix((t - cam.intro.hold) / Math.max(0.001, cam.intro.end - cam.intro.hold))
  }
  if (cam.outro) {
    if (t >= cam.outro.end) return zoomed
    if (t > cam.outro.start) return mix(1 - (t - cam.outro.start) / Math.max(0.001, cam.outro.end - cam.outro.start))
  }
  return { k: 1, x: 0, y: 0 }
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
  if (s.featured) return { opacity: 1, scale: 1 } // pinned means PINNED: no reveal gate, no dropouts
  if (s.dead * 100 < cfg.deadPct) return { opacity: 0, scale: 1 }
  const onTime = cfg.revealStart + (s.th / 100) * cfg.revealDuration
  const dt = t - onTime
  const dur = Math.max(1, cfg.screenAnimFrames) / cfg.fps
  if (dt < 0) return { opacity: 0, scale: cfg.screenAnim === 'pop' ? 0 : 1 }
  const p = Math.min(1, dt / dur)
  let state: ScreenState
  switch (cfg.screenAnim) {
    case 'cut': state = { opacity: 1, scale: 1 }; break
    case 'fade': state = { opacity: p, scale: 1 }; break
    case 'pop': {
      const c1 = 1.70158
      const c3 = c1 + 1
      const e = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
      state = { opacity: 1, scale: Math.max(0, e) }
      break
    }
    case 'flicker': {
      if (p >= 1) {
        state = { opacity: 1, scale: 1 }
        break
      }
      const frame = Math.floor(dt * cfg.fps)
      const h = hash01(s.i * 971 + frame * 7919)
      const on = h < 0.25 + 0.75 * p * p
      state = { opacity: on ? 0.55 + 0.45 * hash01(s.i * 131 + frame * 37) : 0, scale: 1 }
      break
    }
  }
  // signal dropouts: a running screen occasionally blacks out for a beat (mirrors the AE expression)
  if (cfg.dropouts > 0 && state.opacity >= 1) {
    const blk = Math.floor(t)
    const r1 = hash01(s.i * 577 + blk * 131)
    if (r1 < (cfg.dropouts / 100) * 0.6) {
      const bs = blk + hash01(s.i * 733 + blk * 17) * 0.8
      const bl = 0.06 + hash01(s.i * 389 + blk * 53) * 0.18
      if (t >= bs && t <= bs + bl) state = { ...state, opacity: 0 }
    }
  }
  return state
}

function hash01(x: number): number {
  let h = x | 0
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
