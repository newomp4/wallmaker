/**
 * Compiles a Config into the JSON the After Effects host script consumes.
 * Pure data in → data out (no DOM), so the host-level tests can run it under Node too.
 */
import type { Config, FillMode, GridSpec, ScreenSpec } from './types'
import { gridFor } from './grid'
import { planScreens, planCamera, withAnimation, type CameraPlan } from './reveal'

export interface WallScene {
  version: 1
  compName: string
  buildKey: string
  frame: { w: number; h: number }
  fps: number
  durationSec: number
  bg: { mode: 'dark' | 'static' | 'transparent'; color: [number, number, number]; staticBrightness: number }
  grid: { rows: number; cols: number; gap: number; cellW: number; cellH: number; wallW: number; wallH: number }
  fill: FillMode
  cornerRadius: number
  labels: { prefix: string } | null
  borders: { width: number; color: [number, number, number] } | null
  scanlines: { strength: number } | null
  focus: { radius: number; zoom: number; dim: number } | null
  camera: CameraPlan | null
  mute: boolean
  loop: boolean
  reveal: { mode: string; start: number; duration: number; animFrames: number; style: string; deadPct: number; dropouts: number; seed: number }
  videos: { path?: string; compId?: number; name: string }[]
  screens: { i: number; row: number; col: number; v: number; th: number; dead: number; offset: number; span: number; featured?: boolean }[]
}

export function safeCompName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Video Wall'
}

/** Folder/tag key for a build: slug of the comp name + a short hash so "Wall" and "wall" never collide. */
export function buildKeyFor(compName: string): string {
  const name = safeCompName(compName)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wall'
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${slug}-${(h >>> 0).toString(36).slice(0, 5)}`
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? parseInt(m[1], 16) : 0x0a0a0c
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

const basename = (p: string) => p.slice(p.replace(/\\/g, '/').lastIndexOf('/') + 1)

export function compileWall(rawCfg: Config, opts?: { grid?: GridSpec; screens?: ScreenSpec[] }): WallScene {
  const cfg = withAnimation(rawCfg)
  if (!cfg.videos.length && !cfg.comps.length) throw new Error('Add at least one video or comp first')
  const grid = opts?.grid ?? gridFor(cfg)
  const screens = opts?.screens ?? planScreens(cfg, grid)
  // dedupe sources — the host imports each file once, screens reference by index
  const unique: { path?: string; compId?: number; name: string }[] = []
  const indexOf = new Map<string, number>()
  const sourceKeys: string[] = []
  for (const p of cfg.videos) {
    const k = 'f:' + p
    sourceKeys.push(k)
    if (!indexOf.has(k)) {
      indexOf.set(k, unique.length)
      unique.push({ path: p, name: basename(p) })
    }
  }
  for (const c of cfg.comps) {
    const k = 'c:' + c.id
    sourceKeys.push(k)
    if (!indexOf.has(k)) {
      indexOf.set(k, unique.length)
      unique.push({ compId: c.id, name: c.name })
    }
  }
  const compName = safeCompName(cfg.compName)
  return {
    version: 1,
    compName,
    buildKey: buildKeyFor(compName),
    frame: { w: Math.round(cfg.compW), h: Math.round(cfg.compH) },
    fps: cfg.fps,
    durationSec: cfg.durationSec,
    bg: { mode: cfg.background, color: hexToRgb(cfg.bgColor), staticBrightness: cfg.staticBrightness },
    grid: {
      rows: grid.rows,
      cols: grid.cols,
      gap: cfg.gap,
      cellW: Math.round(grid.cellW * 100) / 100,
      cellH: Math.round(grid.cellH * 100) / 100,
      wallW: Math.round(grid.cellW * grid.cols + cfg.gap * (grid.cols - 1)),
      wallH: Math.round(grid.cellH * grid.rows + cfg.gap * (grid.rows - 1)),
    },
    fill: cfg.fill,
    cornerRadius: cfg.cornerRadius,
    labels: cfg.labels ? { prefix: cfg.labelPrefix || 'CAM' } : null,
    borders: cfg.borders ? { width: cfg.borderWidth, color: hexToRgb(cfg.borderColor) } : null,
    scanlines: cfg.scanlines ? { strength: cfg.scanStrength } : null,
    focus: cfg.focus ? { radius: cfg.focusRadius, zoom: cfg.focusZoom, dim: cfg.focusDim } : null,
    camera: planCamera(cfg, grid, screens),
    mute: cfg.muteAudio,
    loop: cfg.loop,
    reveal: {
      mode: cfg.reveal,
      start: cfg.revealStart,
      duration: cfg.revealDuration,
      animFrames: cfg.screenAnimFrames,
      style: cfg.screenAnim,
      deadPct: cfg.deadPct,
      dropouts: cfg.dropouts,
      seed: cfg.seed,
    },
    videos: unique,
    screens: screens.map((s) => ({ i: s.i, row: s.row, col: s.col, v: indexOf.get(sourceKeys[s.v % sourceKeys.length])!, th: s.th, dead: s.dead, offset: s.offset, span: s.span, featured: s.featured || undefined })),
  }
}
