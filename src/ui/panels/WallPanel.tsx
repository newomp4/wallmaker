import type { Config, CellAspect } from '../../core/types'
import { COMP_PRESETS } from '../../core/defaults'
import { PRESETS } from '../../core/presets'
import { gridFor, bandsFor, fillGrid, offscreenCount } from '../../core/grid'
import { ColorInput, Field, NumberInput, Row, Section, Segmented, Select, Slider, TextInput, Toggle } from '../controls'

/** Does a preset describe the layout the config is already in? (so the chip can show as active) */
function isActive(cfg: Config, patch: Partial<Config>): boolean {
  return (Object.keys(patch) as (keyof Config)[]).every((k) => cfg[k] === patch[k])
}

export function WallPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const grid = gridFor(cfg)
  const bands = bandsFor(cfg, grid)
  const flush = bands.x <= 1 && bands.y <= 1
  const cut = offscreenCount(cfg, grid)
  const centred = cfg.featured >= 0 && cfg.videos.length + cfg.comps.length > 0
  const step = centred ? 2 : 1
  return (
    <>
      <Section title="Arrangement">
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className={'chip' + (isActive(cfg, p.patch) ? ' on' : '')} title={p.hint} onClick={() => patch(p.patch)}>
              {p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Grid">
        <Segmented
          value={cfg.gridMode}
          options={[
            { value: 'auto', label: 'Fit sources', title: 'One screen per source; rows and columns picked automatically' },
            { value: 'manual', label: 'Rows × columns' },
          ]}
          onChange={(v) => patch(v === 'manual' ? { gridMode: 'manual', rows: grid.rows, cols: grid.cols } : { gridMode: 'auto' })}
        />
        {cfg.gridMode === 'manual' && (
          <>
            <Row>
              <NumberInput label="Rows" value={grid.rows} min={1} max={64} step={step} onChange={(v) => patch({ rows: Math.round(v) })} />
              <NumberInput label="Columns" value={grid.cols} min={1} max={64} step={step} onChange={(v) => patch({ cols: Math.round(v) })} />
            </Row>
            {centred && (cfg.rows % 2 === 0 || cfg.cols % 2 === 0) && <p className="hint">Odd counts — a centre screen needs a middle cell.</p>}
          </>
        )}
        <Field label="Cell shape">
          <Segmented
            value={cfg.cellAspect}
            options={[
              { value: 'fill', label: 'Fill', title: 'Cells stretch so the wall covers the comp exactly' },
              { value: 'wide', label: '16:9' },
              { value: 'tv', label: '4:3' },
              { value: 'square', label: '1:1' },
              { value: 'tall', label: '9:16' },
              { value: 'custom', label: 'Custom' },
            ]}
            onChange={(v: CellAspect) => patch({ cellAspect: v })}
          />
        </Field>
        {cfg.cellAspect === 'custom' && <NumberInput label="Width ÷ height" value={cfg.cellAspectCustom} min={0.1} max={10} step={0.01} onChange={(v) => patch({ cellAspectCustom: v })} />}
        {cfg.cellAspect !== 'fill' && (
          <Field label="Wall">
            <Segmented
              value={cfg.wallFit}
              options={[
                { value: 'contain', label: 'Inside', title: 'The whole wall stays in frame — a locked cell shape can leave bands' },
                { value: 'cover', label: 'Cover', title: 'Keep the cell shape and gap; add screens until the wall covers the comp, letting the outer ones run off the edges' },
              ]}
              onChange={(v) => patch({ wallFit: v })}
            />
          </Field>
        )}
        <div className="notice">
          <span>
            {flush
              ? `Flush · cells ${(grid.cellW / grid.cellH).toFixed(2)}:1${cut > 0 ? ` · ${cut} off frame` : ''}`
              : `${bands.y > 1 ? `${bands.y} px top & bottom` : ''}${bands.x > 1 && bands.y > 1 ? ' · ' : ''}${bands.x > 1 ? `${bands.x} px left & right` : ''}`}
          </span>
          {!flush && (
            <button type="button" className="btn" title="Pick the rows, columns and gap that reach the comp edges with cells exactly this shape" onClick={() => patch(fillGrid(cfg))}>
              Fit exactly
            </button>
          )}
        </div>
        <Slider label="Gap" value={cfg.gap} min={0} max={80} onChange={(v) => patch({ gap: v })} format={(v) => `${v} px`} />
        <Slider label="Margin" value={cfg.margin} min={0} max={400} onChange={(v) => patch({ margin: v })} format={(v) => `${v} px`} />
        <Slider label="Corners" value={cfg.cornerRadius} min={0} max={60} onChange={(v) => patch({ cornerRadius: v })} format={(v) => (v === 0 ? 'square' : `${v} px`)} />
      </Section>
      <Section title="Screens">
        <Field label="Video fit">
          <Segmented
            value={cfg.fill}
            options={[
              { value: 'cover', label: 'Fill', title: 'Crop to fill the screen' },
              { value: 'contain', label: 'Fit', title: 'Letterbox inside the screen' },
              { value: 'stretch', label: 'Stretch' },
            ]}
            onChange={(v) => patch({ fill: v })}
          />
        </Field>
        <Select
          label="Source order"
          value={cfg.assign}
          options={[
            { value: 'sequential', label: 'In order' },
            { value: 'shuffle', label: 'Shuffled' },
            { value: 'random', label: 'Random per screen' },
          ]}
          onChange={(v) => patch({ assign: v })}
        />
        <Toggle label="Random start point" value={cfg.randomStart} onChange={(v) => patch({ randomStart: v })} />
        <Toggle label="Loop" value={cfg.loop} onChange={(v) => patch({ loop: v })} />
        <Toggle label="Mute" value={cfg.muteAudio} onChange={(v) => patch({ muteAudio: v })} />
      </Section>
      <Section title="Background">
        <Segmented
          value={cfg.background}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'transparent', label: 'None', title: 'No background layer — composite the wall over your own' },
          ]}
          onChange={(v) => patch({ background: v })}
        />
        {cfg.background === 'solid' && <ColorInput label="Color" value={cfg.bgColor} onChange={(v) => patch({ bgColor: v })} />}
      </Section>
      <Section title="Composition">
        <TextInput label="Name" value={cfg.compName} onChange={(v) => patch({ compName: v })} />
        <Field label="Size">
          <Segmented
            value={COMP_PRESETS.find((p) => p.w === cfg.compW && p.h === cfg.compH)?.label ?? 'Custom'}
            options={[...COMP_PRESETS.map((p) => ({ value: p.label, label: p.label })), { value: 'Custom', label: 'Custom' }]}
            onChange={(v) => {
              const p = COMP_PRESETS.find((x) => x.label === v)
              if (p) patch({ compW: p.w, compH: p.h })
              else document.getElementById('wm-comp-width')?.querySelector('input')?.focus() // 'Custom' = type a size
            }}
          />
        </Field>
        <Row>
          <div className="field-wrap" id="wm-comp-width" style={{ display: 'contents' }}>
            <NumberInput label="Width" value={cfg.compW} min={16} max={16384} onChange={(v) => patch({ compW: Math.round(v) })} />
          </div>
          <NumberInput label="Height" value={cfg.compH} min={16} max={16384} onChange={(v) => patch({ compH: Math.round(v) })} />
        </Row>
        <Row>
          <NumberInput label="Frame rate" value={cfg.fps} min={1} max={120} onChange={(v) => patch({ fps: v })} />
          <NumberInput label="Duration (s)" value={cfg.durationSec} min={1} max={3600} onChange={(v) => patch({ durationSec: v })} />
        </Row>
      </Section>
    </>
  )
}
