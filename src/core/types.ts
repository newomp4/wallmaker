/** Every Wallmaker setting lives in this one flat object (persisted, shared with the preview and the AE build). */

export type GridMode = 'auto' | 'manual'
export type FillMode = 'cover' | 'contain' | 'stretch'
export type Assign = 'sequential' | 'shuffle' | 'random'
export type Background = 'dark' | 'static' | 'transparent'
export type RevealMode = 'none' | 'random' | 'rows' | 'cols' | 'scanline' | 'center' | 'edges' | 'diagonal'
export type CellAspect = 'fill' | 'wide' | 'tv' | 'square' | 'tall' | 'custom'
export type ScreenAnim = 'cut' | 'fade' | 'flicker' | 'pop'

export interface CompRef {
  /** AE project item id — stable within a project */
  id: number
  name: string
}

export interface Config {
  /** absolute paths of the source videos, in order */
  videos: string[]
  /** comps from the open AE project used as screens (they render live — no export needed) */
  comps: CompRef[]

  // ---- wall / comp ----
  compName: string
  compW: number
  compH: number
  fps: number
  durationSec: number
  gridMode: GridMode
  rows: number
  cols: number
  /** px between screens (bezel) */
  gap: number
  /** px around the whole wall */
  margin: number
  fill: FillMode
  /** rounded screen corners, px (in cell space) */
  cornerRadius: number
  /** cell shape: stretch to fill the comp, or lock to an aspect ratio (wall stays centered) */
  cellAspect: CellAspect
  /** w/h when cellAspect is 'custom' */
  cellAspectCustom: number

  // ---- sources / screens ----
  assign: Assign
  /** every screen starts at a random point in its video */
  randomStart: boolean
  loop: boolean
  muteAudio: boolean
  labels: boolean
  labelPrefix: string

  /** monitors that span 2×2 cells (the big screens on a CCTV wall) */
  heroes: number
  /** index into the source list (videos then comps) of a screen pinned to the center, always on; -1 = none */
  featured: number
  /** the featured screen's size: 1 = one cell, 2 = a 2×2 block */
  featuredSpan: number

  // ---- camera (keyframed on the Controls null) ----
  /** start zoomed onto one screen (the featured one, else the centermost), then pull back to the wall */
  intro: 'none' | 'zoomOut'
  introHold: number
  introDur: number
  /** push back into that screen at the end */
  outro: 'none' | 'zoomIn'
  outroHold: number
  outroDur: number

  // ---- look ----
  background: Background
  bgColor: string
  /** 0..100, opacity of the static-noise underlay ('static' background) */
  staticBrightness: number
  /** thin frame around every cell — shows in gaps and on screens that are off */
  borders: boolean
  borderWidth: number
  borderColor: string
  /** CRT scanline overlay across the wall */
  scanlines: boolean
  /** 0..100 scanline strength */
  scanStrength: number

  // ---- reveal ----
  /** master switch: off = every screen is simply on (no animation at all) */
  animate: boolean
  reveal: RevealMode
  revealStart: number
  revealDuration: number
  screenAnim: ScreenAnim
  /** length of one screen's turn-on animation, frames */
  screenAnimFrames: number
  /** 0..1 — how much randomness is mixed into ordered reveal modes */
  jitter: number
  /** 0..100 — screens that never turn on */
  deadPct: number
  /** 0..100 — how often running screens briefly black out */
  dropouts: number
  seed: number

  // ---- focus spotlight ----
  /** adds a draggable "Wallmaker Focus" null: nearby screens zoom / far ones dim */
  focus: boolean
  focusRadius: number
  focusZoom: number
  /** 0..100 how much screens outside the radius are dimmed */
  focusDim: number
}

/** One planned screen: where it sits, what it plays and when it comes alive. All deterministic from the seed. */
export interface ScreenSpec {
  i: number
  row: number
  col: number
  /** index into the (deduplicated) video list */
  v: number
  /** reveal threshold, percent 0..100 — the screen turns on at revealStart + th/100 * revealDuration */
  th: number
  /** random rank 0..1 — dead when dead*100 < deadPct */
  dead: number
  /** start offset as a fraction 0..1 of the source duration */
  offset: number
  /** cells spanned per axis: 1 = normal, 2 = hero (2×2) */
  span: number
  /** pinned to the wall center, always on, plays from its start */
  featured?: boolean
}

export interface GridSpec {
  rows: number
  cols: number
  /** size of one screen, px */
  cellW: number
  cellH: number
  /** full wall footprint, px */
  wallW: number
  wallH: number
}
