import type { Config } from '../../core/types'
import { VIDEO_EXTENSIONS } from '../../core/defaults'
import { isCEP, pickFolder, pickFiles, listVideos, systemPath } from '../../ae/cep'
import { Section } from '../controls'

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function SourcesPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const inAE = isCEP()
  const addFolder = () => {
    const dir = pickFolder('Choose a folder of videos', systemPath('myDocuments'))
    if (!dir) return
    const found = listVideos(dir, VIDEO_EXTENSIONS)
    if (found.length) patch({ videos: dedupe([...cfg.videos, ...found]) })
  }
  const addFiles = () => {
    const files = pickFiles('Choose videos', systemPath('myDocuments'), VIDEO_EXTENSIONS)
    if (files.length) patch({ videos: dedupe([...cfg.videos, ...files]) })
  }
  const addSamples = () => {
    // browser dev only: fake paths so the layout/reveal can be played with outside AE
    patch({ videos: dedupe([...cfg.videos, ...Array.from({ length: 12 }, (_, i) => `/samples/clip-${String(i + 1).padStart(2, '0')}.mp4`)]) })
  }
  const shown = cfg.videos.slice(0, 400)
  return (
    <>
      <Section title="Videos" hint="Every screen on the wall plays one of these. Fewer videos than screens? They repeat.">
        <div className="btns">
          {inAE ? (
            <>
              <button type="button" className="btn primary" onClick={addFolder}>
                Add a folder…
              </button>
              <button type="button" className="btn" onClick={addFiles}>
                Add files…
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={addSamples}>
              Add 12 sample clips (preview only)
            </button>
          )}
          {cfg.videos.length > 0 && (
            <button type="button" className="btn" onClick={() => patch({ videos: [] })}>
              Clear
            </button>
          )}
        </div>
        {!inAE && <p className="hint">Folder / file pickers work inside the After Effects panel (Window ▸ Extensions ▸ Wallmaker).</p>}
        {cfg.videos.length > 0 && (
          <p className="hint">
            <b>{cfg.videos.length}</b> video{cfg.videos.length === 1 ? '' : 's'}
          </p>
        )}
        <div className="upl-list">
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
      </Section>
    </>
  )
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}
