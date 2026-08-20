/**
 * Minimal bridge to Adobe CEP (the runtime that hosts HTML panels inside After Effects).
 * Only what Wallmaker needs: run ExtendScript in the host, write files, list folders, pick files.
 * Everything here is a no-op / throws outside of a CEP panel (normal browser).
 */

interface CepFsResult<T = string> {
  err: number
  data: T
}

interface AdobeCep {
  evalScript(script: string, callback: (result: string) => void): void
  getSystemPath(type: string): string
  getHostEnvironment(): string
}

interface CepGlobal {
  fs: {
    readFile(path: string, encoding: string): CepFsResult
    writeFile(path: string, data: string, encoding: string): { err: number }
    makedir(path: string): { err: number }
    readdir(path: string): CepFsResult<string[]>
    stat(path: string): CepFsResult<{ isFile(): boolean; isDirectory(): boolean }>
    showOpenDialogEx(allowMultiple: boolean, chooseDirectory: boolean, title: string, initialPath: string, fileTypes?: string[], friendlyFilePrefix?: string, prompt?: string): CepFsResult<string[]>
  }
  encoding: { Base64: string; UTF8: string }
  util: { openURLInDefaultBrowser(url: string): { err: number } }
}

declare global {
  interface Window {
    __adobe_cep__?: AdobeCep
    cep?: CepGlobal
  }
}

export function isCEP(): boolean {
  return typeof window !== 'undefined' && !!window.__adobe_cep__ && !!window.cep
}

/** Which app / version hosts us ("AEFT 25.3") — for display and feature gating. */
export function hostInfo(): { app: string; version: string } | null {
  if (!isCEP()) return null
  try {
    const env = JSON.parse(window.__adobe_cep__!.getHostEnvironment()) as { appName?: string; appVersion?: string }
    return { app: env.appName ?? '?', version: env.appVersion ?? '?' }
  } catch {
    return { app: '?', version: '?' }
  }
}

/** JSON that is safe to embed in ExtendScript source / eval (U+2028/2029 are line terminators there). */
export function jsonForES3(v: unknown): string {
  return JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** Runs ExtendScript in the host and resolves with its string result. */
export function evalScript(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isCEP()) return reject(new Error('Not running inside After Effects'))
    window.__adobe_cep__!.evalScript(code, (res) => resolve(res ?? ''))
  })
}

let hostReady: Promise<void> | null = null

/**
 * (Re)loads host/index.jsx into After Effects' ExtendScript engine once per panel load.
 * CEP loads it at extension start too, but doing it ourselves survives panel reloads and
 * picks up a rebuilt host script without restarting AE.
 */
export function ensureHost(): Promise<void> {
  if (!hostReady) {
    const path = systemPath('extension') + '/host/index.jsx'
    // note: evaluated at top level on purpose — inside a function wrapper the file's globals would be local
    hostReady = evalScript(`$.evalFile(${JSON.stringify(path)}); typeof WALLMAKER`).then((r) => {
      if (r !== 'object') {
        hostReady = null
        throw new Error(`Could not load the After Effects host script (${r || 'no reply'})`)
      }
    })
  }
  return hostReady
}

/** Calls WALLMAKER.<fn>(args) in the host script; args/results travel as JSON. */
export async function callHost<T = unknown>(fn: string, args?: unknown): Promise<T> {
  await ensureHost()
  const payload = jsonForES3(args ?? null)
  const res = await evalScript(`(function(){ try { return WALLMAKER.${fn}(${JSON.stringify(payload)}); } catch (e) { return '{"error":' + WALLMAKER_JSON.quote(String(e && e.message ? e.message + (e.line ? ' (line ' + e.line + ')' : '') : e)) + '}'; } })()`)
  if (res === 'EvalScript error.') throw new Error('The After Effects side of the panel failed to load (EvalScript error). Try reopening the panel.')
  let parsed: unknown
  try {
    parsed = res ? JSON.parse(res) : null
  } catch {
    throw new Error(`Unexpected reply from After Effects: ${res.slice(0, 200)}`)
  }
  if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) throw new Error(String((parsed as { error: unknown }).error))
  return parsed as T
}

