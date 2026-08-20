import type { Config } from './types'

export const DEFAULT_CONFIG: Config = {
  videos: [],
  comps: [],

  compName: 'Video Wall',
  compW: 1920,
  compH: 1080,
  fps: 30,
  durationSec: 12,
  gridMode: 'auto',
  rows: 5,
  cols: 8,
  gap: 6,
  margin: 0,
  fill: 'cover',
  cornerRadius: 0,
  cellAspect: 'fill',
  cellAspectCustom: 1.7778,
  wallFit: 'contain',

  assign: 'shuffle',
  randomStart: true,
  loop: true,
  muteAudio: true,

  featured: -1,

  intro: 'none',
  introHold: 1,
  introDur: 2,
  outro: 'none',
  outroHold: 0.5,
  outroDur: 2,

  background: 'solid',
  bgColor: '#0a0a0c',

  animate: false,
  reveal: 'random',
  revealStart: 0.5,
  revealDuration: 6,
  screenAnim: 'fade',
  screenAnimFrames: 8,
  jitter: 0.2,
  deadPct: 0,
  seed: 7,
}

export const COMP_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1080p', w: 1920, h: 1080 },
  { label: '4K', w: 3840, h: 2160 },
  { label: 'Vertical', w: 1080, h: 1920 },
  { label: 'Square', w: 1080, h: 1080 },
]

/** file extensions After Effects can import as video footage */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'avi', 'mpg', 'mpeg', 'mxf', 'm2ts', 'mts', 'wmv', 'gif']
