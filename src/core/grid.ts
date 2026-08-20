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

/**
 * The concrete grid for a config: rows/cols + cell and wall sizes in px. The wall is always centered.
 *
 * In 'cover' mode the cell keeps the size it would have had — so screens stay the shape and scale
 * you set — and whole extra rows/columns are added until the wall reaches past the comp edges. Those
 * outer screens are cut off by the frame, which is the point: no black bands, nothing stretched.
 */
export function gridFor(cfg: Config): GridSpec {
  const n = Math.max(1, cfg.videos.length + cfg.comps.length || 12)
  const aspect = aspectOf(cfg)
  const base = cfg.gridMode === 'manual' ? { rows: Math.max(1, cfg.rows), cols: Math.max(1, cfg.cols) } : autoGrid(n, cfg.compW, cfg.compH, cfg.gap, cfg.margin, aspect)
  const availW = Math.max(1, cfg.compW - 2 * cfg.margin)
  const availH = Math.max(1, cfg.compH - 2 * cfg.margin)
  const cell = cellFor(base.rows, base.cols, availW, availH, cfg.gap, aspect) ?? { cellW: Math.max(1, availW / base.cols), cellH: Math.max(1, availH / base.rows) }
  let { rows, cols } = base
  // stretched cells already cover the comp exactly, so 'cover' only has work to do with a locked shape
  if (cfg.wallFit === 'cover' && aspect !== null) {
    cols = Math.max(cols, Math.min(200, Math.ceil((availW + cfg.gap) / (cell.cellW + cfg.gap))))
    rows = Math.max(rows, Math.min(200, Math.ceil((availH + cfg.gap) / (cell.cellH + cfg.gap))))
  }
  return {
    rows,
    cols,
    cellW: cell.cellW,
    cellH: cell.cellH,
    wallW: cell.cellW * cols + cfg.gap * (cols - 1),
    wallH: cell.cellH * rows + cfg.gap * (rows - 1),
  }
}

/** Is this cell fully inside the comp frame, or is it one of the ones the frame cuts off? */
export function cellOnscreen(row: number, col: number, cfg: Config, grid: GridSpec): boolean {
  const x = (col - (grid.cols - 1) / 2) * (grid.cellW + cfg.gap)
  const y = (row - (grid.rows - 1) / 2) * (grid.cellH + cfg.gap)
  return Math.abs(x) + grid.cellW / 2 <= cfg.compW / 2 + 0.5 && Math.abs(y) + grid.cellH / 2 <= cfg.compH / 2 + 0.5
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
 * The gap that makes `rows × cols` cells of exactly `aspect` fill `availW × availH` with nothing
 * left over. NaN when no gap can (e.g. a single cell whose comp is the wrong shape).
 *
 * Solving  (availW - (cols-1)g)/cols  =  aspect · (availH - (rows-1)g)/rows  for g.
 */
export function gapForExactFit(rows: number, cols: number, aspect: number, availW: number, availH: number): number {
  const num = rows * availW - aspect * cols * availH
  const den = rows * (cols - 1) - aspect * cols * (rows - 1)
  if (Math.abs(den) < 1e-9) return Math.abs(num) < 1e-6 ? 0 : NaN
  return num / den
}

/**
 * Reach the comp edges with nothing left over.
 *
 * With a locked cell shape the cells must KEEP that shape, so the grid and the gap are what move:
 * we look for the rows × columns whose exact-fit gap is sensible, preferring counts near the ones
 * you have and a gap near the one you set. Only if no such grid exists do we fall back to
 * stretching the cells (which always fills, but abandons the shape you asked for).
 */
export function fillGrid(cfg: Config): Partial<Config> {
  const availW = Math.max(1, cfg.compW - 2 * cfg.margin)
  const availH = Math.max(1, cfg.compH - 2 * cfg.margin)
  const g = gridFor(cfg)
  const aspect = aspectOf(cfg)
  const want = Math.max(1, cfg.gridMode === 'manual' ? cfg.rows * cfg.cols : cfg.videos.length + cfg.comps.length || g.rows * g.cols)

  if (aspect !== null) {
    let best: { rows: number; cols: number; gap: number } | null = null
    let bestScore = Infinity
    for (let rows = 1; rows <= 40; rows++) {
      for (let cols = 1; cols <= 40; cols++) {
        const gap = gapForExactFit(rows, cols, aspect, availW, availH)
        if (!Number.isFinite(gap) || gap < 0 || gap > 80) continue // 80 = the panel's gap ceiling
        const cw = (availW - (cols - 1) * gap) / cols
        const ch = (availH - (rows - 1) * gap) / rows
        if (cw < 8 || ch < 8) continue
        const score = Math.abs(Math.log((rows * cols) / want)) + Math.abs(gap - cfg.gap) / 25
        if (score < bestScore) {
          bestScore = score
          best = { rows, cols, gap: Math.round(gap * 100) / 100 }
        }
      }
    }
    if (best) return { gridMode: 'manual', rows: best.rows, cols: best.cols, gap: best.gap }
  }

  // no grid of that shape fits: stretch the cells instead, staying as close to it as we can
  const target = aspect ?? g.cellW / g.cellH
  let best = { rows: g.rows, cols: g.cols }
  let bestScore = Infinity
  for (let rows = 1; rows <= 64; rows++) {
    const ch = (availH - (rows - 1) * cfg.gap) / rows
    if (ch <= 2) break
    for (let cols = 1; cols <= 64; cols++) {
      const cw = (availW - (cols - 1) * cfg.gap) / cols
      if (cw <= 2) break
      const score = Math.abs(Math.log(cw / ch / target)) + 0.12 * Math.abs(Math.log((rows * cols) / want))
      if (score < bestScore) {
        bestScore = score
        best = { rows, cols }
      }
    }
  }
  return { gridMode: 'manual', rows: best.rows, cols: best.cols, cellAspect: 'fill' }
}

/** How many cells the comp frame cuts off. 0 when the whole wall is visible. */
export function offscreenCount(cfg: Config, grid: GridSpec): number {
  let cols = 0
  let rows = 0
  for (let c = 0; c < grid.cols; c++) if (Math.abs((c - (grid.cols - 1) / 2) * (grid.cellW + cfg.gap)) + grid.cellW / 2 <= cfg.compW / 2 + 0.5) cols++
  for (let r = 0; r < grid.rows; r++) if (Math.abs((r - (grid.rows - 1) / 2) * (grid.cellH + cfg.gap)) + grid.cellH / 2 <= cfg.compH / 2 + 0.5) rows++
  return grid.rows * grid.cols - rows * cols
}
