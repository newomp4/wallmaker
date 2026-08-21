/**
 * Wallmaker desktop. The same panel UI, outside After Effects, with ffmpeg doing the heavy work
 * and AppleScript handing the result straight to AE.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
// the PROCESS is called "After Effects" whatever the year; the APPLICATION (what `tell application`
// wants, and what `open -a` wants) is "Adobe After Effects <year>". They are not the same string.
const AE_PROCESS = 'After Effects'
const FFMPEG_PATHS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg', 'ffmpeg']
const FFPROBE_PATHS = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/opt/local/bin/ffprobe', 'ffprobe']

let win = null
let renderer = null
let hostPath = ''

/**
 * ExtendScript cannot read inside app.asar, so the host script is written out to a real file once
 * at startup and After Effects is pointed at that.
 */
function unpackHost() {
  try {
    hostPath = join(app.getPath('userData'), 'host.jsx')
    mkdirSync(dirname(hostPath), { recursive: true })
    writeFileSync(hostPath, readFileSync(join(here, 'host.jsx'), 'utf8'), 'utf8')
  } catch {
    hostPath = ''
  }
}

function findTool(candidates) {
  for (const c of candidates) {
    try {
      if (c.includes('/') ? existsSync(c) : true) {
        return c
      }
    } catch {
      /* keep looking */
    }
  }
  return candidates[candidates.length - 1]
}

/** The newest installed After Effects, by bundle name. */
function aeInstalled() {
  try {
    const found = readdirSync('/Applications').filter((n) => /^Adobe After Effects/.test(n))
    found.sort()
    return found.length ? found[found.length - 1] : null
  } catch {
    return null
  }
}

