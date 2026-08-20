import type { Config } from '../../core/types'
import { Field, NumberInput, Row, Section, Segmented, Select, Slider, Toggle } from '../controls'

export function AnimatePanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  // 'All at once' ignores the spread -- every screen starts at revealStart
  const end = cfg.revealStart + (cfg.reveal === 'none' ? 0 : cfg.revealDuration) + cfg.screenAnimFrames / cfg.fps
  return (
    <>
      <Section title="Power-on">
        <Toggle label="Screens come on one by one" value={cfg.animate} onChange={(v) => patch({ animate: v })} />
        {cfg.animate && (
          <>
            <Select
              label="Order"
              value={cfg.reveal}
              options={[
                { value: 'random', label: 'Random' },
                { value: 'rows', label: 'Row by row' },
                { value: 'cols', label: 'Column by column' },
                { value: 'sequence', label: 'Reading order' },
                { value: 'snake', label: 'Snake' },
                { value: 'center', label: 'Center out' },
                { value: 'spiral', label: 'Spiral out' },
                { value: 'edges', label: 'Edges in' },
                { value: 'diagonal', label: 'Diagonal' },
                { value: 'none', label: 'All at once' },
              ]}
              onChange={(v) => patch({ reveal: v })}
            />
            <Row>
              <NumberInput label="Start (s)" value={cfg.revealStart} min={0} max={3600} step={0.1} onChange={(v) => patch({ revealStart: v })} />
              {cfg.reveal !== 'none' && <NumberInput label="All on by (s)" value={cfg.revealDuration} min={0} max={3600} step={0.1} onChange={(v) => patch({ revealDuration: v })} />}
            </Row>
            <p className={'hint' + (end > cfg.durationSec ? ' err' : '')}>
              Fully on at {end.toFixed(1)} s{end > cfg.durationSec ? ` — after the comp ends (${cfg.durationSec} s)` : ''}
            </p>
            {cfg.reveal !== 'none' && <Slider label="Randomness" value={cfg.jitter} min={0} max={1} step={0.05} onChange={(v) => patch({ jitter: v })} format={(v) => `${Math.round(v * 100)}%`} />}
            <Field label="Each screen">
              <Segmented
                value={cfg.screenAnim}
                options={[
                  { value: 'cut', label: 'Cut' },
                  { value: 'fade', label: 'Fade' },
                  { value: 'flicker', label: 'Flicker', title: 'Stutters on like a tube warming up' },
                  { value: 'pop', label: 'Scale up' },
                ]}
                onChange={(v) => patch({ screenAnim: v })}
              />
            </Field>
            {cfg.screenAnim !== 'cut' && <Slider label="Length" value={cfg.screenAnimFrames} min={1} max={60} onChange={(v) => patch({ screenAnimFrames: v })} format={(v) => `${v} f · ${(v / cfg.fps).toFixed(2)} s`} />}
          </>
        )}
      </Section>
      <Section title="Variation">
        <Slider label="Dead screens" value={cfg.deadPct} min={0} max={90} onChange={(v) => patch({ deadPct: v })} format={(v) => (v === 0 ? 'none' : `${v}%`)} />
        <Row>
          <NumberInput label="Seed" value={cfg.seed} min={0} max={999999} onChange={(v) => patch({ seed: Math.round(v) })} />
          <button type="button" className="btn" onClick={() => patch({ seed: Math.floor(Math.random() * 100000) })}>
            Reroll
          </button>
        </Row>
      </Section>
    </>
  )
}
