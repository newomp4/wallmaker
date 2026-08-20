import type { Config } from '../../core/types'
import { Field, NumberInput, Row, Section, Segmented, Select, Slider, Toggle } from '../controls'

export function RevealPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  // 'All at once' ignores the spread -- every screen starts at revealStart
  const animEnd = cfg.revealStart + (cfg.reveal === 'none' ? 0 : cfg.revealDuration) + cfg.screenAnimFrames / cfg.fps
  return (
    <>
      <Section title="Power-on" hint="Off = every screen is simply on from the first frame. On = the wall comes to life screen by screen.">
        <Toggle label="Animate the power-on" value={cfg.animate} onChange={(v) => patch({ animate: v })} />
        {cfg.animate && (
          <>
            <Select
              label="Order"
              value={cfg.reveal}
              options={[
                { value: 'random', label: 'Random, one by one' },
                { value: 'rows', label: 'Row by row (top → bottom)' },
                { value: 'cols', label: 'Column by column (left → right)' },
                { value: 'scanline', label: 'Scanline (like reading)' },
                { value: 'center', label: 'From the center out' },
                { value: 'edges', label: 'From the edges in' },
                { value: 'diagonal', label: 'Diagonal sweep' },
                { value: 'none', label: 'All at once' },
              ]}
              onChange={(v) => patch({ reveal: v })}
            />
            <Row>
              <NumberInput label="Starts at (s)" value={cfg.revealStart} min={0} max={3600} step={0.1} onChange={(v) => patch({ revealStart: v })} />
              {cfg.reveal !== 'none' && <NumberInput label="All on within (s)" value={cfg.revealDuration} min={0} max={3600} step={0.1} onChange={(v) => patch({ revealDuration: v })} hint="The total length of the reveal — the last screen starts by then." />}
            </Row>
            <p className="hint">
              Everything is fully on at <b>{animEnd.toFixed(1)} s</b>{animEnd > cfg.durationSec ? ` — that's after the comp ends (${cfg.durationSec} s)!` : ''} Both times are live sliders on the Controls null in AE.
            </p>
            {cfg.reveal !== 'none' && <Slider label="Randomness" value={cfg.jitter} min={0} max={1} step={0.05} onChange={(v) => patch({ jitter: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Mixes chance into ordered sweeps so they feel organic." />}
            <Field label="Each screen turns on with">
              <Segmented
                value={cfg.screenAnim}
                options={[
                  { value: 'cut', label: 'Cut', title: 'No per-screen animation — just on' },
                  { value: 'flicker', label: 'Flicker', title: 'CCTV / fluorescent flicker-on' },
                  { value: 'fade', label: 'Fade' },
                  { value: 'pop', label: 'Pop', title: 'Scales up with a little overshoot' },
                ]}
                onChange={(v) => patch({ screenAnim: v })}
              />
            </Field>
            {cfg.screenAnim !== 'cut' && <Slider label="Turn-on length" value={cfg.screenAnimFrames} min={1} max={60} onChange={(v) => patch({ screenAnimFrames: v })} format={(v) => `${v} frames (${(v / cfg.fps).toFixed(2)} s)`} />}
          </>
        )}
      </Section>
      <Section title="While running" hint="These work with or without the power-on animation.">
        <Slider label="Dead screens" value={cfg.deadPct} min={0} max={90} onChange={(v) => patch({ deadPct: v })} format={(v) => (v === 0 ? 'none' : `${v}%`)} hint="Monitors that never turn on — live 'Dead screens (%)' slider in AE." />
        <Slider label="Signal dropouts" value={cfg.dropouts} min={0} max={100} onChange={(v) => patch({ dropouts: v })} format={(v) => (v === 0 ? 'none' : `${v}%`)} hint="Running screens briefly black out now and then — live 'Dropouts (%)' slider in AE." />
      </Section>
      <Section title="Seed" hint="Everything random (order, dead screens, start offsets, big screens) is reproducible from this number.">
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