async function aeRunning() {
  try {
    const { stdout } = await run('osascript', ['-e', `tell application "System Events" to return exists application process "${AE_PROCESS}"`])
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/** The application name to talk to, launching After Effects first if it is not already up. */
async function aeName({ launch = false } = {}) {
  const installed = aeInstalled()
  if (await aeRunning()) return installed ?? 'Adobe After Effects 2025'
  if (!launch || !installed) return null
  await run('open', ['-a', installed]).catch(() => {})
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (await aeRunning()) return installed
  }
  return null
}

/**
 * Run ExtendScript in AE and get the reply back, via a temp file (DoScript's own return value is
 * not usable from AppleScript).
 *
 * The code is `eval`ed at the top level, exactly like CEP's evalScript: the value of the last
 * expression is the reply, and any `var` the code declares lands in the global scope. Wrapping it
 * in a function instead would swallow the reply and hide the host script's globals.
 */
async function aeEval(code) {
  const name = await aeName({ launch: true })
  if (!name) throw new Error('Could not reach After Effects. Open it and try again.')
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const out = join(tmpdir(), `wallmaker-reply-${stamp}.json`)
  const jsx = join(tmpdir(), `wallmaker-call-${stamp}.jsx`)
  writeFileSync(
    jsx,
    `var __wmOut;\ntry { __wmOut = eval(${JSON.stringify(code)}); } catch (e) { __wmOut = '{"error":' + JSON.stringify(String(e && e.message ? e.message : e)) + '}'; }\n` +
      `var __wmF = new File(${JSON.stringify(out)}); __wmF.encoding='UTF-8'; __wmF.open('w'); __wmF.write(String(__wmOut === undefined ? '' : __wmOut)); __wmF.close();`,
    'utf8',
  )
  await run('osascript', ['-e', 'with timeout of 3600 seconds', '-e', `tell application "${name}" to DoScript "$.evalFile(\\"${jsx}\\")"`, '-e', 'end timeout'], { maxBuffer: 1 << 24 })
  for (let i = 0; i < 3600; i++) {
    if (existsSync(out)) {
      const txt = readFileSync(out, 'utf8')
      try { rmSync(out, { force: true }); rmSync(jsx, { force: true }) } catch { /* leave the temp files */ }
      return txt
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('After Effects did not reply in time.')
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  win.loadFile(join(here, 'dist/index.html'))
  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  unpackHost()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ---------------------------------------------------------------- filesystem
ipcMain.on('fs:readdir', (e, p) => {
  try {
    e.returnValue = { err: 0, data: readdirSync(p) }
  } catch {
    e.returnValue = { err: 1, data: [] }
  }
})
ipcMain.on('fs:stat', (e, p) => {
  try {
    const s = statSync(p)
    e.returnValue = { err: 0, dir: s.isDirectory(), file: s.isFile() }
  } catch {
    e.returnValue = { err: 1, dir: false, file: false }
  }
})
ipcMain.on('fs:write', (e, p, t) => {
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, t, 'utf8')
    e.returnValue = { err: 0 }
  } catch (err) {
    e.returnValue = { err: 1, message: String(err) }
  }
})
ipcMain.on('fs:mkdirp', (e, p) => {
  try {
    mkdirSync(p, { recursive: true })
    e.returnValue = { err: 0 }
  } catch {
    e.returnValue = { err: 1 }
  }
})
ipcMain.on('sys:path', (e, kind) => {
  const map = { userData: app.getPath('userData'), myDocuments: app.getPath('documents'), extension: here, hostApplication: '', downloads: app.getPath('downloads'), host: hostPath }
  e.returnValue = map[kind] ?? homedir()
})

// ---------------------------------------------------------------- dialogs
ipcMain.on('pick:folder', (e, title, initial) => {
  const r = dialog.showOpenDialogSync(win, { title, defaultPath: initial || homedir(), properties: ['openDirectory', 'createDirectory'] })
  e.returnValue = r && r.length ? r[0] : null
})
ipcMain.on('pick:files', (e, title, initial, exts) => {
  const r = dialog.showOpenDialogSync(win, { title, defaultPath: initial || homedir(), properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video', extensions: exts && exts.length ? exts : ['mp4', 'mov'] }] })
  e.returnValue = r ?? []
})
ipcMain.on('shell:reveal', (_e, p) => { try { shell.showItemInFolder(p) } catch { /* ignore */ } })

// ---------------------------------------------------------------- After Effects
ipcMain.handle('ae:available', async () => ({ name: await aeName(), installed: aeInstalled() }))
ipcMain.handle('ae:eval', async (_e, code) => aeEval(code))

// ---------------------------------------------------------------- tools + tiles
ipcMain.handle('tools:probe', async () => {
  const ffmpeg = findTool(FFMPEG_PATHS)
  const ffprobe = findTool(FFPROBE_PATHS)
  let version = ''
  try {
    const { stdout } = await run(ffmpeg, ['-version'])
    version = stdout.split('\n')[0]
  } catch {
    version = ''
  }
  return { ffmpeg, ffprobe, version, ae: await aeName(), aeInstalled: aeInstalled() }
})

ipcMain.handle('tiles:cancel', () => {
  if (renderer) { renderer.cancelled = true; renderer.procs.forEach((p) => { try { p.kill('SIGTERM') } catch { /* gone */ } }) }
  return true
})

ipcMain.handle('tiles:render', async (_e, cfg, outDir, opts = {}) => {
  const { renderTiles } = await import('./render.mjs')
  renderer = { cancelled: false, procs: new Set() }
  mkdirSync(outDir, { recursive: true })
  try {
    const r = await renderTiles(cfg, outDir, {
      ...opts,
      ffmpeg: findTool(FFMPEG_PATHS),
      ffprobe: findTool(FFPROBE_PATHS),
      onProgress: (p) => { if (win && !win.isDestroyed()) win.webContents.send('tiles:progress', p) },
      shouldCancel: () => renderer?.cancelled,
      track: (proc) => renderer?.procs.add(proc),
    })
    return { ok: !r.errors.length, ...r, cancelled: !!renderer?.cancelled }
  } catch (err) {
    return { ok: false, errors: [String(err && err.message ? err.message : err)] }
  } finally {
    renderer = null
  }
})
