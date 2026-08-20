#!/usr/bin/env node
/**
 * Installs the Wallmaker After Effects panel for the current user.
 *   node scripts/install-cep.mjs          copies cep/ into Adobe's CEP extensions folder
 *   node scripts/install-cep.mjs --link   symlinks the repo's cep/ folder instead (rebuilds show up on panel reopen)
 *   node scripts/install-cep.mjs --uninstall
 * Also switches on CEP's PlayerDebugMode so unsigned (self-built) panels are allowed to load.
 * Run `npm run build:cep` first (or use `npm run cep:install`, which does both).
 */
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ID = 'com.wallmaker.panel'
const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..', 'cep')
const args = new Set(process.argv.slice(2))

function extensionsDir() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions')
  throw new Error('After Effects only runs on macOS / Windows')
}

function enableDebugMode() {
  const versions = [9, 10, 11, 12, 13]
  try {
    if (process.platform === 'darwin') {
      for (const v of versions) execSync(`defaults write com.adobe.CSXS.${v} PlayerDebugMode 1`, { stdio: 'ignore' })
      try {
        execSync('killall cfprefsd', { stdio: 'ignore' }) // flush the prefs cache so a running AE picks the flag up
      } catch {
        /* not running */
      }
    } else if (process.platform === 'win32') {
      for (const v of versions) execSync(`reg add HKCU\\Software\\Adobe\\CSXS.${v} /v PlayerDebugMode /t REG_SZ /d 1 /f`, { stdio: 'ignore' })
    }
    console.log('✓ CEP PlayerDebugMode enabled (lets After Effects load this unsigned panel)')
  } catch (e) {
    console.warn('! Could not set PlayerDebugMode automatically:', e.message)
  }
}

const dest = join(extensionsDir(), ID)
if (args.has('--uninstall')) {
  if (existsSync(dest) || isLink(dest)) {
    rmSync(dest, { recursive: true, force: true })
    console.log(`✓ Removed ${dest}`)
  } else console.log(`Nothing installed at ${dest}`)
  process.exit(0)
}
if (!existsSync(join(src, 'client', 'index.html'))) {
  console.error('cep/client is missing — run `npm run build:cep` first.')
  process.exit(1)
}
mkdirSync(dirname(dest), { recursive: true })
if (existsSync(dest) || isLink(dest)) rmSync(dest, { recursive: true, force: true })
if (args.has('--link')) {
  // a junction needs no admin rights / Developer Mode on Windows
  symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(`✓ Linked ${dest} → ${src}`)
} else {
  cpSync(src, dest, { recursive: true, dereference: true })
  console.log(`✓ Installed to ${dest}`)
}
enableDebugMode()
console.log('\nNext: (re)start After Effects → Window ▸ Extensions ▸ Wallmaker')

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}
