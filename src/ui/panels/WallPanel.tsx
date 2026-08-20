import type { Config, CellAspect } from '../../core/types'
import { COMP_PRESETS } from '../../core/defaults'
import { PRESETS } from '../../core/presets'
import { gridFor, aspectOf } from '../../core/grid'
import { ColorInput, Field, NumberInput, Row, Section, Segmented, Select, Slider, TextInput, Toggle } from '../controls'

/** Does a preset describe the layout the config is already in? (so the chip can show as active) */
function isActive(cfg: Config, patch: Partial<Config>): boolean {
  return (Object.keys(patch) as (keyof Config)[]).every((k) => cfg[k] === patch[k])
}

export function WallPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const grid = gridFor(cfg)
  const n = grid.rows * grid.cols
  const aspect = aspectOf(cfg)
  return (
    <>
      <Section title="Arrangement" hint="A starting point for the grid — it never touches your sources, comp or camera.">
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className={'chip' + (isActive(cfg, p.patch) ? ' on' : '')} title={p.hint} onClick={() => patch(p.patch)}>
              {p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Grid" hint={`${grid.rows} rows × ${grid.cols} columns = ${n} identical ${Math.round(grid.cellW)}×${Math.round(grid.cellH)} px screens`}>
        <Segmented
          value={cfg.gridMode}
          options={[
            { value: 'auto', label: 'Fit my sources', title: 'One screen per source, rows/columns picked automatically' },
            { value: 'manual', label: 'Rows × columns' },
          ]}
          onChange={(v) => patch(v === 'manual' ? { gridMode: 'manual', rows: grid.rows, cols: grid.cols } : { gridMode: 'auto' })}
        />
        {cfg.gridMode === 'manual' && (
          <Row>
            <NumberInput label="Rows" value={cfg.rows} min={1} max={64} onChange={(v) => patch({ rows: Math.round(v) })} />
            <NumberInput label="Columns" value={cfg.cols} min={1} max={64} onChange={(v) => patch({ cols: Math.round(v) })} />
          </Row>
        )}
        <Field
          label="Cell shape"
          hint={
            aspect === null
              ? 'Cells stretch so the wall covers the comp exactly — their shape follows rows × columns.'
              : 'Every screen is locked to this ratio and they are all the same size; the wall stays centered in the comp.'
          }
        >
          <Segmented
            value={cfg.cellAspect}
            options={[
              { value: 'fill', label: 'Fill comp' },
              { value: 'wide', label: '16:9' },
              { value: 'tv', label: '4:3' },
              { value: 'square', label: '1:1' },
              { value: 'tall', label: '9:16' },
              { value: 'custom', label: 'Custom' },
            ]}
            onChange={(v: CellAspect) => patch({ cellAspect: v })}
          />
        </Field>
        {cfg.cellAspect === 'custom' && <NumberInput label="Cell aspect (width ÷ height)" value={cfg.cellAspectCustom} min={0.1} max={10} step={0.01} onChange={(v) => patch({ cellAspectCustom: v })} />}
        <Slider label="Gap between screens" value={cfg.gap} min={0} max={80} onChange={(v) => patch({ gap: v })} format={(v) => `${v} px`} hint="Also a live “Gap (px)” slider on the Controls null in AE — keyframe it and the screens fly apart." />
        <Slider label="Outer margin" value={cfg.margin} min={0} max={400} onChange={(v) => patch({ margin: v })} format={(v) => `${v} px`} />
        <Slider label="Screen corners" value={cfg.cornerRadius} min={0} max={60} onChange={(v) => patch({ cornerRadius: v })} format={(v) => (v === 0 ? 'square' : `${v} px`)} />
      </Section>
      <Section title="Screens">
        <Field label="Video fit">
          <Segmented
            value={cfg.fill}
            options={[
              { value: 'cover', label: 'Fill', title: 'Crop to fill the screen (recommended)' },
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
            { value: 'sequential', label: 'In order (repeat if needed)' },
            { value: 'shuffle', label: 'Shuffled (each source appears evenly)' },
            { value: 'random', label: 'Random pick per screen' },
          ]}
          onChange={(v) => patch({ assign: v })}
        />
        <Toggle label="Start each screen at a random point in its video" value={cfg.randomStart} onChange={(v) => patch({ randomStart: v })} hint="A wall of the same clip won't look synchronized." />
        <Toggle label="Loop videos" value={cfg.loop} onChange={(v) => patch({ loop: v })} />
        <Toggle label="Mute audio" value={cfg.muteAudio} onChange={(v) => patch({ muteAudio: v })} hint="A thousand soundtracks at once is rarely the goal." />
      </Section>
      <Section title="Background" hint="Deliberately plain — grade, glow and texture belong on your own adjustment layers above the wall.">
        <Segmented
          value={cfg.background}
          options={[
            { value: 'solid', label: 'Solid color', title: 'A solid behind the wall — shows in the gaps and where screens are off' },
            { value: 'transparent', label: 'Transparent', title: 'No background layer — composite the wall over your own' },
          ]}
          onChange={(v) => patch({ background: v })}
        />
        {cfg.background === 'solid' && <ColorInput label="Background color" value={cfg.bgColor} onChange={(v) => patch({ bgColor: v })} />}
      </Section>
      <Section title="Composition">
        <TextInput label="Comp name" value={cfg.compName} onChange={(v) => patch({ compName: v })} />
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
