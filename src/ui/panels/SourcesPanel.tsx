import type { Config } from '../../core/types'
import { Section } from '../controls'
import { useSources } from '../useSources'

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function SourcesPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const src = useSources(cfg, patch)
  const total = cfg.videos.length + cfg.comps.length
  const shown = cfg.videos.slice(0, 400)

  return (
    <Section title="Sources">
      <div className="btns">
        {src.inAE ? (
          <>
            <button type="button" className="btn primary" onClick={src.addFolder}>
              Folder
            </button>
            <button type="button" className="btn" onClick={src.addFiles}>
              Files
            </button>
            <button type="button" className="btn" onClick={src.addSelection} title="Whatever is selected in the Project panel — footage and comps">
              From selection
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={src.addSamples}>
            Sample clips
          </button>
        )}
        {total > 0 && (
          <button type="button" className="btn" onClick={() => patch({ videos: [], comps: [], featured: -1 })}>
            Clear
          </button>
        )}
      </div>
      {src.error && <p className="hint err">{src.error}</p>}
      {total === 0 && <p className="hint">Drop files on this window, or pick comps in the Project panel and press From selection.</p>}
      <div className="upl-list">
        {cfg.comps.map((c, i) => (
          <div key={'c' + c.id} className="upl-item">
            <span className="tag">COMP</span>
            <span className="upl-name" title={c.name}>
              {c.name}
            </span>
            <button type="button" className="x" aria-label={`Remove ${c.name}`} onClick={() => src.removeComp(i)}>
              ×
            </button>
          </div>
        ))}
        {shown.map((p, i) => (
          <div key={p + i} className="upl-item">
            <span className="upl-name" title={p}>
              {basename(p)}
            </span>
            <button type="button" className="x" aria-label={`Remove ${basename(p)}`} onClick={() => src.removeVideo(i)}>
              ×
            </button>
          </div>
        ))}
      </div>
      {cfg.videos.length > shown.length && <p className="hint">+{cfg.videos.length - shown.length} more</p>}
    </Section>
  )
}
