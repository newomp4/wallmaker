/**
 * Build state lives OUTSIDE the React tree: a build keeps running (and its progress keeps
 * updating) while the user browses other tabs, and remounting the Build tab can never
 * lose a running build or allow a second one to start against the host's single session.
 */
import { useSyncExternalStore } from 'react'
import type { AEProgress, AEBuildResult } from '../ae/build'

export interface BuildState {
  busy: boolean
  progress: AEProgress | null
  result: AEBuildResult | null
  error: string
  /** short confirmation after a successful "Remove build" */
  removed: string
}

let state: BuildState = { busy: false, progress: null, result: null, error: '', removed: '' }
const subs = new Set<() => void>()

export function setBuildState(p: Partial<BuildState>): void {
  state = { ...state, ...p }
  for (const f of subs) f()
}

export function useBuildState(): BuildState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
}
