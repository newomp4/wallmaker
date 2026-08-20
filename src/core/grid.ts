import type { Config, GridSpec } from './types'

/** The locked cell aspect ratio (w/h), or null when cells stretch to fill the comp. */
export function aspectOf(cfg: Config): number | null {
  switch (cfg.cellAspect) {
    case 'fill': return null
    case 'wide': return 16 / 9
    case 'tv': return 4 / 3
    case 'square': return 1
    case 'tall': return 9 / 16
    case 'custom': return Math.max(0.05, Math.min(20, cfg.cellAspectCustom || 16 / 9))
  }
}

function cellFor(rows: number, cols: number, availW: number, availH: number, gap: number, aspect: number | null): { cellW: number; cellH: number } | null {
  const maxW = (availW - (cols - 1) * gap) / cols
  const maxH = (availH - (rows - 1) * gap) / rows
  if (maxW <= 2 || maxH <= 2) return null
  if (aspect === null) return { cellW: maxW, cellH: maxH }
  // locked aspect: the largest cell of that shape that still fits both ways
  const cellW = Math.min(maxW, aspect * maxH)
  return { cellW, cellH: cellW / aspect }
}

/**
 * Pick rows × cols for `n` screens. With stretchy cells, aim near 16:9; with a locked
 * aspect, maximize the cell size — both with a small penalty for empty cells
 * (a 7-video wall should become 4×2, not 7×1).
 */
export function autoGrid(n: number, compW: number, compH: number, gap: number, margin: number, aspect: number | null): { rows: number; cols: number } {
  const availW = Math.max(1, compW - 2 * margin)
  const availH = Math.max(1, compH - 2 * margin)
  let best: { rows: number; cols: number } | null = null
  let bestScore = -Infinity
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols)
    const cell = cellFor(rows, cols, availW, availH, gap, aspect)
    if (!cell) continue
    const waste = rows * cols - n
    const score =
      aspect === null
        ? -Math.abs(Math.log(cell.cellW / cell.cellH / (16 / 9))) - (waste / n) * 0.4
        : cell.cellW * cell.cellH * (1 - (0.35 * waste) / n)
    if (score > bestScore) {
      bestScore = score
      best = { rows, cols }
    }
  }
  return best ?? { rows: 1, cols: Math.max(1, n) }
}

/** The concrete grid for a config: rows/cols (auto or manual) + cell and wall sizes in px. The wall is always centered in the comp. */
export function gridFor(cfg: Config): GridSpec {
  const n = Math.max(1, cfg.videos.length + cfg.comps.length || 12)
  const aspect = aspectOf(cfg)
  const { rows, cols } = cfg.gridMode === 'manual' ? { rows: Math.max(1, cfg.rows), cols: Math.max(1, cfg.cols) } : autoGrid(n, cfg.compW, cfg.compH, cfg.gap, cfg.margin, aspect)
  const availW = Math.max(1, cfg.compW - 2 * cfg.margin)
  const availH = Math.max(1, cfg.compH - 2 * cfg.margin)
  const cell = cellFor(rows, cols, availW, availH, cfg.gap, aspect) ?? { cellW: Math.max(1, availW / cols), cellH: Math.max(1, availH / rows) }
  return {
    rows,
    cols,
    cellW: cell.cellW,
    cellH: cell.cellH,
    wallW: cell.cellW * cols + cfg.gap * (cols - 1),
    wallH: cell.cellH * rows + cfg.gap * (rows - 1),
  }
}

/** Comp left over around the wall, px per side. 0 = the wall reaches the comp edges. */
export function bandsFor(cfg: Config, grid?: GridSpec): { x: number; y: number } {
  const g = grid ?? gridFor(cfg)
  return {
    x: Math.max(0, Math.round((cfg.compW - 2 * cfg.margin - g.wallW) / 2)),
    y: Math.max(0, Math.round((cfg.compH - 2 * cfg.margin - g.wallH) / 2)),
  }
}

/**
 * Rows × columns that make the wall fill the comp EXACTLY, with cells as close as possible to the
 * shape you asked for and to the number of screens you already have.
 *
 * A locked cell shape can only reach the comp edges when rows/cols happen to match the comp's
 * aspect; otherwise AE gets letterbox bands. This finds the counts where stretching cells to fill
 * costs almost nothing, so "flush edges" and "cells the right shape" stop fighting each other.
 */
export function fillGrid(cfg: Config): { gridMode: 'manual'; rows: number; cols: number; cellAspect: 'fill' } {
  const availW = Math.max(1, cfg.compW - 2 * cfg.margin)
  const availH = Math.max(1, cfg.compH - 2 * cfg.margin)
  const g = gridFor(cfg)
  const target = aspectOf(cfg) ?? g.cellW / g.cellH
  const want = Math.max(1, cfg.gridMode === 'manual' ? cfg.rows * cfg.cols : cfg.videos.length + cfg.comps.length || g.rows * g.cols)
  let best = { rows: g.rows, cols: g.cols }
  let bestScore = Infinity
  for (let rows = 1; rows <= 64; rows++) {
    const ch = (availH - (rows - 1) * cfg.gap) / rows
    if (ch <= 2) break
    for (let cols = 1; cols <= 64; cols++) {
      const cw = (availW - (cols - 1) * cfg.gap) / cols
      if (cw <= 2) break
      // how wrong the cell shape is, plus a gentle pull towards the screen count you already have
      const score = Math.abs(Math.log(cw / ch / target)) + 0.12 * Math.abs(Math.log((rows * cols) / want))
      if (score < bestScore) {
        bestScore = score
        best = { rows, cols }
      }
    }
  }
  return { gridMode: 'manual', rows: best.rows, cols: best.cols, cellAspect: 'fill' }
}
