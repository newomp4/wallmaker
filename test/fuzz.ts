/**
 * Property fuzz over the shared core: thousands of random configs, asserting the invariants the
 * preview and the AE build both rely on. Anything that trips here would be a wall that renders
 * differently in the panel and in After Effects, or an outright crash in the host.
 * Run: npx tsx test/fuzz.ts   (also `npm run test:fuzz`)
 */
import { DEFAULT_CONFIG } from '../src/core/defaults.ts'
import type { CellAspect, Config } from '../src/core/types.ts'
import { gridFor, bandsFor, fillGrid, wallOffset, offscreenCount, hasCameraTarget, cellOnscreen, aspectOf } from '../src/core/grid.ts'
import { planScreens, planCamera, cameraAt, zoomAt, screenStateAt, withAnimation } from '../src/core/reveal.ts'
import { compileWall } from '../src/core/scene.ts'

let checked = 0
const fails: string[] = []
function bad(msg: string, cfg: Config) {
  if (fails.length < 25) fails.push(`${msg}\n     ${JSON.stringify(pick(cfg))}`)
}
const pick = (c: Config) => ({
  n: c.videos.length + c.comps.length, gridMode: c.gridMode, rows: c.rows, cols: c.cols, gap: c.gap, margin: c.margin,
  compW: c.compW, compH: c.compH, cellAspect: c.cellAspect, cellAspectCustom: c.cellAspectCustom, wallFit: c.wallFit,
  centerFit: c.centerFit, featured: c.featured, intro: c.intro, outro: c.outro, fill: c.fill, animate: c.animate,
  reveal: c.reveal, screenAnim: c.screenAnim, deadPct: c.deadPct, durationSec: c.durationSec, fps: c.fps, seed: c.seed,
})
const finite = (v: number) => Number.isFinite(v)

let s = Number(process.argv[3] ?? 12345) >>> 0 || 12345
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
const pickOne = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

const ASPECTS: CellAspect[] = ['fill', 'wide', 'tv', 'square', 'tall', 'custom']

function randomConfig(): Config {
  const n = pickOne([0, 1, 2, 3, 7, 12, 60, 400])
  return {
    ...DEFAULT_CONFIG,
    videos: Array.from({ length: n }, (_, i) => `/v/${i}.mp4`),
    comps: rnd() < 0.2 ? [{ id: 900, name: 'A comp' }] : [],
    compW: pickOne([16, 128, 640, 1080, 1920, 3840, 16384]),
    compH: pickOne([16, 128, 360, 1080, 1920, 2160, 16384]),
    fps: pickOne([1, 24, 25, 30, 60, 120]),
    durationSec: pickOne([1, 0.2, 8, 12, 600, 3600]),
    gridMode: pickOne(['auto', 'manual'] as const),
    rows: int(1, 64),
    cols: int(1, 64),
    gap: pickOne([0, 1, 6, 21.08, 80, 400]),
    margin: pickOne([0, 10, 60, 400, 5000]),
    fill: pickOne(['cover', 'contain', 'stretch'] as const),
    cornerRadius: pickOne([0, 6, 60]),
    cellAspect: pickOne(ASPECTS),
    cellAspectCustom: pickOne([0.1, 1, 1.7778, 10, 0, -3, NaN]),
    wallFit: pickOne(['contain', 'cover'] as const),
    centerFit: pickOne(['grid', 'shift'] as const),
    assign: pickOne(['sequential', 'shuffle', 'random'] as const),
    randomStart: rnd() < 0.7,
    loop: rnd() < 0.7,
    featured: pickOne([-1, -1, 0, 1, 5, 399, 9999]),
    intro: pickOne(['none', 'zoomOut'] as const),
    introHold: pickOne([0, 1, 30, 1e6]),
    introDur: pickOne([0.1, 2, 100]),
    outro: pickOne(['none', 'zoomIn'] as const),
    outroHold: pickOne([0, 0.4, 50]),
    outroDur: pickOne([0.1, 2, 100]),
    background: pickOne(['solid', 'transparent'] as const),
    animate: rnd() < 0.5,
    reveal: pickOne(['none', 'random', 'rows', 'cols', 'sequence', 'snake', 'center', 'spiral', 'edges', 'diagonal'] as const),
    revealStart: pickOne([0, 0.5, 100]),
    revealDuration: pickOne([0, 3, 1000]),
    screenAnim: pickOne(['cut', 'fade', 'flicker', 'pop'] as const),
    screenAnimFrames: pickOne([1, 8, 60]),
    jitter: pickOne([0, 0.2, 1]),
    deadPct: pickOne([0, 20, 90]),
    seed: int(0, 9999),
  }
}

