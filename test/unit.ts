/**
 * Unit tests for the shared core (the math both the preview and the AE build trust).
 * Run: npx tsx test/unit.ts   (also wired as `npm run test:unit`)
 */
import { DEFAULT_CONFIG } from '../src/core/defaults.ts'
import type { Config } from '../src/core/types.ts'
import { gridFor, autoGrid, aspectOf, bandsFor, fillGrid, cellOnscreen, offscreenCount } from '../src/core/grid.ts'
import { planScreens, planCamera, cameraAt, zoomAt, screenStateAt, withAnimation, centerCell } from '../src/core/reveal.ts'
import { compileWall, buildKeyFor } from '../src/core/scene.ts'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++
    console.error(` ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  } else console.log(` ✓ ${name}`)
}
const cfg = (p: Partial<Config>): Config => ({ ...DEFAULT_CONFIG, videos: Array.from({ length: 12 }, (_, i) => `/v/${i}.mp4`), ...p })

// ---- determinism ----
{
  const a = planScreens(cfg({ seed: 42, reveal: 'random', deadPct: 20 }))
  const b = planScreens(cfg({ seed: 42, reveal: 'random', deadPct: 20 }))
  check('planScreens is deterministic per seed', JSON.stringify(a) === JSON.stringify(b))
  const c = planScreens(cfg({ seed: 43, reveal: 'random', deadPct: 20 }))
  check('a different seed changes the plan', JSON.stringify(a) !== JSON.stringify(c))
}

// ---- grid ----
{
  const g = gridFor(cfg({ gridMode: 'manual', rows: 4, cols: 5, gap: 6, margin: 0, compW: 1920, compH: 1080, cellAspect: 'wide' }))
  check('locked 16:9 cells are 16:9', Math.abs(g.cellW / g.cellH - 16 / 9) < 0.001, `${g.cellW}x${g.cellH}`)
  check('locked wall fits the comp', g.wallW <= 1920.01 && g.wallH <= 1080.01)
  const auto = autoGrid(12, 1920, 1080, 6, 0, aspectOf(cfg({ cellAspect: 'fill' })))
  check('auto grid covers all sources', auto.rows * auto.cols >= 12)
  const one = gridFor(cfg({ videos: ['/v/a.mp4'], gridMode: 'auto' }))
  check('1-source grid is 1x1', one.rows === 1 && one.cols === 1)
}

// ---- filling the comp edge to edge ----
{
  const locked = cfg({ gridMode: 'manual', rows: 5, cols: 5, cellAspect: 'wide', gap: 8, margin: 0, compW: 1920, compH: 1080 })
  const b = bandsFor(locked)
  check('locked cells leave letterbox bands', b.x > 1 || b.y > 1, JSON.stringify(b))
  const filled = { ...locked, ...fillGrid(locked) }
  const b2 = bandsFor(filled)
  check('fillGrid reaches the comp edges', b2.x <= 1 && b2.y <= 1, JSON.stringify(b2))
  const g2 = gridFor(filled)
  check('fillGrid keeps cells near the shape asked for', Math.abs(g2.cellW / g2.cellH / (16 / 9) - 1) < 0.14, `${(g2.cellW / g2.cellH).toFixed(3)}`)
  check('fillGrid stays near the screen count asked for', Math.abs(g2.rows * g2.cols - 25) <= 12, `${g2.rows}x${g2.cols}`)
  const already = cfg({ gridMode: 'manual', rows: 3, cols: 4, cellAspect: 'fill' })
  const b3 = bandsFor(already)
  check('stretched cells always fill the comp', b3.x <= 1 && b3.y <= 1)

  // a locked shape must SURVIVE filling the comp -- the gap moves, the cells keep their ratio
  for (const [shape, want] of [['tall', 9 / 16], ['square', 1], ['tv', 4 / 3], ['wide', 16 / 9]] as const) {
    const c = cfg({ gridMode: 'manual', rows: 4, cols: 5, cellAspect: shape, gap: 8, margin: 0, compW: 1920, compH: 1080 })
    const filled = { ...c, ...fillGrid(c) }
    const gg = gridFor(filled)
    const bb = bandsFor(filled)
    check(`fill keeps ${shape} cells exactly and reaches the edges`, filled.cellAspect === shape && Math.abs(gg.cellW / gg.cellH / want - 1) < 0.002 && bb.x <= 1 && bb.y <= 1, `${gg.rows}x${gg.cols} gap ${filled.gap} cells ${gg.cellW.toFixed(1)}x${gg.cellH.toFixed(1)} bands ${JSON.stringify(bb)}`)
  }
  // vertical comp too (the gap can need to move on the other axis)
  const vert = cfg({ gridMode: 'manual', rows: 5, cols: 3, cellAspect: 'wide', gap: 6, margin: 0, compW: 1080, compH: 1920 })
  const vfill = { ...vert, ...fillGrid(vert) }
  const vg = gridFor(vfill)
  const vb = bandsFor(vfill)
  check('fill works on a vertical comp', vfill.cellAspect === 'wide' && Math.abs(vg.cellW / vg.cellH / (16 / 9) - 1) < 0.002 && vb.x <= 1 && vb.y <= 1, `${vg.rows}x${vg.cols} gap ${vfill.gap}`)
}

// ---- a centred screen must actually be in the centre ----
{
  for (const [rows, cols, shape, fit] of [
    [3, 9, 'tall', 'contain'],
    [3, 9, 'tall', 'cover'],
    [4, 5, 'wide', 'contain'],
    [4, 4, 'fill', 'contain'],
    [6, 6, 'fill', 'contain'],
  ] as const) {
    const c = cfg({ gridMode: 'manual', rows, cols, cellAspect: shape, wallFit: fit, gap: 8, featured: 0, videos: Array.from({ length: 8 }, (_, i) => `/v/${i}.mp4`) })
    const g = gridFor(c)
    const s = planScreens(c, g)
    const f = s.find((x) => x.featured)!
    const dx = (f.col - (g.cols - 1) / 2) * (g.cellW + c.gap)
    const dy = (f.row - (g.rows - 1) / 2) * (g.cellH + c.gap)
    check(`centred ${rows}x${cols} ${shape}/${fit}: the pinned screen sits dead centre`, Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01, `${g.rows}x${g.cols} offset ${dx.toFixed(1)},${dy.toFixed(1)}`)
    check(`centred ${rows}x${cols} ${shape}/${fit}: odd grid`, g.rows % 2 === 1 && g.cols % 2 === 1, `${g.rows}x${g.cols}`)
  }
  // a camera move with NO pinned source still needs its target dead centre
  const cam = cfg({ gridMode: 'manual', rows: 4, cols: 6, cellAspect: 'fill', gap: 10, featured: -1, intro: 'zoomOut' })
  const cg = gridFor(cam)
  const cs = planScreens(cam, cg)
  const plan = planCamera(cam, cg, cs)!
  const tgt = cs[plan.target]
  const tx = (tgt.col - (cg.cols - 1) / 2) * (cg.cellW + cam.gap)
  const ty = (tgt.row - (cg.rows - 1) / 2) * (cg.cellH + cam.gap)
  check("a camera move centres its target even with nothing pinned", Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 && cg.rows % 2 === 1 && cg.cols % 2 === 1, `${cg.rows}x${cg.cols} offset ${tx.toFixed(1)},${ty.toFixed(1)}`)
  // no centred screen and no camera move: the grid is left exactly as asked
  const plain = cfg({ gridMode: 'manual', rows: 4, cols: 4, cellAspect: 'fill', featured: -1, intro: 'none', outro: 'none' })
  check('nothing targeted: the grid is untouched', gridFor(plain).rows === 4 && gridFor(plain).cols === 4)
  // and "Fit exactly" must not undo it -- it can only propose odd grids while one is centred
  const locked = cfg({ gridMode: 'manual', rows: 5, cols: 5, cellAspect: 'wide', gap: 8, featured: 0, videos: ['/v/a.mp4', '/v/b.mp4'] })
  const fitted = { ...locked, ...fillGrid(locked) }
  const fg = gridFor(fitted)
  const fb = bandsFor(fitted, fg)
  check('fit-exactly stays flush with a centre screen', fb.x <= 1 && fb.y <= 1 && fg.rows % 2 === 1 && fg.cols % 2 === 1, `${fg.rows}x${fg.cols} gap ${fitted.gap} bands ${JSON.stringify(fb)}`)
}

// ---- 'cover': keep the cell shape, let the outer screens run off the frame ----
{
  for (const [shape, want, w, h, rows, cols] of [
    ['tall', 9 / 16, 1920, 1080, 3, 9],
    ['wide', 16 / 9, 1080, 1920, 5, 3],
    ['square', 1, 1920, 1080, 4, 4],
  ] as const) {
    const c = cfg({ gridMode: 'manual', rows, cols, cellAspect: shape, wallFit: 'cover', gap: 8, margin: 0, compW: w, compH: h, videos: Array.from({ length: 8 }, (_, i) => `/v/${i}.mp4`) })
    const g = gridFor(c)
    const b = bandsFor(c, g)
    check(`cover ${shape}: cells keep their exact shape`, Math.abs(g.cellW / g.cellH / want - 1) < 0.002, (g.cellW / g.cellH).toFixed(4))
    check(`cover ${shape}: the wall reaches past both comp edges`, g.wallW >= w - 0.5 && g.wallH >= h - 0.5, `${Math.round(g.wallW)}x${Math.round(g.wallH)}`)
    check(`cover ${shape}: no bands`, b.x === 0 && b.y === 0)
    check(`cover ${shape}: only grows the grid, never shrinks it`, g.rows >= rows && g.cols >= cols, `${g.rows}x${g.cols}`)
    const screens = planScreens(c, g)
    const visible = screens.filter((s) => cellOnscreen(s.row, s.col, c, g))
    check(`cover ${shape}: every source is visible in frame`, new Set(visible.map((s) => s.v)).size === 8, `${new Set(visible.map((s) => s.v)).size}/8`)
    check(`cover ${shape}: the cut-off cells are the duplicates`, screens.length - visible.length === offscreenCount(c, g) && offscreenCount(c, g) > 0)
  }
  // stretched cells already cover exactly, so 'cover' must be a no-op there
  const fillA = cfg({ gridMode: 'manual', rows: 3, cols: 5, cellAspect: 'fill', wallFit: 'contain' })
  const fillB = { ...fillA, wallFit: 'cover' as const }
  check('cover does nothing to stretched cells', JSON.stringify(gridFor(fillA)) === JSON.stringify(gridFor(fillB)))
}

// ---- reveal patterns ----
{
  const base = { animate: true, gridMode: 'manual' as const, rows: 5, cols: 5, jitter: 0 }
  for (const mode of ['random', 'rows', 'cols', 'sequence', 'snake', 'center', 'spiral', 'edges', 'diagonal'] as const) {
    const s = planScreens(cfg({ ...base, reveal: mode }))
    const ths = s.map((x) => x.th)
    check(`${mode}: every screen gets a distinct threshold`, new Set(ths).size === ths.length && Math.min(...ths) > 0 && Math.max(...ths) < 100)
  }
  const spiral = planScreens(cfg({ ...base, reveal: 'spiral' }))
  const first = spiral.slice().sort((a, b) => a.th - b.th)[0]
  check('spiral starts at the middle', Math.abs(first.row - 2) <= 1 && Math.abs(first.col - 2) <= 1, `${first.row},${first.col}`)
  const snake = planScreens(cfg({ ...base, reveal: 'snake' }))
  const byTh = snake.slice().sort((a, b) => a.th - b.th)
  check('snake runs row 0 left→right then row 1 right→left', byTh[0].row === 0 && byTh[0].col === 0 && byTh[4].col === 4 && byTh[5].row === 1 && byTh[5].col === 4)
}

// ---- duplicates when there are fewer sources than screens ----
{
  const c = cfg({ videos: ['/v/a.mp4', '/v/b.mp4', '/v/c.mp4'], gridMode: 'manual', rows: 4, cols: 5, assign: 'shuffle', featured: -1 })
  const s = planScreens(c)
  check('every cell gets a source', s.length === 20 && s.every((x) => x.v >= 0 && x.v < 3))
  const counts = [0, 0, 0]
  for (const x of s) counts[x.v]++
  check('shuffle spreads the duplicates evenly', Math.max(...counts) - Math.min(...counts) <= 1, counts.join('/'))
  check('duplicates are scattered, not in blocks', s.slice(0, 5).map((x) => x.v).join('') !== '01201')
  const offs = s.filter((x) => x.v === 0).map((x) => x.offset).sort((a, b) => a - b)
  check('same-source screens all start at different points', new Set(offs).size === counts[0], offs.join(' '))
  const minGap = Math.min(...offs.slice(1).map((v, i) => v - offs[i]))
  check('and are spread across the clip, not clustered', minGap > 0.2 / counts[0], `min gap ${minGap.toFixed(4)}`)
}

// ---- thresholds & the centered screen ----
{
  const c = cfg({ reveal: 'random', animate: true, featured: 3, gridMode: 'manual', rows: 4, cols: 5 })
  const g = gridFor(c)
  const s = planScreens(c, g)
  const feat = s.filter((x) => x.featured)
  check('exactly one centered screen', feat.length === 1)
  check('every cell is one screen', s.length === g.rows * g.cols)
  const ctr = centerCell(g)
  check('centered screen sits in the middle cell', feat[0].row === ctr.row && feat[0].col === ctr.col, `${feat[0].row},${feat[0].col}`)
  check('centered screen plays source 3 from its start', feat[0].v === 3 && feat[0].offset === 0)
  const others = s.filter((x) => !x.featured)
  check('centered source is out of the rotation', others.every((x) => x.v !== 3))
  const ths = others.map((x) => x.th).sort((a, b) => a - b)
  check('thresholds spread across (0,100)', ths[0] > 0 && ths[ths.length - 1] < 100 && new Set(ths).size === ths.length)
  check('centered screen is on before the reveal starts', screenStateAt(0, feat[0], withAnimation(cfg({ animate: true, revealStart: 2 }))).opacity === 1)
}

// ---- screen state edges ----
{
  const c = withAnimation(cfg({ animate: true, reveal: 'random', revealStart: 1, revealDuration: 4, screenAnim: 'fade', screenAnimFrames: 6, fps: 30 }))
  const spec = { i: 0, row: 0, col: 0, v: 0, th: 50, dead: 1, offset: 0 }
  const on = 1 + 0.5 * 4
  check('off before its moment', screenStateAt(on - 0.05, spec, c).opacity === 0)
  check('fully on after the fade', screenStateAt(on + 6 / 30 + 0.01, spec, c).opacity === 1)
  check('dead screens stay dark', screenStateAt(9, { ...spec, dead: 0.01 }, { ...c, deadPct: 5 }).opacity === 0)
  const base = withAnimation(cfg({ animate: false, revealStart: 5 }))
  check('animation off = simply on from 0', screenStateAt(0, { ...spec, th: 90 }, base).opacity === 1)
}

// ---- camera: clamping + the zoom curve the AE keyframes drive ----
{
  const c = cfg({ gridMode: 'manual', rows: 4, cols: 5, intro: 'zoomOut', introHold: 10, introDur: 20, outro: 'zoomIn', outroHold: 1, outroDur: 4, durationSec: 12 })
  const g = gridFor(c)
  const cam = planCamera(c, g, planScreens(c, g))!
  check('intro hold clamped inside the comp', cam.intro!.hold <= 12 - 0.2 + 1e-9, String(cam.intro!.hold))
  check('intro end clamped to the comp', cam.intro!.end <= 12)
  check('outro pushed past the intro', !cam.outro || cam.outro.start >= cam.intro!.end + 0.1 - 1e-9)
  check('zoom is 100% at t=0', zoomAt(0, cam) === 1)
  check('zoomed at t=0', Math.abs(cameraAt(0, cam, 12).k - cam.scale / 100) < 1e-6)
  const c2 = cfg({ intro: 'zoomOut', introHold: 1, introDur: 2, durationSec: 10, gridMode: 'manual', rows: 3, cols: 4 })
  const g2 = gridFor(c2)
  const cam2 = planCamera(c2, g2, planScreens(c2, g2))!
  check('neutral after the pull-back', cameraAt(3.01, cam2, 10).k === 1 && zoomAt(3.01, cam2) === 0)
  check('holds zoomed through the hold', cameraAt(0.99, cam2, 10).k === cam2.scale / 100)
  // the zoomed camera must put the target screen dead center, at the comp's own size
  const zoomed = cameraAt(0, cam2, 10)
  const target = planScreens(c2, g2)[cam2.target]
  const tx = (target.col - (g2.cols - 1) / 2) * (g2.cellW + c2.gap)
  const ty = (target.row - (g2.rows - 1) / 2) * (g2.cellH + c2.gap)
  check('target screen is centered when zoomed', Math.abs(zoomed.x + zoomed.k * tx) < 0.01 && Math.abs(zoomed.y + zoomed.k * ty) < 0.01)
  check('target screen fills the comp when zoomed', Math.abs(g2.cellW * zoomed.k - c2.compW) < 6 || Math.abs(g2.cellH * zoomed.k - c2.compH) < 6)
  // with no move configured the rig still exists, it just sits neutral
  const c3 = cfg({ intro: 'none', outro: 'none' })
  const g3 = gridFor(c3)
  const cam3 = planCamera(c3, g3, planScreens(c3, g3))!
  check('rig planned even with no move', !!cam3 && cam3.intro === null && cam3.outro === null)
  check('no move = neutral camera at every time', [0, 3, 9].every((t) => cameraAt(t, cam3, 12).k === 1))
}

// ---- scene ----
{
  const w = compileWall(cfg({ gridMode: 'manual', rows: 2, cols: 2, videos: ['/v/a.mp4', '/v/a.mp4', '/v/b.mp4'] }))
  check('duplicate paths dedupe to one source', w.videos.length === 2)
  check('screens reference deduped indices', w.screens.every((s) => s.v < w.videos.length))
  check('buildKey distinguishes case', buildKeyFor('Wall') !== buildKeyFor('wall'))
  const w2 = compileWall(cfg({ animate: false, reveal: 'random', revealStart: 3 }))
  check('animation off compiles to no reveal', w2.reveal.mode === 'none' && w2.reveal.start === 0)
}

if (failures) {
  console.error(`\n✗ ${failures} unit failure(s)`)
  process.exit(1)
}
console.log('\n✓ all unit tests passed')
