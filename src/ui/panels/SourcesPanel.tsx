import type { Config } from '../../core/types'
import { gridFor } from '../../core/grid'
import { planScreens, withAnimation } from '../../core/reveal'
import { Section } from '../controls'
import { useSources } from '../useSources'

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function SourcesPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const src = useSources(cfg, patch)
  const grid = gridFor(cfg)
  const screenCount = planScreens(withAnimation(cfg), grid).length
  const total = cfg.videos.length + cfg.comps.length
  const shown = cfg.videos.slice(0, 400)

  return (
    <Section title="Sources" hint="Every screen on the wall plays one of these — video files, or comps straight from this project. Fewer sources than screens? They repeat.">
      <div className="btns">
        {src.inAE ? (
          <>
            <button type="button" className="btn primary" onClick={src.addFolder}>
              Add a folder…
            </button>
            <button type="button" className="btn" onClick={src.addFiles}>
              Add files…
            </button>
            <button type="button" className="btn" onClick={src.addSelection} title="Uses whatever is selected in the Project panel — video footage and comps">
              From selection
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={src.addSamples}>
            Add 12 sample clips (preview only)
          </button>
        )}
        {total > 0 && (
          <button type="button" className="btn" onClick={() => patch({ videos: [], comps: [], featured: -1 })}>
            Clear all
          </button>
        )}
      </div>
      {src.inAE && <p className="hint">Tip: select comps in the Project panel and press <b>From selection</b> — they render live on the wall, no export needed. Dropping video files anywhere on this window works too.</p>}
      {!src.inAE && <p className="hint">Folder / file pickers and comp sources work inside the After Effects panel (Window ▸ Extensions ▸ Wallmaker).</p>}
      {src.error && <p className="hint err">{src.error}</p>}
      {total > 0 && (
        <p className="hint">
          <b>{total}</b> source{total === 1 ? '' : 's'} → <b>{screenCount}</b> screen{screenCount === 1 ? '' : 's'}
          {cfg.gridMode === 'auto' ? ' (grid follows your source count)' : ''}
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
    </Section>
  )
}
