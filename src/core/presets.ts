/** One-click looks: arrangement + style + power-on bundles. They never touch the comp settings or your sources. */
import type { Config } from './types'

export interface Preset {
  name: string
  hint: string
  patch: Partial<Config>
}

export const PRESETS: Preset[] = [
  {
    name: 'CCTV wall',
    hint: 'Security-monitor grid: labels, static, flicker, a few dead screens',
    patch: {
      gap: 6, margin: 0, cornerRadius: 0, fill: 'cover', heroes: 0,
      labels: true, labelPrefix: 'CAM',
      background: 'static', bgColor: '#05070a', staticBrightness: 12,
      borders: true, borderWidth: 2, borderColor: '#26262c',
      scanlines: true, scanStrength: 18,
      animate: true, reveal: 'random', screenAnim: 'flicker', screenAnimFrames: 10,
      revealStart: 0.5, revealDuration: 5, jitter: 0.15, deadPct: 7, dropouts: 8,
    },
  },
  {
    name: 'Clean mosaic',
    hint: 'Edge-to-edge grid, no chrome, everything simply on',
    patch: {
      gap: 0, margin: 0, cornerRadius: 0, fill: 'cover', heroes: 0,
      labels: false, background: 'dark', bgColor: '#0a0a0c',
      borders: false, scanlines: false,
      animate: false, deadPct: 0, dropouts: 0,
    },
  },
  {
    name: 'Hero mosaic',
    hint: 'A couple of big 2×2 monitors in the grid, calm fade-in',
    patch: {
      gap: 4, margin: 0, cornerRadius: 4, fill: 'cover', heroes: 2,
      labels: false, background: 'dark', bgColor: '#0a0a0c',
      borders: false, scanlines: false,
      animate: true, reveal: 'center', screenAnim: 'fade', screenAnimFrames: 12,
      revealStart: 0.3, revealDuration: 3.5, jitter: 0.2, deadPct: 0, dropouts: 0,
    },
  },
  {
    name: 'Retro CRT',
    hint: 'Round corners, heavy scanlines, dropouts — a wall of old tube TVs',
    patch: {
      gap: 10, margin: 24, cornerRadius: 10, fill: 'cover', heroes: 0,
      labels: true, labelPrefix: 'CH',
      background: 'static', bgColor: '#070709', staticBrightness: 20,
      borders: true, borderWidth: 3, borderColor: '#3a3a41',
      scanlines: true, scanStrength: 35,
      animate: true, reveal: 'scanline', screenAnim: 'flicker', screenAnimFrames: 14,
      revealStart: 0.4, revealDuration: 4, jitter: 0.1, deadPct: 12, dropouts: 15,
    },
  },
  {
    name: 'Gallery fade',
    hint: 'Airy spacing on transparency, screens drift in diagonally',
    patch: {
      gap: 14, margin: 48, cornerRadius: 6, fill: 'cover', heroes: 0,
      labels: false, background: 'transparent',
      borders: false, scanlines: false,
      animate: true, reveal: 'diagonal', screenAnim: 'fade', screenAnimFrames: 20,
      revealStart: 0.2, revealDuration: 4, jitter: 0.25, deadPct: 0, dropouts: 0,
    },
  },
]
