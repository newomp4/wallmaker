import type { Config } from '../../core/types'
import { COMP_PRESETS } from '../../core/defaults'
import { gridFor } from '../../core/grid'
import { ColorInput, Field, NumberInput, Row, Section, Segmented, Select, Slider, TextInput, Toggle } from '../controls'

export function WallPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const grid = gridFor(cfg)
  const n = grid.rows * grid.cols
  return (
    <>
      <Section title="Composition">
        <TextInput label="Comp name" value={cfg.compName} onChange={(v) => patch({ compName: v })} />
        <Field label="Size">
          <Segmented
            value={COMP_PRESETS.find((p) => p.w === cfg.compW && p.h === cfg.compH)?.label ?? 'Custom'}
            options={[...COMP_PRESETS.map((p) => ({ value: p.label, label: p.label })), { value: 'Custom', label: 'Custom' }]}
            onChange={(v) => {
              const p = COMP_PRESETS.find((x) => x.label === v)
              if (p) patch({ compW: p.w, compH: p.h })
            }}
          />
        </Field>
        <Row>
          <NumberInput label="Width" value={cfg.compW} min={16} max={16384} onChange={(v) => patch({ compW: Math.round(v) })} />
          <NumberInput label="Height" value={cfg.compH} min={16} max={16384} onChange={(v) => patch({ compH: Math.round(v) })} />
        </Row>
        <Row>
          <NumberInput label="Frame rate" value={cfg.fps} min={1} max={120} onChange={(v) => patch({ fps: v })} />
          <NumberInput label="Duration (s)" value={cfg.durationSec} min={1} max={3600} onChange={(v) => patch({ durationSec: v })} />
        </Row>
      </Section>
      <Section title="Grid" hint={`${grid.rows} rows × ${grid.cols} columns = ${n} screens (${Math.round(grid.cellW)}×${Math.round(grid.cellH)} px each)`}>
        <Segmented
          value={cfg.gridMode}
          options={[
            { value: 'auto', label: 'Fit my videos', title: 'One screen per video, rows/columns picked automatically' },
            { value: 'manual', label: 'Rows × columns' },
          ]}
          onChange={(v) => patch({ gridMode: v })}
        />
        {cfg.gridMode === 'manual' && (
          <Row>
            <NumberInput label="Rows" value={cfg.rows} min={1} max={64} onChange={(v) => patch({ rows: Math.round(v) })} />
            <NumberInput label="Columns" value={cfg.cols} min={1} max={64} onChange={(v) => patch({ cols: Math.round(v) })} />
          </Row>
        )}
        <Slider label="Gap between screens" value={cfg.gap} min={0} max={80} onChange={(v) => patch({ gap: v })} format={(v) => `${v} px`} hint="Also a live 'Gap (px)' slider on the Controls null — keyframe it and the screens fly apart." />
        <Slider label="Outer margin" value={cfg.margin} min={0} max={400} onChange={(v) => patch({ margin: v })} format={(v) => `${v} px`} />
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
        <Slider label="Screen corners" value={cfg.cornerRadius} min={0} max={60} onChange={(v) => patch({ cornerRadius: v })} format={(v) => `${v} px`} />
      </Section>
      <Section title="Screens">
        <Select
          label="Video order"
          value={cfg.assign}
          options={[
            { value: 'sequential', label: 'In order (repeat if needed)' },
            { value: 'shuffle', label: 'Shuffled (each video appears evenly)' },
            { value: 'random', label: 'Random pick per screen' },
          ]}
          onChange={(v) => patch({ assign: v })}
        />
        <Toggle label="Start each screen at a random point in its video" value={cfg.randomStart} onChange={(v) => patch({ randomStart: v })} hint="A wall of the same clip won't look synchronized." />
        <Toggle label="Loop videos" value={cfg.loop} onChange={(v) => patch({ loop: v })} />
        <Toggle label="Mute audio" value={cfg.muteAudio} onChange={(v) => patch({ muteAudio: v })} hint="A thousand soundtracks at once is rarely the goal." />
        <Toggle label={`Screen labels (${cfg.labelPrefix || 'CAM'} 01, ${cfg.labelPrefix || 'CAM'} 02…)`} value={cfg.labels} onChange={(v) => patch({ labels: v })} />
        {cfg.labels && <TextInput label="Label prefix" value={cfg.labelPrefix} onChange={(v) => patch({ labelPrefix: v })} placeholder="CAM" />}
        {cfg.labels && n > 500 && <p className="hint err">⚠ {n} screens = {n} extra text layers — builds get slow past ~500.</p>}
      </Section>
      <Section title="Background">
        <Segmented
          value={cfg.background}
          options={[
            { value: 'dark', label: 'Solid', title: 'A solid panel behind the wall — shows in gaps and where screens are off' },
            { value: 'static', label: 'Static', title: 'Solid + subtle animated noise where screens are off (CCTV style)' },
            { value: 'transparent', label: 'None', title: 'Transparent — composite the wall over your own background' },
          ]}
          onChange={(v) => patch({ background: v })}
        />
        {cfg.background !== 'transparent' && <ColorInput label="Background color" value={cfg.bgColor} onChange={(v) => patch({ bgColor: v })} />}
        {cfg.background === 'static' && <Slider label="Static brightness" value={cfg.staticBrightness} min={0} max={100} onChange={(v) => patch({ staticBrightness: v })} format={(v) => `${v}%`} />}
      </Section>
    </>
  )
}
