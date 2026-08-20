import type { Config } from '../../core/types'
import { Field, Row, Section, Segmented, Select, Slider, NumberInput } from '../controls'

export function RevealPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  return (
    <>
      <Section title="Power-on" hint="Screens come to life one by one. Press play in the preview to watch it; in AE the same timing runs live off the Controls null.">
        <Select
          label="Order"
          value={cfg.reveal}
          options={[
            { value: 'none', label: 'All at once' },
            { value: 'random', label: 'Random, one by one' },
            { value: 'rows', label: 'Row by row (top → bottom)' },
            { value: 'cols', label: 'Column by column (left → right)' },
            { value: 'scanline', label: 'Scanline (like reading)' },
            { value: 'center', label: 'From the center out' },
            { value: 'edges', label: 'From the edges in' },
            { value: 'diagonal', label: 'Diagonal sweep' },
          ]}
          onChange={(v) => patch({ reveal: v })}
        />
        <Row>
          <NumberInput label="Start (s)" value={cfg.revealStart} min={0} max={3600} step={0.1} onChange={(v) => patch({ revealStart: v })} />
          <NumberInput label="Spread over (s)" value={cfg.revealDuration} min={0} max={3600} step={0.1} onChange={(v) => patch({ revealDuration: v })} />
        </Row>
        {cfg.reveal !== 'none' && <Slider label="Randomness" value={cfg.jitter} min={0} max={1} step={0.05} onChange={(v) => patch({ jitter: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Mixes chance into ordered sweeps so they feel organic." />}
      </Section>
      <Section title="Each screen turns on with">
        <Field label="Style">
          <Segmented
            value={cfg.screenAnim}
            options={[
              { value: 'flicker', label: 'Flicker', title: 'CCTV / fluorescent flicker-on' },
              { value: 'fade', label: 'Fade' },
              { value: 'pop', label: 'Pop', title: 'Scales up with a little overshoot' },
              { value: 'cut', label: 'Cut' },
            ]}
            onChange={(v) => patch({ screenAnim: v })}
          />
        </Field>
        <Slider label="Turn-on length" value={cfg.screenAnimFrames} min={1} max={60} onChange={(v) => patch({ screenAnimFrames: v })} format={(v) => `${v} frames`} />
      </Section>
      <Section title="Dead screens" hint="A share of screens that never turn on — great for that broken-monitor-wall look. Live-adjustable in AE.">
        <Slider label="Dead screens" value={cfg.deadPct} min={0} max={90} onChange={(v) => patch({ deadPct: v })} format={(v) => `${v}%`} />
      </Section>
      <Section title="Seed" hint="Everything random (order, dead screens, start offsets) is reproducible from this number.">
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