/** Forward slashes everywhere (ExtendScript hands out `C:\\Users\\…` on Windows, CEP accepts either). */
export function posixPath(p: string): string {
  const unc = /^\\\\|^\/\//.test(p) // \\server\share (network project) keeps its double slash
  const norm = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return unc ? '/' + norm : norm
}

/** CEP hands system paths out as file:// URLs on some builds — normalize to plain paths. */
function fromFileUrl(u: string): string {
  if (!u.startsWith('file://')) return posixPath(u)
  let p = decodeURI(u.slice(7))
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1) // Windows: /C:/Users → C:/Users
  return posixPath(p)
}

export function systemPath(type: 'userData' | 'extension' | 'myDocuments' | 'hostApplication'): string {
  return isCEP() ? fromFileUrl(window.__adobe_cep__!.getSystemPath(type)) : ''
}

export function mkdirp(path: string): void {
  const fs = window.cep!.fs
  const norm = posixPath(path)
  const uncMatch = norm.match(/^\/\/[^/]+\/[^/]+/) // //server/share is a root, not something to create
  const parts = (uncMatch ? norm.slice(uncMatch[0].length) : norm).split('/')
  let cur = uncMatch ? uncMatch[0] + '/' : ''
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (i === 0 && !uncMatch) {
      cur = p === '' ? '/' : p + '/'
      if (p !== '' && !/^[A-Za-z]:$/.test(p)) {
        const st0 = fs.stat(p)
        if (st0.err !== 0 && fs.makedir(p).err !== 0) throw new Error(`Could not create folder ${p}`)
      }
      continue
    }
    if (!p) continue
    cur = cur + p
    const st = fs.stat(cur)
    if (st.err !== 0) {
      const r = fs.makedir(cur)
      if (r.err !== 0) throw new Error(`Could not create folder ${cur} (error ${r.err})`)
    }
    cur += '/'
  }
}

export function writeText(path: string, text: string): void {
  const r = window.cep!.fs.writeFile(path, text, window.cep!.encoding.UTF8)
  if (r.err !== 0) throw new Error(`Could not write ${path} (error ${r.err})`)
}

export function pickFolder(title: string, initial: string): string | null {
  const r = window.cep!.fs.showOpenDialogEx(false, true, title, initial)
  if (r.err !== 0 || !r.data || !r.data.length) return null
  return posixPath(fromFileUrl(r.data[0]))
}

export function pickFiles(title: string, initial: string, extensions: string[]): string[] {
  const r = window.cep!.fs.showOpenDialogEx(true, false, title, initial, extensions)
  if (r.err !== 0 || !r.data || !r.data.length) return []
  return r.data.map(fromFileUrl)
}

/** Recursively lists video files under a folder (panel-side, so it never blocks AE). */
export function listVideos(folder: string, extensions: string[], limit = 5000): string[] {
  const fs = window.cep!.fs
  const exts = new Set(extensions.map((e) => e.toLowerCase()))
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 6) return
    const r = fs.readdir(dir)
    if (r.err !== 0 || !r.data) return
    const names = r.data.slice().sort()
    for (const name of names) {
      if (name.startsWith('.') || out.length >= limit) continue
      const full = dir + '/' + name
      const dot = name.lastIndexOf('.')
      const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
      if (exts.has(ext)) {
        out.push(full)
      } else if (dot < 0 || !ext) {
        const st = fs.stat(full)
        if (st.err === 0 && st.data && st.data.isDirectory()) walk(full, depth + 1)
      } else {
        const st = fs.stat(full)
        if (st.err === 0 && st.data && st.data.isDirectory()) walk(full, depth + 1)
      }
    }
  }
  walk(posixPath(folder), 0)
  return out
}
