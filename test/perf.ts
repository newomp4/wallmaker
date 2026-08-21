/** How long the shared math takes at scale — the panel re-runs all of this on every config change. */
import { DEFAULT_CONFIG } from '../src/core/defaults.ts'
import type { Config } from '../src/core/types.ts'
import { gridFor, fillGrid, offscreenCount } from '../src/core/grid.ts'
import { planScreens, planCamera, screenStateAt, withAnimation } from '../src/core/reveal.ts'
import { compileWall } from '../src/core/scene.ts'

const ms = (f: () => void, n = 1) => {
  const t = performance.now()
  for (let i = 0; i < n; i++) f()
  return (performance.now() - t) / n
}
const cfg = (p: Partial<Config>): Config => ({ ...DEFAULT_CONFIG, videos: Array.from({ length: 130 }, (_, i) => `/v/${i}.mp4`), ...p })

console.log('cells      plan      camera    compile   1 frame   total/change')
for (const [rows, cols] of [[5, 5], [10, 13], [20, 30], [40, 40], [64, 64]] as const) {
  const c = withAnimation(cfg({ gridMode: 'manual', rows, cols, animate: true, featured: 3, intro: 'zoomOut' }))
  const g = gridFor(c)
  let screens = planScreens(c, g)
  const tPlan = ms(() => { screens = planScreens(c, g) }, 5)
  const tCam = ms(() => planCamera(c, g, screens), 20)
  const tComp = ms(() => compileWall(c, { grid: g, screens }), 3)
  const tFrame = ms(() => { for (const s of screens) screenStateAt(3.1, s, c) }, 10)
  console.log(
    `${String(rows * cols).padEnd(10)} ${tPlan.toFixed(1).padStart(6)}ms  ${tCam.toFixed(2).padStart(6)}ms  ${tComp.toFixed(1).padStart(6)}ms  ${tFrame.toFixed(2).padStart(6)}ms  ${(tPlan + tCam + tFrame).toFixed(1).padStart(7)}ms`,
  )
}
console.log('\nfillGrid (searches 40x40 or 64x64 grids):', ms(() => fillGrid(cfg({ cellAspect: 'tall', gridMode: 'manual', rows: 9, cols: 9 })), 20).toFixed(2) + 'ms')
console.log('offscreenCount at 64x64:', ms(() => { const c = cfg({ gridMode: 'manual', rows: 64, cols: 64, cellAspect: 'tall', wallFit: 'cover' }); offscreenCount(c, gridFor(c)) }, 20).toFixed(2) + 'ms')
