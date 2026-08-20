/** Every Wallmaker setting lives in this one flat object (persisted, shared with the preview and the AE build). */

export type GridMode = 'auto' | 'manual'
export type FillMode = 'cover' | 'contain' | 'stretch'
export type Assign = 'sequential' | 'shuffle' | 'random'
export type Background = 'solid' | 'transparent'
export type RevealMode = 'none' | 'random' | 'rows' | 'cols' | 'sequence' | 'snake' | 'center' | 'edges' | 'spiral' | 'diagonal'
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
  /** px between screens */
  gap: number
  /** px around the whole wall */
  margin: number
  fill: FillMode
  /** rounded screen corners, px (in cell space) */
  cornerRadius: number
  /** cell shape: stretch to fill the comp, or lock every cell to one aspect ratio (wall stays centered) */
  cellAspect: CellAspect
  /** w/h when cellAspect is 'custom' */
  cellAspectCustom: number

  // ---- sources / screens ----
  assign: Assign
  /** every screen starts at a random point in its video */
  randomStart: boolean
  loop: boolean
  muteAudio: boolean

  /** index into the source list (videos then comps) of the screen at the center of the wall — the
   *  one the camera zooms to. Always on, playing from its start. -1 = none. */
  featured: number

  // ---- camera (a keyframed "Zoom to screen (%)" slider on the Wallmaker Camera null) ----
  /** start filled by the centered screen, then pull back to the whole wall */
  intro: 'none' | 'zoomOut'
  introHold: number
  introDur: number
  /** push back into that screen at the end */
  outro: 'none' | 'zoomIn'
  outroHold: number
  outroDur: number

  // ---- look (deliberately minimal: grading and texture belong in your own effects) ----
  background: Background
  bgColor: string

  // ---- power-on ----
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
  /** the screen at the center of the wall: always on, plays from its start, the camera's target */
  featured?: boolean
}

export interface GridSpec {
  rows: number
  cols: number
  /** size of one screen, px — every cell is identical */
  cellW: number
  cellH: number
  /** full wall footprint, px */
  wallW: number
  wallH: number
}
