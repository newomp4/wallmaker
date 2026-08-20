/** Every Wallmaker setting lives in this one flat object (persisted, shared with the preview and the AE build). */

export type GridMode = 'auto' | 'manual'
export type FillMode = 'cover' | 'contain' | 'stretch'
export type Assign = 'sequential' | 'shuffle' | 'random'
export type Background = 'dark' | 'static' | 'transparent'
export type RevealMode = 'none' | 'random' | 'rows' | 'cols' | 'scanline' | 'center' | 'edges' | 'diagonal'
export type ScreenAnim = 'cut' | 'fade' | 'flicker' | 'pop'

export interface Config {
  /** absolute paths of the source videos, in order */
  videos: string[]

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

  // ---- sources / screens ----
  assign: Assign
  /** every screen starts at a random point in its video */
  randomStart: boolean
  loop: boolean
  muteAudio: boolean
  labels: boolean
  labelPrefix: string

  // ---- look ----
  background: Background
  bgColor: string
  /** 0..100, opacity of the static-noise underlay ('static' background) */
  staticBrightness: number

  // ---- reveal ----
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
  seed: number
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
