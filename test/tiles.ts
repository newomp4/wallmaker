/**
 * The tile plan has to be exact: tiles that do not meet perfectly become visible seams in a render
 * that takes minutes to produce. Everything here is checked by construction before a single pixel
 * is encoded. Run: npx tsx test/tiles.ts
 */
import { DEFAULT_CONFIG } from '../src/core/defaults.ts'
import type { CellAspect, Config } from '../src/core/types.ts'
import { gridFor } from '../src/core/grid.ts'
import { planScreens } from '../src/core/reveal.ts'
import { planTiles, fillZoom, screensForTile } from '../src/core/tiles.ts'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++
    console.error(` ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  } else console.log(` ✓ ${name}`)
}
const cfg = (p: Partial<Config>): Config => ({ ...DEFAULT_CONFIG, videos: Array.from({ length: 40 }, (_, i) => `/v/${i}.mp4`), ...p })
const build = (p: Partial<Config>, zoom?: number, maxTile = 4096) => {
  const c = cfg(p)
  const g = gridFor(c)
  const s = planScreens(c, g)
  return { c, g, s, plan: planTiles(c, g, s, zoom ?? fillZoom(c, g), maxTile) }
}

// ---- the tiles must cover the master exactly: no gap, no overlap, nothing outside ----
{
  for (const [rows, cols, shape, fit, maxTile] of [
    [3, 11, 'tall', 'cover', 4096],
    [5, 5, 'fill', 'contain', 4096],
    [9, 15, 'tall', 'cover', 4096],
    [4, 4, 'square', 'contain', 2048],
    [2, 3, 'wide', 'contain', 8192],
    [1, 1, 'fill', 'contain', 4096],
  ] as const) {
    const { plan } = build({ gridMode: 'manual', rows, cols, cellAspect: shape as CellAspect, wallFit: fit, gap: 8, featured: 2 }, undefined, maxTile)
    const label = `${rows}x${cols} ${shape}/${fit} @${maxTile}`
    // every pixel of the master belongs to exactly one tile
    let area = 0
    let overlap = false
    for (const t of plan.tiles) {
      area += t.w * t.h
      for (const u of plan.tiles) {
        if (u === t) continue
        if (t.x < u.x + u.w && u.x < t.x + t.w && t.y < u.y + u.h && u.y < t.y + t.h) overlap = true
      }
    }
    check(`${label}: tiles cover the master exactly`, area === plan.masterW * plan.masterH && !overlap, `${area} vs ${plan.masterW * plan.masterH}${overlap ? ' (overlap!)' : ''}`)
    check(`${label}: rows and columns line up`, plan.tiles.length === plan.cols * plan.rows)
    check(`${label}: no tile exceeds the limit`, plan.tiles.every((t) => t.bw <= maxTile + 2 * plan.bleed + 2 && t.bh <= maxTile + 2 * plan.bleed + 2), plan.tiles.map((t) => `${t.bw}x${t.bh}`).join(' '))
    check(`${label}: rendered rects stay inside the master`, plan.tiles.every((t) => t.bx >= 0 && t.by >= 0 && t.bx + t.bw <= plan.masterW + 1 && t.by + t.bh <= plan.masterH + 1))
    check(`${label}: encoders get even dimensions`, plan.tiles.every((t) => t.bw % 2 === 0 && t.bh % 2 === 0), plan.tiles.map((t) => `${t.bw}x${t.bh}`).join(' '))
    check(`${label}: interior tiles carry bleed on the shared edges`, plan.tiles.every((t) => (t.x === 0 ? t.bx === 0 : t.bx <= t.x - plan.bleed) && (t.x + t.w >= plan.masterW ? true : t.bx + t.bw >= t.x + t.w + plan.bleed)))
    // every screen is drawn by someone, and only by tiles it actually touches
    const drawn = new Set<number>()
    for (const t of plan.tiles) for (const { s } of screensForTile(plan, t)) drawn.add(s.i)
    check(`${label}: every screen lands in a tile`, drawn.size === plan.screens.length, `${drawn.size}/${plan.screens.length}`)
    const stray = plan.tiles.some((t) => screensForTile(plan, t).some(({ s }) => s.x + s.w <= t.bx || s.x >= t.bx + t.bw || s.y + s.h <= t.by || s.y >= t.by + t.bh))
    check(`${label}: no tile is handed a screen it cannot see`, !stray)
  }
}

// ---- cuts should prefer the gaps between screens, where a seam is invisible ----
{
  const { c, g, plan } = build({ gridMode: 'manual', rows: 3, cols: 11, cellAspect: 'tall', wallFit: 'cover', gap: 16, featured: 2 }, 6, 3000)
  const gapCentres = Array.from({ length: g.cols - 1 }, (_, i) => (i * (g.cellW + c.gap) + g.cellW + c.gap / 2) * plan.scale)
  const cuts = plan.tiles.filter((t) => t.iy === 0 && t.ix > 0).map((t) => t.x)
  const onGap = cuts.filter((x) => gapCentres.some((gc) => Math.abs(gc - x) <= c.gap * plan.scale * 0.5 + 1))
  check('vertical cuts land inside the gaps between screens', cuts.length > 0 && onGap.length === cuts.length, `${onGap.length}/${cuts.length} cuts at ${cuts.join(',')}`)
}

// ---- the master is exactly the wall at the requested zoom ----
{
  for (const zoom of [1, 2.5, 6, 12]) {
    const { g, plan } = build({ gridMode: 'manual', rows: 4, cols: 6, cellAspect: 'fill', featured: 1 }, zoom)
    check(`zoom ${zoom}x: master matches the wall`, Math.abs(plan.masterW - g.wallW * zoom) <= 1 && Math.abs(plan.masterH - g.wallH * zoom) <= 1, `${plan.masterW}x${plan.masterH} vs ${Math.round(g.wallW * zoom)}x${Math.round(g.wallH * zoom)}`)
    check(`zoom ${zoom}x: a cell is the source cell scaled`, plan.screens.every((s) => Math.abs(s.w - g.cellW * zoom) < 0.01 && Math.abs(s.h - g.cellH * zoom) < 0.01))
  }
  const { c, g } = build({ gridMode: 'manual', rows: 3, cols: 11, cellAspect: 'tall', wallFit: 'cover', featured: 2 })
  const z = fillZoom(c, g)
  check('the default zoom shows a whole screen, not a crop of one', Math.abs(z - Math.min(c.compW / g.cellW, c.compH / g.cellH)) < 1e-9 && g.cellH * z <= c.compH + 0.01 && g.cellW * z <= c.compW + 0.01, `${z.toFixed(2)}x`)
}

// ---- fuzz: whatever the wall, the tiles must still tile it ----
{
  let s = 99
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
  let bad = 0
  let worst = ''
  for (let i = 0; i < 3000; i++) {
    const c = cfg({
      gridMode: pick(['auto', 'manual'] as const),
      rows: 1 + Math.floor(rnd() * 30),
      cols: 1 + Math.floor(rnd() * 30),
      gap: pick([0, 1, 8, 21.08, 80]),
      margin: pick([0, 40, 400]),
      compW: pick([640, 1080, 1920, 3840]),
      compH: pick([360, 1080, 1920, 2160]),
      cellAspect: pick(['fill', 'wide', 'tv', 'square', 'tall'] as const),
      wallFit: pick(['contain', 'cover'] as const),
      centerFit: pick(['grid', 'shift'] as const),
      featured: pick([-1, 0, 3]),
      intro: pick(['none', 'zoomOut'] as const),
      videos: Array.from({ length: 1 + Math.floor(rnd() * 60) }, (_, k) => `/v/${k}.mp4`),
    })
    const g = gridFor(c)
    const plan = planTiles(c, g, planScreens(c, g), pick([1, 2, fillZoom(c, g), 20]), pick([1024, 4096, 8192]))
    const area = plan.tiles.reduce((n, t) => n + t.w * t.h, 0)
    const ok =
      area === plan.masterW * plan.masterH &&
      plan.tiles.every((t) => t.w > 0 && t.h > 0 && t.bw % 2 === 0 && t.bh % 2 === 0 && t.bx >= 0 && t.by >= 0) &&
      plan.tiles.length === plan.cols * plan.rows &&
      Number.isFinite(plan.megapixels)
    if (!ok && bad === 0) worst = JSON.stringify({ rows: g.rows, cols: g.cols, gap: c.gap, comp: [c.compW, c.compH], master: [plan.masterW, plan.masterH], tiles: plan.tiles.length, area, want: plan.masterW * plan.masterH })
    if (!ok) bad++
  }
  check('fuzz: 3000 random walls all tile exactly', bad === 0, `${bad} bad — first: ${worst}`)
}

if (failures) {
  console.error(`\n✗ ${failures} tile failure(s)`)
  process.exit(1)
}
console.log('\n✓ all tile tests passed')
