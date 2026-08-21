/**
 * Tile plan: how to bake a wall into a handful of big video files that snap back together in AE.
 *
 * Why tiles rather than one huge file: After Effects only decodes the layers that are on screen, so
 * when you zoom into the wall it reads one or two tiles instead of a 200-megapixel frame. The wall
 * gets FASTER as you zoom in, which is the opposite of a wall made of hundreds of live clips.
 *
 * Two details do all the work of hiding the joins:
 *   - cuts land in the GAPS between screens wherever possible, so a seam falls in flat black
 *   - every tile is rendered with a few pixels of BLEED, so a scaler always has pixels to sample
 *     past the edge and neighbours overlap with identical content
 */
import type { Config, GridSpec, ScreenSpec } from './types'
import { wallOffset } from './grid'

export interface TileRect {
  /** position in the tile grid */
  ix: number
  iy: number
  /** the tile's own rect in master pixels, edge to edge with its neighbours */
  x: number
  y: number
  w: number
  h: number
  /** the rect actually rendered: the above grown by the bleed and clamped to the master */
  bx: number
  by: number
  bw: number
  bh: number
  /** file name, without a directory */
  file: string
}

export interface TileScreen {
  /** index into the plan's screens */
  i: number
  /** reveal threshold, percent — when this screen comes on */
  th: number
  /** which source it plays */
  v: number
  /** start offset as a fraction of the source duration */
  offset: number
  /** the screen's rect in master pixels (whole cell, before the tile is cropped out of it) */
  x: number
  y: number
  w: number
  h: number
}

export interface TilePlan {
  /** master pixels per comp pixel — also the zoom factor that stays pixel-sharp */
  scale: number
  masterW: number
  masterH: number
  /** the wall rect this master stands for, in comp pixels */
  wallW: number
  wallH: number
  /** where the wall sits relative to the comp centre, comp px (mirrors the live build) */
  offsetX: number
  offsetY: number
  cols: number
  rows: number
  bleed: number
  tiles: TileRect[]
  screens: TileScreen[]
  /** total pixels per frame across every tile, for the size estimate */
  megapixels: number
  /** each screen's dead-rank, by screen index, so the renderer can skip the same ones AE does */
  deadRank: Record<number, number>
}

/**
 * The zoom at which one screen is as large as the frame allows — the natural "as far as you would
 * ever go" default.
 *
 * MIN, not max: a 9:16 screen in a 16:9 comp is limited by height, and stopping there shows the
 * whole screen. Taking the max instead would mean zooming until the screen's WIDTH filled the
 * frame, which crops most of it away and costs an order of magnitude more master pixels
 * (22038x17434 instead of 6970x5514 on a real wall — 387 MP a frame instead of 38).
 */
export function fillZoom(cfg: Config, grid: GridSpec): number {
  return Math.max(1, Math.min(64, Math.min(cfg.compW / grid.cellW, cfg.compH / grid.cellH)))
}

/**
 * Choose `count - 1` cut positions across `total`, snapping each to the nearest gap centre when
 * that leaves every tile within `maxSpan`. Reports how many landed on a gap so the caller can
 * decide whether spending another tile would buy a better set.
 */
function cutsFor(total: number, count: number, candidates: number[], maxSpan: number): { cuts: number[]; snapped: number } {
  const cuts: number[] = []
  let prev = 0
  let snapped = 0
  for (let i = 1; i < count; i++) {
    const ideal = (total * i) / count
    let best = ideal
    let bestD = Infinity
    for (const c of candidates) {
      const d = Math.abs(c - ideal)
      // only if it closes a legal tile AND leaves room for the ones still to come
      if (d < bestD && c - prev > 8 && c - prev <= maxSpan && total - c <= maxSpan * (count - i)) {
        best = c
        bestD = d
      }
    }
    if (bestD < Infinity) snapped++
    const cut = Math.round(best)
    cuts.push(cut)
    prev = cut
  }
  return { cuts, snapped }
}

/**
 * The cut set to actually use. A seam sitting in the black gap between two screens is invisible
 * even before the bleed does its job, so it is worth one extra tile to get every cut into a gap —
 * a tight tile limit can leave no legal gap-aligned cut at the minimum tile count.
 */
function bestCuts(total: number, minCount: number, candidates: number[], maxSpan: number): { cuts: number[]; count: number } {
  let best: { cuts: number[]; count: number; snapped: number } | null = null
  for (let n = minCount; n <= minCount + 2; n++) {
    const { cuts, snapped } = cutsFor(total, n, candidates, maxSpan)
    if (snapped === n - 1) return { cuts, count: n } // every cut in a gap: done
    if (!best || snapped > best.snapped) best = { cuts, count: n, snapped }
  }
  return { cuts: best!.cuts, count: best!.count }
}

