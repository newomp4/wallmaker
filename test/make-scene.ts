/** CLI used by the automated tests: config overrides JSON in → wall.json out (same compiler the panel uses). */
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_CONFIG } from '../src/core/defaults.ts'
import { compileWall } from '../src/core/scene.ts'
import { jsonForES3 } from '../src/ae/cep.ts'
import type { Config } from '../src/core/types.ts'

const [cfgPath, outPath] = process.argv.slice(2)
if (!cfgPath || !outPath) {
  console.error('usage: tsx test/make-scene.ts <config-overrides.json> <out-wall.json>')
  process.exit(1)
}
const overrides = JSON.parse(readFileSync(cfgPath, 'utf8')) as Partial<Config>
const cfg: Config = { ...DEFAULT_CONFIG, ...overrides }
// the same escaping the panel uses, so the tests exercise the real bytes the host reads
writeFileSync(outPath, jsonForES3(compileWall(cfg)))
console.log(`wrote ${outPath}`)
