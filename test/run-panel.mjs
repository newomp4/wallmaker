#!/usr/bin/env node
/**
 * Full end-to-end test of the REAL panel inside After Effects, driven over the CEF remote-debug
 * port (8724, from cep/.debug). Needs: the panel installed (npm run cep:install), AE restarted,
 * and Window ▸ Extensions ▸ Wallmaker open. Uses the panel's window.__wallmaker debug hooks.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, '.test-assets')
const dir = join(root, '.test-out', 'C')
const PORT = 8724

if (!existsSync(join(assets, 'colors.json'))) execFileSync('node', [join(root, 'scripts/make-test-videos.mjs')], { stdio: 'inherit' })
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const clips = Array.from({ length: 12 }, (_, i) => join(assets, `clip-${String(i + 1).padStart(2, '0')}.mp4`))
const CFG = {
  videos: clips,
  compName: 'Wallmaker test C',
  compW: 1280, compH: 720, fps: 30, durationSec: 8,
  gridMode: 'auto', gap: 10, margin: 24,
  fill: 'cover', cornerRadius: 4, assign: 'sequential', animate: true,
  randomStart: true, loop: true, muteAudio: true, labels: false,
  background: 'dark', bgColor: '#0c0c10',
  reveal: 'rows', revealStart: 0.3, revealDuration: 4,
  screenAnim: 'pop', screenAnimFrames: 8, jitter: 0, deadPct: 0, seed: 5,
}
const TIMES = [0.1, 2.2, 6.5]

// ---- connect to the panel ----
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const target = targets.find((t) => t.webSocketDebuggerUrl && /index\.html/.test(t.url || ''))
if (!target) throw new Error(`No Wallmaker panel page on port ${PORT}. Is the panel open in AE? Targets: ${JSON.stringify(targets.map((t) => t.url))}`)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let msgId = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
function send(method, params, timeoutMs = 30000) {
  const id = ++msgId
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), timeoutMs)
    pending.set(id, (m) => {
      clearTimeout(t)
      if (m.error) rej(new Error(m.error.message))
      else res(m.result)
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJS(expression, { awaitPromise = false, timeoutMs = 30000 } = {}) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, timeoutMs)
  if (r.exceptionDetails) throw new Error(`panel JS error: ${r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)}`)
  return r.result?.value
}

console.log('connected to panel:', target.title || target.url)
const ready = await evalJS('!!window.__wallmaker')
if (!ready) throw new Error('window.__wallmaker missing — is this the Wallmaker panel?')

// drive the UI state exactly as a user would end up with it
await evalJS('window.__wallmaker.reset()')
await new Promise((r) => setTimeout(r, 300))
await evalJS(`window.__wallmaker.patch(${JSON.stringify(CFG)})`)
await new Promise((r) => setTimeout(r, 300))
const scene = await evalJS('window.__wallmaker.scene()')
writeFileSync(join(dir, 'wall.json'), JSON.stringify(scene))
writeFileSync(join(dir, 'config.json'), JSON.stringify(CFG, null, 2))
console.log(`panel plans ${scene.screens.length} screens (${scene.grid.rows}×${scene.grid.cols}) — building…`)

const t0 = Date.now()
const finish = await evalJS('window.__wallmaker.build()', { awaitPromise: true, timeoutMs: 600000 })
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(finish))

const probes = {}
for (const t of TIMES) {
  probes[String(t)] = await evalJS(`window.__wallmaker.callHost('probe', ${JSON.stringify({ compName: CFG.compName, time: t })})`, { awaitPromise: true, timeoutMs: 120000 })
  await evalJS(`window.__wallmaker.callHost('snapshot', ${JSON.stringify({ compName: CFG.compName, time: t, path: `${dir}/snap-${t}.png` })})`, { awaitPromise: true, timeoutMs: 120000 })
}
writeFileSync(join(dir, 'result.json'), JSON.stringify({ ok: true, finish, probes }))
for (const t of TIMES) {
  const p = join(dir, `snap-${t}.png`)
  let last = -1
  for (let i = 0; i < 240; i++) {
    if (existsSync(p)) {
      const s = statSync(p).size
      if (s > 0 && s === last) break
      last = s
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}
// leave the panel the way a user expects to find it (the test config must not stick around)
await evalJS('window.__wallmaker.reset()')
ws.close()

console.log('verifying…')
execFileSync('python3', [join(root, 'test/verify.py'), dir], { stdio: 'inherit' })
console.log('✓ panel round C passed')