/** Turn a run of cuts into [start, size] spans covering `total`. */
function spans(total: number, cuts: number[]): { at: number; size: number }[] {
  const out: { at: number; size: number }[] = []
  let at = 0
  for (const c of cuts) {
    out.push({ at, size: c - at })
    at = c
  }
  out.push({ at, size: total - at })
  return out
}

/**
 * Plan the tiles for a wall.
 *
 * @param zoom  how far you can zoom in before it softens; the master is this many times the wall's
 *              on-screen size. `fillZoom` (one screen filling the frame) is the sensible default.
 * @param maxTile  the largest tile edge to emit, in pixels.
 */
export function planTiles(cfg: Config, grid: GridSpec, screens: ScreenSpec[], zoom: number, maxTile = 4096, bleed = 8): TilePlan {
  const m = Math.max(1, Math.min(64, zoom))
  const wallW = grid.wallW
  const wallH = grid.wallH
  const masterW = Math.max(2, Math.round(wallW * m))
  const masterH = Math.max(2, Math.round(wallH * m))
  const maxEdge = Math.max(256, Math.min(16384, Math.round(maxTile)))

  const minCols = Math.max(1, Math.ceil(masterW / maxEdge))
  const minRows = Math.max(1, Math.ceil(masterH / maxEdge))

  // gap centres, in master pixels, measured from the wall's left/top edge
  const gapX: number[] = []
  for (let c = 0; c < grid.cols - 1; c++) gapX.push((c * (grid.cellW + cfg.gap) + grid.cellW + cfg.gap / 2) * m)
  const gapY: number[] = []
  for (let r = 0; r < grid.rows - 1; r++) gapY.push((r * (grid.cellH + cfg.gap) + grid.cellH + cfg.gap / 2) * m)

  const xs = spans(masterW, bestCuts(masterW, minCols, gapX, maxEdge).cuts)
  const ys = spans(masterH, bestCuts(masterH, minRows, gapY, maxEdge).cuts)

  const tiles: TileRect[] = []
  for (let iy = 0; iy < ys.length; iy++) {
    for (let ix = 0; ix < xs.length; ix++) {
      const sx = xs[ix]
      const sy = ys[iy]
      const bx = Math.max(0, sx.at - bleed)
      const by = Math.max(0, sy.at - bleed)
      const bw = Math.min(masterW, sx.at + sx.size + bleed) - bx
      const bh = Math.min(masterH, sy.at + sy.size + bleed) - by
      tiles.push({
        ix,
        iy,
        x: sx.at,
        y: sy.at,
        w: sx.size,
        h: sy.size,
        bx,
        by,
        // encoders want even dimensions
        bw: bw % 2 ? bw + (bx + bw < masterW ? 1 : -1) : bw,
        bh: bh % 2 ? bh + (by + bh < masterH ? 1 : -1) : bh,
        file: `tile-${String(iy + 1).padStart(2, '0')}-${String(ix + 1).padStart(2, '0')}`,
      })
    }
  }

  const cellW = grid.cellW * m
  const cellH = grid.cellH * m
  const tScreens: TileScreen[] = screens.map((s) => ({
    i: s.i,
    th: s.featured ? 0 : s.th,
    v: s.v,
    offset: s.offset,
    x: s.col * (grid.cellW + cfg.gap) * m,
    y: s.row * (grid.cellH + cfg.gap) * m,
    w: cellW,
    h: cellH,
  }))

  const [ox, oy] = wallOffset(cfg, grid)
  return {
    scale: m,
    masterW,
    masterH,
    wallW,
    wallH,
    offsetX: ox,
    offsetY: oy,
    cols: xs.length,
    rows: ys.length,
    bleed,
    tiles,
    screens: tScreens,
    megapixels: tiles.reduce((n, t) => n + (t.bw * t.bh) / 1e6, 0),
    deadRank: Object.fromEntries(screens.map((s) => [s.i, s.dead])),
  }
}

/** The screens a tile needs to draw, with their rect relative to the tile's rendered origin. */
export function screensForTile(plan: TilePlan, t: TileRect): { s: TileScreen; x: number; y: number }[] {
  const out: { s: TileScreen; x: number; y: number }[] = []
  for (const s of plan.screens) {
    if (s.x + s.w <= t.bx || s.x >= t.bx + t.bw || s.y + s.h <= t.by || s.y >= t.by + t.bh) continue
    out.push({ s, x: Math.round(s.x - t.bx), y: Math.round(s.y - t.by) })
  }
  return out
}
