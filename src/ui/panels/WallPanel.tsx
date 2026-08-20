import type { Config, CellAspect } from '../../core/types'
import { COMP_PRESETS } from '../../core/defaults'
import { gridFor } from '../../core/grid'
import { Field, NumberInput, Row, Section, Segmented, Select, Slider, TextInput, Toggle } from '../controls'

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
      <Section title="Grid" hint={`${grid.rows} rows × ${grid.cols} columns = ${n} cells (${Math.round(grid.cellW)}×${Math.round(grid.cellH)} px each)`}>
        <Segmented
          value={cfg.gridMode}
          options={[
            { value: 'auto', label: 'Fit my sources', title: 'One screen per source, rows/columns picked automatically' },
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
        <Field label="Cell shape" hint="Lock every screen to an aspect ratio — the wall stays centered; 'Fill comp' stretches cells to cover the comp exactly.">
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
        <Slider label="Gap between screens" value={cfg.gap} min={0} max={80} onChange={(v) => patch({ gap: v })} format={(v) => `${v} px`} hint="Also a live 'Gap (px)' slider on the Controls null in AE — keyframe it and the screens fly apart." />
        <Slider label="Outer margin" value={cfg.margin} min={0} max={400} onChange={(v) => patch({ margin: v })} format={(v) => `${v} px`} />
        <Slider label="Big screens (2×2)" value={cfg.heroes} min={0} max={8} onChange={(v) => patch({ heroes: v })} format={(v) => (v === 0 ? 'none' : String(v))} hint={grid.rows >= 2 && grid.cols >= 2 ? 'Hero monitors that span 2×2 cells — placed by the seed.' : '⚠ Needs at least a 2×2 grid — no room for big screens in this layout.'} />
      </Section>
      <Section title="Featured screen" hint="Pin one source to the center of the wall — always on, playing from its start. Perfect for 'my video, surrounded by the wall'.">
        <Select
          label="Source"
          value={String(cfg.featured)}
          options={[
            { value: '-1', label: 'None' },
            ...cfg.videos.map((v, i) => ({ value: String(i), label: v.slice(v.lastIndexOf('/') + 1) })),
            ...cfg.comps.map((c, i) => ({ value: String(cfg.videos.length + i), label: `${c.name} (comp)` })),
          ]}
          onChange={(v) => patch({ featured: parseInt(v, 10) })}
        />
        {cfg.featured >= 0 && <Toggle label="Featured screen is big (2×2 cells)" value={cfg.featuredSpan === 2} onChange={(v) => patch({ featuredSpan: v ? 2 : 1 })} hint={grid.rows >= 2 && grid.cols >= 2 ? undefined : '⚠ Needs at least a 2×2 grid.'} />}
      </Section>
      <Section title="Camera" hint="Keyframed on the Controls null (open its Scale/Position to retime or re-ease). Targets the featured screen, or the centermost one.">
        <Toggle label="Start on one screen, pull back to reveal the wall" value={cfg.intro === 'zoomOut'} onChange={(v) => patch({ intro: v ? 'zoomOut' : 'none' })} />
        {cfg.intro === 'zoomOut' && (
          <Row>
            <NumberInput label="Hold (s)" value={cfg.introHold} min={0} max={60} step={0.1} onChange={(v) => patch({ introHold: v })} />
            <NumberInput label="Pull-back (s)" value={cfg.introDur} min={0.1} max={60} step={0.1} onChange={(v) => patch({ introDur: v })} />
          </Row>
        )}
        <Toggle label="Push back into that screen at the end" value={cfg.outro === 'zoomIn'} onChange={(v) => patch({ outro: v ? 'zoomIn' : 'none' })} />
        {cfg.outro === 'zoomIn' && (
          <Row>
            <NumberInput label="Push-in (s)" value={cfg.outroDur} min={0.1} max={60} step={0.1} onChange={(v) => patch({ outroDur: v })} />
            <NumberInput label="End hold (s)" value={cfg.outroHold} min={0} max={60} step={0.1} onChange={(v) => patch({ outroHold: v })} />
          </Row>
        )}
        {(cfg.intro === 'zoomOut' || cfg.outro === 'zoomIn') && cfg.animate && cfg.intro === 'zoomOut' && cfg.revealStart < cfg.introHold && (
          <p className="hint">Tip: the power-on starts at {cfg.revealStart}s, while the camera is still zoomed in until {cfg.introHold.toFixed(1)}s — set “Starts at” ≈ {cfg.introHold.toFixed(1)}s on the Power-on tab so the wall comes alive as it's revealed.</p>
        )}
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
    </>
  )
}
