#!/usr/bin/env node
/** Bundle the tile renderer (and the shared core it pulls in) into plain ESM the app's Node can run. */
import { build } from 'esbuild'
import { cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [join(root, 'scripts/render-tiles.mjs')],
  outfile: join(root, 'app/render.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*'],
  logLevel: 'error',
})
// the app drives the very same ExtendScript the panel does
cpSync(join(root, 'cep/host/index.jsx'), join(root, 'app/host.jsx'))
console.log('✓ app/render.mjs + app/host.jsx')
