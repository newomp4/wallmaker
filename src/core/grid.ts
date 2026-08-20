import type { Config, GridSpec } from './types'

/**
 * Pick rows × cols for `n` screens so the cells land close to 16:9 inside the comp,
 * with a small penalty for empty cells (a 7-video wall should become 4×2, not 7×1).
 */
export function autoGrid(n: number, compW: number, compH: number, gap: number, margin: number): { rows: number; cols: number } {
  const wallW = Math.max(1, compW - 2 * margin)
  const wallH = Math.max(1, compH - 2 * margin)
  const target = 16 / 9
  let best = { rows: 1, cols: Math.max(1, n), score: Infinity }
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols)
    const cw = (wallW - (cols - 1) * gap) / cols
    const ch = (wallH - (rows - 1) * gap) / rows
    if (cw <= 4 || ch <= 4) continue
    const waste = rows * cols - n
    const score = Math.abs(Math.log((cw / ch) / target)) + (waste / n) * 0.4
    if (score < best.score) best = { rows, cols, score }
  }
  return { rows: best.rows, cols: best.cols }
}

/** The concrete grid for a config: rows/cols (auto or manual) + cell and wall sizes in px. */
export function gridFor(cfg: Config): GridSpec {
  const n = Math.max(1, cfg.videos.length || 12)
  const { rows, cols } = cfg.gridMode === 'manual' ? { rows: Math.max(1, cfg.rows), cols: Math.max(1, cfg.cols) } : autoGrid(n, cfg.compW, cfg.compH, cfg.gap, cfg.margin)
  const wallW = Math.max(1, cfg.compW - 2 * cfg.margin)
  const wallH = Math.max(1, cfg.compH - 2 * cfg.margin)
  const cellW = (wallW - (cols - 1) * cfg.gap) / cols
  const cellH = (wallH - (rows - 1) * cfg.gap) / rows
  return { rows, cols, cellW, cellH, wallW, wallH }
}

/** Center of screen (row, col) relative to the wall center — the same math the AE position expressions use. */
export function cellCenter(row: number, col: number, grid: GridSpec, gap: number): { x: number; y: number } {
  return {
    x: (col - (grid.cols - 1) / 2) * (grid.cellW + gap),
    y: (row - (grid.rows - 1) / 2) * (grid.cellH + gap),
  }
}
