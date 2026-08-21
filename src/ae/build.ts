/** Orchestrates a build inside After Effects: compile the wall → write scene.json → drive the host script in batches. */
import type { Config } from '../core/types'
import { compileWall, type WallScene } from '../core/scene'
import { callHost, mkdirp, posixPath, writeText, jsonForES3, systemPath } from './cep'

export type AEPhase = 'compile' | 'prepare' | 'build' | 'finish' | 'done' | 'error'

export interface AEProgress {
  phase: AEPhase
  done: number
  total: number
  message: string
}

export interface AEHostInfo {
  version: string
  ae: string
  aeMajor: number
  projectPath: string
  projectDir: string
  projectName: string
  scriptFileAccess: boolean | null
}

export interface AEBuildResult {
  compName: string
  screens: number
  videos: number
  skipped: string[]
  seconds: number
}

export interface AEBuildOptions {
  /** absolute folder where scene.json is written (next to the project) */
  folder: string
  batch?: number
  signal?: AbortSignal
}

const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0))

export async function buildInAE(cfg: Config, opts: AEBuildOptions, onProgress: (p: AEProgress) => void): Promise<AEBuildResult> {
  const t0 = performance.now()
  const check = () => {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  }
  onProgress({ phase: 'compile', done: 0, total: 1, message: 'Planning the wall…' })
  const scene: WallScene = compileWall(cfg)
  const folder = posixPath(opts.folder)
  mkdirp(folder)
  const jsonPath = folder + '/wall.json'
  writeText(jsonPath, jsonForES3(scene))
  check()

  onProgress({ phase: 'prepare', done: 0, total: 1, message: 'Preparing the comp…' })
  await yieldUI()
  const begun = await callHost<{ total: number }>('begin', { jsonPath, folder })
  let fin: { compName: string; screens: number; videos: number; skipped: string[] }
  try {
    check()
    // each step imports footage — keep batches small so the panel stays responsive (evalScript blocks its JS thread)
    const batch = Math.max(1, opts.batch ?? 20)
    let done = 0
    while (done < begun.total) {
      const r = await callHost<{ done: number; total: number }>('step', { count: batch })
      done = r.done
      onProgress({ phase: 'build', done, total: begun.total, message: `Building screens… ${done}/${begun.total}` })
      await yieldUI()
      check()
    }
    onProgress({ phase: 'finish', done: begun.total, total: begun.total, message: 'Finishing…' })
    await yieldUI()
    fin = await callHost<typeof fin>('finish')
  } catch (e) {
    // whatever happens, leave the project in a consistent state
    await callHost('finish').catch(() => undefined)
    throw e
  }
  const seconds = (performance.now() - t0) / 1000
  onProgress({ phase: 'done', done: begun.total, total: begun.total, message: `Done in ${seconds.toFixed(1)} s` })
  return { ...fin, seconds }
}

export function hostInfoAE(): Promise<AEHostInfo> {
  return callHost<AEHostInfo>('info')
}

export function removeBuild(buildKey: string): Promise<{ removed: boolean }> {
  return callHost<{ removed: boolean }>('remove', { buildKey })
}

/** Default folder for wall.json: next to the AE project, or ~/Documents/Wallmaker while unsaved. */
export interface ProxyState {
  found: boolean
  count: number
  using: number
  failed?: number
  reason?: string
}

/** Fast preview: swap every source for a solid of its own size (or back). Omit `on` to just read the state. */
export function proxies(buildKey: string, on?: boolean): Promise<ProxyState> {
  return callHost<ProxyState>('proxies', on === undefined ? { buildKey } : { buildKey, on })
}

export interface LayoutState {
  found: boolean
  on: boolean
  screens: number
}

/** Layout only: show the low-opacity cell boxes and switch the video layers off (or back). */
export function layoutOnly(buildKey: string, on?: boolean): Promise<LayoutState> {
  return callHost<LayoutState>('layout', on === undefined ? { buildKey } : { buildKey, on })
}

export function defaultBuildFolder(info: AEHostInfo | null, buildKey: string): string {
  const base = info?.projectDir ? posixPath(info.projectDir) + '/Wallmaker' : posixPath(systemPath('myDocuments')) + '/Wallmaker'
  return `${base}/${buildKey}`
}
