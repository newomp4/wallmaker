/** Arrangements: one click for a grid shape. They never touch your sources, comp settings or camera. */
import type { Config } from './types'

export interface Preset {
  name: string
  hint: string
  patch: Partial<Config>
}

export const PRESETS: Preset[] = [
  {
    name: 'Auto',
    hint: 'One screen per source, rows and columns picked to fill the comp',
    patch: { gridMode: 'auto', cellAspect: 'fill', gap: 6, margin: 0 },
  },
  {
    name: 'Edge to edge',
    hint: 'No gap, no margin — the wall covers the comp exactly',
    patch: { gridMode: 'auto', cellAspect: 'fill', gap: 0, margin: 0, cornerRadius: 0 },
  },
  {
    name: '16:9 cells',
    hint: 'Every screen a widescreen rectangle, wall centered',
    patch: { gridMode: 'auto', cellAspect: 'wide', gap: 8, margin: 0 },
  },
  {
    name: '3 x 3',
    hint: 'Nine square screens',
    patch: { gridMode: 'manual', rows: 3, cols: 3, cellAspect: 'square', gap: 10, margin: 0 },
  },
  {
    name: '4 x 3',
    hint: 'Twelve widescreen cells',
    patch: { gridMode: 'manual', rows: 3, cols: 4, cellAspect: 'wide', gap: 8, margin: 0 },
  },
  {
    name: '5 x 5',
    hint: 'A dense square block — good for a long pull-back',
    patch: { gridMode: 'manual', rows: 5, cols: 5, cellAspect: 'square', gap: 6, margin: 0 },
  },
  {
    name: 'Spaced',
    hint: 'Airy 16:9 cells with a wide outer margin',
    patch: { gridMode: 'auto', cellAspect: 'wide', gap: 20, margin: 60, cornerRadius: 6 },
  },
]
