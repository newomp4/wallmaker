import type { Config } from './types'

export const DEFAULT_CONFIG: Config = {
  videos: [],

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

  assign: 'sequential',
  randomStart: true,
  loop: true,
  muteAudio: true,
  labels: false,
  labelPrefix: 'CAM',

  background: 'dark',
  bgColor: '#0a0a0c',
  staticBrightness: 14,

  reveal: 'random',
  revealStart: 0.5,
  revealDuration: 6,
  screenAnim: 'flicker',
  screenAnimFrames: 8,
  jitter: 0.15,
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
