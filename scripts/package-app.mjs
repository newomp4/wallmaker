#!/usr/bin/env node
/** Package the desktop app into ~/Downloads as a double-clickable .app. */
import { packager } from '@electron/packager'
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
console.log(`✓ ${appPath}`)