const ITERS = Number(process.argv[2] ?? 6000)
for (let iter = 0; iter < ITERS; iter++) {
  const raw = randomConfig()
  const cfg = withAnimation(raw)
  const grid = gridFor(cfg)
  checked++

  if (!(grid.rows >= 1 && grid.cols >= 1) || !Number.isInteger(grid.rows) || !Number.isInteger(grid.cols)) bad(`grid ${grid.rows}x${grid.cols}`, raw)
  if (!finite(grid.cellW) || !finite(grid.cellH) || grid.cellW <= 0 || grid.cellH <= 0) bad(`cell ${grid.cellW}x${grid.cellH}`, raw)
  if (!finite(grid.wallW) || !finite(grid.wallH)) bad('wall size not finite', raw)
  if (grid.rows * grid.cols > 262144) bad(`${grid.rows * grid.cols} cells — runaway grid`, raw)

  const aspect = aspectOf(cfg)
  if (aspect !== null && (!finite(aspect) || aspect <= 0)) bad(`aspect ${aspect}`, raw)

  const b = bandsFor(cfg, grid)
  if (!finite(b.x) || !finite(b.y) || b.x < 0 || b.y < 0) bad(`bands ${JSON.stringify(b)}`, raw)
  const off = wallOffset(cfg, grid)
  if (!finite(off[0]) || !finite(off[1])) bad(`wallOffset ${off}`, raw)
  const cut = offscreenCount(cfg, grid)
  if (!Number.isInteger(cut) || cut < 0 || cut > grid.rows * grid.cols) bad(`offscreenCount ${cut}`, raw)

  const screens = planScreens(cfg, grid)
  if (screens.length !== grid.rows * grid.cols) bad(`${screens.length} screens for ${grid.rows}x${grid.cols}`, raw)
  const nv = cfg.videos.length + cfg.comps.length
  for (const sc of screens) {
    if (!finite(sc.th) || sc.th < 0 || sc.th > 100) { bad(`th ${sc.th}`, raw); break }
    if (!finite(sc.offset) || sc.offset < 0 || sc.offset >= 1) { bad(`offset ${sc.offset}`, raw); break }
    if (nv > 0 && (!Number.isInteger(sc.v) || sc.v < 0 || sc.v >= nv)) { bad(`source index ${sc.v} of ${nv}`, raw); break }
    if (sc.row < 0 || sc.row >= grid.rows || sc.col < 0 || sc.col >= grid.cols) { bad(`cell ${sc.row},${sc.col}`, raw); break }
  }
  const feats = screens.filter((x) => x.featured)
  if (cfg.featured >= 0 && nv > 0 ? feats.length !== 1 : feats.length !== 0) bad(`${feats.length} featured screens`, raw)

  const cam = planCamera(cfg, grid, screens)
  if (cam) {
    if (!finite(cam.p[0]) || !finite(cam.p[1]) || !finite(cam.scale) || cam.scale <= 0) bad(`camera p=${cam.p} scale=${cam.scale}`, raw)
    if (cam.intro && !(cam.intro.end > cam.intro.hold && cam.intro.hold >= 0 && cam.intro.end <= cfg.durationSec + 1e-6)) bad(`intro ${JSON.stringify(cam.intro)} dur=${cfg.durationSec}`, raw)
    if (cam.outro && !(cam.outro.end > cam.outro.start && cam.outro.end <= cfg.durationSec + 1e-6)) bad(`outro ${JSON.stringify(cam.outro)} dur=${cfg.durationSec}`, raw)
    if (cam.intro && cam.outro && cam.outro.start < cam.intro.end - 1e-6) bad('outro starts before the intro ends', raw)
    // THE invariant: whatever the camera locks onto must sit dead centre of the comp
    if (hasCameraTarget(cfg) && (Math.abs(cam.p[0]) > 0.02 || Math.abs(cam.p[1]) > 0.02)) bad(`camera target off centre by ${cam.p}`, raw)
    if (hasCameraTarget(cfg) && !cellOnscreen(screens[cam.target].row, screens[cam.target].col, cfg, grid)) bad('camera target is off-frame', raw)
    for (const t of [0, cfg.durationSec / 2, cfg.durationSec]) {
      const st = cameraAt(t, cam, cfg.durationSec)
      const z = zoomAt(t, cam)
      if (!finite(st.k) || st.k <= 0 || !finite(st.x) || !finite(st.y)) { bad(`cameraAt(${t}) = ${JSON.stringify(st)}`, raw); break }
      if (!finite(z) || z < -1e-9 || z > 1 + 1e-9) { bad(`zoomAt(${t}) = ${z}`, raw); break }
    }
  }

  for (const t of [0, 0.37, cfg.durationSec / 2]) {
    const st = screenStateAt(t, screens[0], cfg)
    if (!finite(st.opacity) || st.opacity < 0 || st.opacity > 1 || !finite(st.scale) || st.scale < 0) { bad(`screenStateAt(${t}) = ${JSON.stringify(st)}`, raw); break }
  }

  if (nv > 0) {
    const wall = compileWall(raw)
    if (wall.screens.length !== screens.length) bad('compileWall lost screens', raw)
    for (const w of wall.screens) if (!(w.v >= 0 && w.v < wall.videos.length)) { bad(`compiled source index ${w.v} of ${wall.videos.length}`, raw); break }
    if (!finite(wall.grid.cellW) || !finite(wall.wallOffset[0])) bad('compiled geometry not finite', raw)
  }

  // "Fit exactly" must actually reach the edges when it claims a locked shape can
  if (aspect !== null && cfg.wallFit === 'contain' && nv > 0 && (b.x > 1 || b.y > 1)) {
    const fitted = { ...raw, ...fillGrid(raw) }
    const fb = bandsFor(fitted)
    if (fb.x > 1 || fb.y > 1) {
      const fg = gridFor(fitted)
      // only a genuine failure if a grid of that shape was possible at all
      if (fg.cellW > 8 && fg.cellH > 8 && fitted.cellAspect !== 'fill') bad(`fillGrid left bands ${JSON.stringify(fb)} (${fg.rows}x${fg.cols})`, raw)
    }
  }
}

console.log(`fuzzed ${checked} configs`)
if (fails.length) {
  for (const f of fails) console.error(' ✗ ' + f)
  console.error(`\n✗ ${fails.length} invariant failure(s)`)
  process.exit(1)
}
console.log('✓ all invariants held')
