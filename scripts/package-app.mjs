#!/usr/bin/env node
/** Package the desktop app into ~/Downloads as a double-clickable .app. */
import { packager } from '@electron/packager'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stage = join(root, '.app-build')
const out = join(homedir(), 'Downloads')

// a tiny app-only tree so Electron doesn't ship the whole repo
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(join(root, 'app'), join(stage, 'app'), { recursive: true })

writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify({ name: 'wallmaker', productName: 'Wallmaker', version: '1.0.0', main: 'app/main.mjs', type: 'module', description: 'Walls of videos for After Effects', author: 'Wallmaker' }, null, 2),
)

const appPath = join(out, 'Wallmaker.app')
if (existsSync(appPath)) rmSync(appPath, { recursive: true, force: true })

const paths = await packager({
  dir: stage,
  out,
  overwrite: true,
  platform: 'darwin',
  arch: process.arch === 'arm64' ? 'arm64' : 'x64',
  name: 'Wallmaker',
  appBundleId: 'com.wallmaker.app',
  appCategoryType: 'public.app-category.video',
  icon: existsSync(join(root, 'app/icon.icns')) ? join(root, 'app/icon.icns') : undefined,
  prune: false,
  quiet: true,
})

// packager makes ~/Downloads/Wallmaker-darwin-arm64/Wallmaker.app — lift it up one level.
// MOVE it, never copy: an Electron bundle is full of symlinks (Frameworks/Electron Framework)
// and a plain recursive copy silently produces an app that cannot start.
const built = join(paths[0], 'Wallmaker.app')
renameSync(built, appPath)
rmSync(paths[0], { recursive: true, force: true })
rmSync(stage, { recursive: true, force: true })

// no quarantine flag, so double-clicking never hits "unidentified developer".
// NOTE: do NOT `codesign --deep` an Electron app -- it re-signs the outer binary but leaves the
// framework on its own identity and macOS then refuses to load it ("different Team IDs"). The
// packager's own ad-hoc linker signature is correct; leave it alone.
try {
  execFileSync('xattr', ['-cr', appPath])
} catch {
  /* nothing to clear */
}

// Prove the bundle actually launches. A broken .app (missing framework, bad signature) looks
// perfectly fine on disk and only fails when you double-click it.
const bin = join(appPath, 'Contents/MacOS/Wallmaker')
const probe = spawn(bin, ['--remote-debugging-port=9399'], { stdio: ['ignore', 'ignore', 'pipe'] })
let stderr = ''
probe.stderr.on('data', (d) => { stderr += d.toString() })
let alive = false
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500))
  try {
    const res = await fetch('http://127.0.0.1:9399/json')
    if (res.ok) { alive = true; break }
  } catch {
    /* not up yet */
  }
  if (probe.exitCode !== null) break
}
try { probe.kill('SIGTERM') } catch { /* already gone */ }
if (!alive) {
  console.error(`✗ ${appPath} was built but does not launch:\n${stderr.split('\n').slice(0, 6).join('\n')}`)
  process.exit(1)
}
console.log(`✓ ${appPath} — launches cleanly`)
