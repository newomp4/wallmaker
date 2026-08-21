/** Source-adding actions shared by the Videos tab and the stage's empty-state overlay. */
import { useState } from 'react'
import type { Config, CompRef } from '../core/types'
import { VIDEO_EXTENSIONS } from '../core/defaults'
import { isNative, pickFolder, pickFiles, listVideos, systemPath, callHost } from '../ae/cep'

export function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}

export function dedupeComps(list: CompRef[]): CompRef[] {
  const seen = new Set<number>()
  return list.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}

export function useSources(cfg: Config, patch: (p: Partial<Config>) => void) {
  const [error, setError] = useState('')
  const inAE = isNative()

  const addFolder = () => {
    setError('')
    const dir = pickFolder('Choose a folder of videos', systemPath('myDocuments'))
    if (!dir) return
    const found = listVideos(dir, VIDEO_EXTENSIONS)
    if (found.length) patch({ videos: dedupe([...cfg.videos, ...found]) })
    else setError('No videos found in that folder.')
  }

  const addFiles = () => {
    setError('')
    const files = pickFiles('Choose videos', systemPath('myDocuments'), VIDEO_EXTENSIONS)
    if (files.length) patch({ videos: dedupe([...cfg.videos, ...files]) })
  }

  const addSelection = async () => {
    setError('')
    try {
      const r = await callHost<{ files: string[]; comps: CompRef[] }>('selectedSources')
      if (!r.files.length && !r.comps.length) {
        setError('Nothing usable selected — select video footage or comps in the Project panel first.')
        return
      }
      patch({ videos: dedupe([...cfg.videos, ...r.files]), comps: dedupeComps([...cfg.comps, ...r.comps]) })
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const addSamples = () => {
    // browser dev only: fake paths so the layout/reveal can be played with outside AE
    patch({ videos: dedupe([...cfg.videos, ...Array.from({ length: 12 }, (_, i) => `/samples/clip-${String(i + 1).padStart(2, '0')}.mp4`)]) })
  }

  const addDropped = (files: FileList): boolean => {
    const exts = new Set(VIDEO_EXTENSIONS)
    const paths: string[] = []
    for (const f of Array.from(files)) {
      const path = (f as File & { path?: string }).path
      if (!path) continue
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      if (exts.has(ext)) paths.push(path.replace(/\\/g, '/'))
    }
    if (paths.length) {
      patch({ videos: dedupe([...cfg.videos, ...paths]) })
      return true
    }
    return false
  }

  /** Remove one video by index, remapping cfg.featured so the pinned source stays the same one. */
  const removeVideo = (i: number) => {
    const p: Partial<Config> = { videos: cfg.videos.filter((_, j) => j !== i) }
    if (cfg.featured === i) p.featured = -1
    else if (cfg.featured > i) p.featured = cfg.featured - 1 // comp indices shift down too
    patch(p)
  }

  /** Remove one comp by index (featured indexes videos-then-comps). */
  const removeComp = (i: number) => {
    const gi = cfg.videos.length + i
    const p: Partial<Config> = { comps: cfg.comps.filter((_, j) => j !== i) }
    if (cfg.featured === gi) p.featured = -1
    else if (cfg.featured > gi) p.featured = cfg.featured - 1
    patch(p)
  }

  return { inAE, error, setError, addFolder, addFiles, addSelection, addSamples, addDropped, removeVideo, removeComp }
}
