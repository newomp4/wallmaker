/**
 * The wall plan: which video each screen plays, when it comes alive, which screens are dead,
 * and where the camera is pointed.
 * THIS IS THE SHARED SOURCE OF TRUTH — the panel preview simulates it and the AE build bakes the
 * same numbers into expressions and keyframes, so what you see in the panel is what After Effects does.
 */
import type { Config, GridSpec, ScreenSpec } from './types'
import { gridFor, cellOnscreen } from './grid'
import { mulberry32, shuffled } from './rng'

/** 0..1 "how early does this screen turn on" before jitter/normalization, per reveal mode. */
function orderValue(mode: Config['reveal'], row: number, col: number, rows: number, cols: number, rng: () => number): number {
  const n = rows * cols
  const tie = ((row * cols + col) / n) * 0.001 // stable tiebreak inside a row/column band
  switch (mode) {
    case 'none': return 0
    case 'random': return rng()
    case 'rows': return row / Math.max(1, rows - 1 || 1) + tie
    case 'cols': return col / Math.max(1, cols - 1 || 1) + tie
    case 'sequence': return (row * cols + col) / n
    case 'snake': return (row * cols + (row % 2 === 1 ? cols - 1 - col : col)) / n
    case 'spiral': {
      // square rings out from the middle, walking round each ring: 'center' but with a direction
      const dr = row - (rows - 1) / 2
      const dc = col - (cols - 1) / 2
      const ring = Math.max(Math.abs(dr), Math.abs(dc))
      const maxRing = Math.max(0.5, Math.max((rows - 1) / 2, (cols - 1) / 2))
      const ang = (Math.atan2(dr, dc) + Math.PI) / (2 * Math.PI) // 0..1 round the ring
      return (ring + ang) / (maxRing + 1)
    }
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

/** Which cell holds the featured screen (dead center of the grid). */
export function centerCell(grid: GridSpec): { row: number; col: number } {
  return { row: Math.floor((grid.rows - 1) / 2), col: Math.floor((grid.cols - 1) / 2) }
}

/**
 * Plan every screen — one per cell, all the same size.
 * Deterministic from cfg.seed; each concern gets its own RNG stream so e.g. re-seeding the order
 * keeps the video assignment readable.
 */
export function planScreens(cfg: Config, grid?: GridSpec): ScreenSpec[] {
  const g = grid ?? gridFor(cfg)
  const rngAssign = mulberry32(cfg.seed * 4 + 1)
  const rngOrder = mulberry32(cfg.seed * 4 + 2)
  const rngDead = mulberry32(cfg.seed * 4 + 3)
  const rngOffset = mulberry32(cfg.seed * 4 + 4)

  const slots: { row: number; col: number }[] = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) slots.push({ row: r, col: c })
  const n = slots.length
  const nvAll = cfg.videos.length + cfg.comps.length
  const nv = Math.max(1, nvAll)

  // the centered screen, if one is chosen
  const wantFeatured = cfg.featured >= 0 && nvAll > 0
  const ctr = centerCell(g)
  const featuredSlot = wantFeatured ? ctr.row * g.cols + ctr.col : -1
  const featuredIdx = wantFeatured ? Math.min(cfg.featured, nvAll - 1) : -1

  // video per screen. The centered source is pinned to its own screen — keep it OUT of the
  // general rotation (unless it is the only source), so "my video, centered" stays unique.
  const pool: number[] = []
  for (let v = 0; v < nv; v++) if (v !== featuredIdx || nv === 1) pool.push(v)
  const np = pool.length
  let vids: number[]
  if (cfg.assign === 'shuffle') {
    // Whole rounds of the pool (so every source appears an equal number of times, +/-1), dealt onto
    // the cells that are actually IN FRAME first. When the wall bleeds off the comp that means you
    // still see every clip at least once and the cut-off cells are the ones holding the duplicates.
    const onscreen: number[] = []
    const offscreen: number[] = []
    for (let i = 0; i < n; i++) (cellOnscreen(slots[i].row, slots[i].col, cfg, g) ? onscreen : offscreen).push(i)
    const order = shuffled(onscreen, rngAssign).concat(shuffled(offscreen, rngAssign))
    const seq: number[] = []
    while (seq.length < n) {
      const round = shuffled(pool.slice(), rngAssign)
      for (let v = 0; v < round.length && seq.length < n; v++) seq.push(round[v])
    }
    vids = new Array<number>(n)
    for (let k = 0; k < n; k++) vids[order[k]] = seq[k]
  } else if (cfg.assign === 'random') {
    vids = Array.from({ length: n }, () => pool[Math.floor(rngAssign() * np)])
  } else {
    vids = Array.from({ length: n }, (_, i) => pool[i % np])
  }

  // reveal order -> evenly spread thresholds (one screen at a time when the mode is 'random' etc.)
  const base = slots.map((slot) => {
    const v = orderValue(cfg.reveal, slot.row, slot.col, g.rows, g.cols, rngOrder)
    return cfg.reveal === 'none' ? 0 : v + (rngOrder() - 0.5) * 2 * cfg.jitter
  })
  const ranked = base.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i)
  const th = new Array<number>(n)
  for (let r = 0; r < n; r++) th[ranked[r].i] = cfg.reveal === 'none' ? 0 : ((r + 0.5) / n) * 100

  // Start offsets, stratified PER SOURCE: the screens showing a given clip are spread evenly
  // across it (with jitter inside each slice) instead of drawing independently, where two copies
  // could land on the same frame and read as a duplicate.
  const offsets = new Array<number>(n).fill(0)
  if (cfg.randomStart) {
    const bySource = new Map<number, number[]>()
    for (let i = 0; i < n; i++) {
      if (i === featuredSlot) continue // the centered screen always plays from its start
      const list = bySource.get(vids[i])
      if (list) list.push(i)
      else bySource.set(vids[i], [i])
    }
    const keys = Array.from(bySource.keys()).sort((a, b) => a - b)
    for (const v of keys) {
      const idxs = shuffled(bySource.get(v)!, rngOffset)
      for (let k = 0; k < idxs.length; k++) {
        offsets[idxs[k]] = Math.round(((k + 0.15 + 0.7 * rngOffset()) / idxs.length) * 0.95 * 10000) / 10000
      }
    }
  }

  return slots.map((slot, i) => {
    const dead = Math.round(rngDead() * 10000) / 10000
    const offset = offsets[i]
    if (i === featuredSlot) {
      // pinned: plays the chosen source from its start, on from the first moment, can't be dead
      return { i, row: slot.row, col: slot.col, v: featuredIdx, th: 0, dead: 1, offset: 0, featured: true }
    }
    return { i, row: slot.row, col: slot.col, v: vids[i], th: Math.round(th[i] * 100) / 100, dead, offset }
  })
}

