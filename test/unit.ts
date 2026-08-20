/**
 * Unit tests for the shared core (the math both the preview and the AE build trust).
 * Run: npx tsx test/unit.ts   (also wired as `npm run test:unit`)
 */
import { DEFAULT_CONFIG } from '../src/core/defaults.ts'
import type { Config } from '../src/core/types.ts'
import { gridFor, autoGrid, aspectOf } from '../src/core/grid.ts'
import { planScreens, planCamera, cameraAt, screenStateAt, withAnimation } from '../src/core/reveal.ts'
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
  const a = planScreens(cfg({ seed: 42, reveal: 'random', heroes: 2, deadPct: 20 }))
  const b = planScreens(cfg({ seed: 42, reveal: 'random', heroes: 2, deadPct: 20 }))
  check('planScreens is deterministic per seed', JSON.stringify(a) === JSON.stringify(b))
  const c = planScreens(cfg({ seed: 43, reveal: 'random', heroes: 2, deadPct: 20 }))
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

// ---- thresholds & featured ----
{
  const s = planScreens(cfg({ reveal: 'random', animate: true, featured: 3, featuredSpan: 2, gridMode: 'manual', rows: 4, cols: 5 }))
  const feat = s.filter((x) => x.featured)
  check('exactly one featured screen', feat.length === 1)
  check('featured spans 2x2 and sits centered', feat[0].span === 2 && feat[0].row >= 1 && feat[0].col >= 1)
  check('featured plays source 3 from its start', feat[0].v === 3 && feat[0].offset === 0)
  const others = s.filter((x) => !x.featured)
  check('featured source is out of the rotation', others.every((x) => x.v !== 3))
  const ths = others.map((x) => x.th).sort((a, b) => a - b)
  check('thresholds spread across (0,100)', ths[0] > 0 && ths[ths.length - 1] < 100 && new Set(ths).size === ths.length)
  check('featured is on before the reveal starts', screenStateAt(0, feat[0], withAnimation(cfg({ animate: true, revealStart: 2 }))).opacity === 1)
}

// ---- screen state edges ----
{
  const c = withAnimation(cfg({ animate: true, reveal: 'random', revealStart: 1, revealDuration: 4, screenAnim: 'fade', screenAnimFrames: 6, fps: 30, dropouts: 0 }))
  const spec = { i: 0, row: 0, col: 0, v: 0, th: 50, dead: 1, offset: 0, span: 1 }
  const on = 1 + 0.5 * 4
  check('off before its moment', screenStateAt(on - 0.05, spec, c).opacity === 0)
  check('fully on after the fade', screenStateAt(on + 6 / 30 + 0.01, spec, c).opacity === 1)
  check('dead screens stay dark', screenStateAt(9, { ...spec, dead: 0.01 }, { ...c, deadPct: 5 }).opacity === 0)
  const base = withAnimation(cfg({ animate: false, revealStart: 5 }))
  check('animation off = simply on from 0', screenStateAt(0, { ...spec, th: 90 }, base).opacity === 1)
}

// ---- camera clamping (host and preview share these numbers by construction) ----
{
  const c = cfg({ gridMode: 'manual', rows: 4, cols: 5, intro: 'zoomOut', introHold: 10, introDur: 20, outro: 'zoomIn', outroHold: 1, outroDur: 4, durationSec: 12 })
  const g = gridFor(c)
  const cam = planCamera(c, g, planScreens(c, g))!
  check('intro hold clamped inside the comp', cam.intro!.hold <= 12 - 0.2 + 1e-9, String(cam.intro!.hold))
  check('intro end clamped to the comp', cam.intro!.end <= 12)
  check('outro pushed past the intro', !cam.outro || cam.outro.start >= cam.intro!.end + 0.1 - 1e-9)
  check('zoomed at t=0', Math.abs(cameraAt(0, cam, 12).k - cam.scale / 100) < 1e-6)
  const c2 = cfg({ intro: 'zoomOut', introHold: 1, introDur: 2, durationSec: 10, gridMode: 'manual', rows: 3, cols: 4 })
  const g2 = gridFor(c2)
  const cam2 = planCamera(c2, g2, planScreens(c2, g2))!
  check('neutral after the pull-back', cameraAt(3.01, cam2, 10).k === 1)
  check('holds zoomed through the hold', cameraAt(0.99, cam2, 10).k === cam2.scale / 100)
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
