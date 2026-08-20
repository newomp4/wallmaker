import { writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const outPrefix = process.argv[2] ?? '/tmp/panel'
const patchJson = process.argv[3] ?? ''
const targets = await (await fetch('http://127.0.0.1:8724/json')).json()
const t = targets.find((x) => x.webSocketDebuggerUrl)
if (!t) throw new Error('panel not open')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params) => new Promise((res, rej) => {
  const i = ++id
  pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)))
  ws.send(JSON.stringify({ id: i, method, params }))
})
await send('Page.reload', {})
await new Promise((r) => setTimeout(r, 3500))
if (patchJson) {
  await send('Runtime.evaluate', { expression: `window.__wallmaker.patch(${patchJson})`, returnByValue: true })
  await new Promise((r) => setTimeout(r, 2500))
}
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${outPrefix}.png`, Buffer.from(shot.data, 'base64'))
console.log('saved', `${outPrefix}.png`)
ws.close()
