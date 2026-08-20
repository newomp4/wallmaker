import { useState, type DragEvent } from 'react'
import type { Config, CompRef } from '../../core/types'
import { VIDEO_EXTENSIONS } from '../../core/defaults'
import { gridFor } from '../../core/grid'
import { planScreens, withAnimation } from '../../core/reveal'
import { isCEP, pickFolder, pickFiles, listVideos, systemPath, callHost } from '../../ae/cep'
import { Section } from '../controls'

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function SourcesPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const inAE = isCEP()
  const [selErr, setSelErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const grid = gridFor(cfg)
  const screenCount = planScreens(withAnimation(cfg), grid).length
  const total = cfg.videos.length + cfg.comps.length

  const addFolder = () => {
    const dir = pickFolder('Choose a folder of videos', systemPath('myDocuments'))
    if (!dir) return
    const found = listVideos(dir, VIDEO_EXTENSIONS)
    if (found.length) patch({ videos: dedupe([...cfg.videos, ...found]) })
    else setSelErr('No videos found in that folder.')
  }
  const addFiles = () => {
    const files = pickFiles('Choose videos', systemPath('myDocuments'), VIDEO_EXTENSIONS)
    if (files.length) patch({ videos: dedupe([...cfg.videos, ...files]) })
  }
  const addSelection = async () => {
    setSelErr('')
    try {
      const r = await callHost<{ files: string[]; comps: CompRef[] }>('selectedSources')
      if (!r.files.length && !r.comps.length) {
        setSelErr('Nothing usable selected — select video footage or comps in the Project panel first.')
        return
      }
      patch({
        videos: dedupe([...cfg.videos, ...r.files]),
        comps: dedupeComps([...cfg.comps, ...r.comps]),
      })
    } catch (e) {
      setSelErr(String(e instanceof Error ? e.message : e))
    }
  }
  const addSamples = () => {
    // browser dev only: fake paths so the layout/reveal can be played with outside AE
    patch({ videos: dedupe([...cfg.videos, ...Array.from({ length: 12 }, (_, i) => `/samples/clip-${String(i + 1).padStart(2, '0')}.mp4`)]) })
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const exts = new Set(VIDEO_EXTENSIONS)
    const paths: string[] = []
    for (const f of Array.from(e.dataTransfer.files)) {
      const path = (f as File & { path?: string }).path
      if (!path) continue
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      if (exts.has(ext)) paths.push(path.replace(/\\/g, '/'))
    }
    if (paths.length) patch({ videos: dedupe([...cfg.videos, ...paths]) })
    else if (e.dataTransfer.files.length) setSelErr('Could not read dropped file paths here — use “Add files…” instead.')
  }

  const shown = cfg.videos.slice(0, 400)
  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      className={dragOver ? 'dropzone over' : 'dropzone'}
    >
      <Section title="Sources" hint="Every screen on the wall plays one of these — video files, or comps straight from this project. Fewer sources than screens? They repeat.">
        <div className="btns">
          {inAE ? (
            <>
              <button type="button" className="btn primary" onClick={addFolder}>
                Add a folder…
              </button>
              <button type="button" className="btn" onClick={addFiles}>
                Add files…
              </button>
              <button type="button" className="btn" onClick={addSelection} title="Uses whatever is selected in the Project panel — video footage and comps">
                From selection
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={addSamples}>
              Add 12 sample clips (preview only)
            </button>
          )}
          {total > 0 && (
            <button type="button" className="btn" onClick={() => patch({ videos: [], comps: [] })}>
              Clear all
            </button>
          )}
        </div>
        {inAE && <p className="hint">Tip: select comps in the Project panel and press <b>From selection</b> — they render live on the wall, no export needed. You can also drop video files here.</p>}
        {!inAE && <p className="hint">Folder / file pickers and comp sources work inside the After Effects panel (Window ▸ Extensions ▸ Wallmaker).</p>}
        {selErr && <p className="hint err">{selErr}</p>}
        {total > 0 && (
          <p className="hint">
            <b>{total}</b> source{total === 1 ? '' : 's'} → <b>{screenCount}</b> screen{screenCount === 1 ? '' : 's'}
            {cfg.gridMode === 'auto' ? ' (grid follows your source count — fix it on the Wall tab)' : ''}
          </p>
        )}
        <div className="upl-list">
          {cfg.comps.map((c, i) => (
            <div key={'c' + c.id} className="upl-item wide">
              <span className="tag">COMP</span>
              <span className="upl-name" title={`comp id ${c.id}`}>
                {c.name}
              </span>
              <button type="button" className="x" aria-label={`Remove ${c.name}`} onClick={() => patch({ comps: cfg.comps.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          {shown.map((p, i) => (
            <div key={p + i} className="upl-item wide">
              <span className="upl-name" title={p}>
                {basename(p)}
              </span>
              <button type="button" className="x" aria-label={`Remove ${basename(p)}`} onClick={() => patch({ videos: cfg.videos.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          {cfg.videos.length > shown.length && <p className="hint">…and {cfg.videos.length - shown.length} more</p>}
        </div>
        {total === 0 && (
          <div className="empty-state">
            <p>No sources yet.</p>
            <p className="hint">Add a folder of clips, pick files, or select footage / comps in the Project panel — the preview fills in as soon as you do.</p>
          </div>
        )}
      </Section>
    </div>
  )
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}

function dedupeComps(list: CompRef[]): CompRef[] {
  const seen = new Set<number>()
  return list.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}