// ---------------------------------------------------------------- camera

export interface CameraPlan {
  /** index (into the screens array) of the screen the camera zooms to */
  target: number
  /** that screen's cell, [col, row] — the Target column / Target row sliders in AE */
  cell: [number, number]
  /** the target screen's center offset from the wall center, px (at the built gap) */
  p: [number, number]
  /** camera scale (%) at which the target screen fills the comp */
  scale: number
  /** fully zoomed until `hold`, fully pulled back at `end` — ABSOLUTE seconds, already clamped to the comp */
  intro: { hold: number; end: number } | null
  /** wide until `start`, fully zoomed at `end` (stays zoomed after) — absolute, clamped past the intro */
  outro: { start: number; end: number } | null
}

/**
 * The camera rig. It always exists (the null is always built, so you can animate it by hand);
 * `intro` / `outro` are the automatic moves, and they are the only thing that writes keyframes.
 */
export function planCamera(cfg: Config, grid: GridSpec, screens: ScreenSpec[]): CameraPlan | null {
  if (!screens.length) return null
  // the centered screen, else the one closest to the wall center
  let target = screens.findIndex((s) => s.featured)
  if (target < 0) {
    const ctr = centerCell(grid)
    target = screens.findIndex((s) => s.row === ctr.row && s.col === ctr.col)
    if (target < 0) target = 0
  }
  const t = screens[target]
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
  return {
    target,
    cell: [t.col, t.row],
    p: [r2((t.col - (grid.cols - 1) / 2) * (grid.cellW + cfg.gap)), r2((t.row - (grid.rows - 1) / 2) * (grid.cellH + cfg.gap))],
    scale: Math.round(Math.max(cfg.compW / grid.cellW, cfg.compH / grid.cellH) * 100.2 * 100) / 100,
    intro,
    outro,
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** 0 = the whole wall, 1 = the target screen fills the comp. This is the value AE keyframes. */
export function zoomAt(t: number, cam: CameraPlan | null): number {
  if (!cam) return 0
  const ease = (u: number) => {
    const c = Math.max(0, Math.min(1, u))
    return c * c * (3 - 2 * c) // approximates the easy-eased keyframes AE gets
  }
  if (cam.intro) {
    if (t <= cam.intro.hold) return 1
    if (t < cam.intro.end) return 1 - ease((t - cam.intro.hold) / Math.max(0.001, cam.intro.end - cam.intro.hold))
  }
  if (cam.outro) {
    if (t >= cam.outro.end) return 1
    if (t > cam.outro.start) return ease((t - cam.outro.start) / Math.max(0.001, cam.outro.end - cam.outro.start))
  }
  return 0
}

export interface CameraState {
  /** 1 = neutral */
  k: number
  /** where the wall center sits, relative to the comp center, comp px */
  x: number
  y: number
}

/** The camera at time t — the exact formula the Wallmaker Camera null's expressions evaluate. */
export function cameraAt(t: number, cam: CameraPlan | null, durationSec?: number): CameraState {
  void durationSec
  if (!cam || (!cam.intro && !cam.outro)) return { k: 1, x: 0, y: 0 }
  const z = zoomAt(t, cam)
  const kIn = cam.scale / 100
  return { k: 1 + z * (kIn - 1), x: -z * kIn * cam.p[0], y: -z * kIn * cam.p[1] }
}

export interface ScreenState {
  /** 0..1 content opacity */
  opacity: number
  /** 1 = full size (the pop animation scales up from 0) */
  scale: number
}

/** The state of one screen at time t (seconds) — mirrors the expressions the AE build writes. */
export function screenStateAt(t: number, s: ScreenSpec, cfg: Config): ScreenState {
  if (s.featured) return { opacity: 1, scale: 1 } // centered means PINNED: no reveal gate at all
  if (s.dead * 100 < cfg.deadPct) return { opacity: 0, scale: 1 }
  const onTime = cfg.revealStart + (s.th / 100) * cfg.revealDuration
  const dt = t - onTime
  const dur = Math.max(1, cfg.screenAnimFrames) / cfg.fps
  if (dt < 0) return { opacity: 0, scale: cfg.screenAnim === 'pop' ? 0 : 1 }
  const p = Math.min(1, dt / dur)
  switch (cfg.screenAnim) {
    case 'fade': return { opacity: p, scale: 1 }
    case 'flicker': {
      // a tube warming up: on/off per frame, settling as p approaches 1 (mirrors the AE expression)
      if (p >= 1) return { opacity: 1, scale: 1 }
      const frame = Math.floor(dt * cfg.fps)
      const on = hash01(s.i * 971 + frame * 7919) < 0.25 + 0.75 * p * p
      return { opacity: on ? 0.55 + 0.45 * hash01(s.i * 131 + frame * 37) : 0, scale: 1 }
    }
    case 'pop': {
      const c1 = 1.70158
      const c3 = c1 + 1
      const e = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
      return { opacity: 1, scale: Math.max(0, e) }
    }
    default: return { opacity: 1, scale: 1 }
  }
}

/** Deterministic 0..1 from an integer — the preview's stand-in for AE's seedRandom(n, true). */
function hash01(x: number): number {
  let h = x | 0
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
