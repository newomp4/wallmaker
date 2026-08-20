/**
 * The always-visible strip under the preview with the settings you tweak while looking at the
 * wall — grid, gap, cell shape, seed — so tuning never means scrolling a panel out of view.
 * Touching rows/columns while the grid is automatic switches it to manual from the current layout.
 */
import type { Config, CellAspect } from '../core/types'
import { gridFor, bandsFor, fillGrid } from '../core/grid'
import { Stepper } from './controls'

const ASPECTS: { value: CellAspect; label: string }[] = [
  { value: 'fill', label: 'Fill comp' },
  { value: 'wide', label: '16:9' },
  { value: 'tv', label: '4:3' },
  { value: 'square', label: '1:1' },
  { value: 'tall', label: '9:16' },
  { value: 'custom', label: 'Custom…' },
]

export function QuickBar({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const grid = gridFor(cfg)
  const bands = bandsFor(cfg, grid)
  const toManual = (p: Partial<Config>) => patch({ gridMode: 'manual', rows: grid.rows, cols: grid.cols, ...p })
  return (
    <div className="quickbar">
      <button
        type="button"
        className={'qb-chip' + (cfg.gridMode === 'auto' ? ' on' : '')}
        title={cfg.gridMode === 'auto' ? 'Grid follows your source count — click to fix the current layout' : 'Click to size the grid from your source count again'}
        onClick={() => (cfg.gridMode === 'auto' ? toManual({}) : patch({ gridMode: 'auto' }))}
      >
        {cfg.gridMode === 'auto' ? 'Auto grid' : 'Manual'}
      </button>
      <Stepper label="Rows" value={grid.rows} min={1} max={64} onChange={(v) => toManual({ rows: v })} />
      <Stepper label="Cols" value={grid.cols} min={1} max={64} onChange={(v) => toManual({ cols: v })} />
      <Stepper label="Gap" value={cfg.gap} min={0} max={80} onChange={(v) => patch({ gap: v })} />
      <label className="qb-select">
        <span>Cells</span>
        <select value={cfg.cellAspect} aria-label="Cell shape" onChange={(e) => patch({ cellAspect: e.target.value as CellAspect })}>
          {ASPECTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {cfg.cellAspect === 'custom' && (
        <Stepper label="w:h" value={Math.round(cfg.cellAspectCustom * 100) / 100} min={0.1} max={10} step={0.05} onChange={(v) => patch({ cellAspectCustom: v })} />
      )}
      {(bands.x > 1 || bands.y > 1) && (
        <button type="button" className="qb-chip" title="Pick the rows and columns that reach the comp edges with cells this shape" onClick={() => patch(fillGrid(cfg))}>
          Fill comp
        </button>
      )}
      <button type="button" className="qb-chip" title="Reroll the seed — new random order, dead screens and start offsets" onClick={() => patch({ seed: Math.floor(Math.random() * 100000) })}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
          <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="5.5" cy="5.5" r="1.4" fill="currentColor" />
          <circle cx="10.5" cy="10.5" r="1.4" fill="currentColor" />
          <circle cx="10.5" cy="5.5" r="1.4" fill="currentColor" />
          <circle cx="5.5" cy="10.5" r="1.4" fill="currentColor" />
        </svg>
        Reroll
      </button>
    </div>
  )
}
