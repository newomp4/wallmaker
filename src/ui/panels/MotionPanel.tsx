import type { Config } from '../../core/types'
import { gridFor } from '../../core/grid'
import { planScreens, planCamera, withAnimation } from '../../core/reveal'
import { Field, NumberInput, Row, Section, Segmented, Select, Slider, Toggle } from '../controls'

export function MotionPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const grid = gridFor(cfg)
  const cam = planCamera(cfg, grid, planScreens(withAnimation(cfg), grid))
  const moving = cfg.intro === 'zoomOut' || cfg.outro === 'zoomIn'
  // 'All at once' ignores the spread -- every screen starts at revealStart
  const animEnd = cfg.revealStart + (cfg.reveal === 'none' ? 0 : cfg.revealDuration) + cfg.screenAnimFrames / cfg.fps
  const keyTimes = cam
    ? [
        ...(cam.intro ? (cam.intro.hold > 0 ? [0, cam.intro.hold, cam.intro.end] : [cam.intro.hold, cam.intro.end]) : []),
        ...(cam.outro ? [cam.outro.start, cam.outro.end] : []),
      ]
    : []
  return (
    <>
      <Section title="Centered screen" hint="Pin one source to the middle cell: it is on from the first frame, plays from its start, and it is what the camera zooms to.">
        <Select
          label="Source"
          value={String(cfg.featured)}
          options={[
            { value: '-1', label: 'None — the camera uses the middle screen' },
            ...cfg.videos.map((v, i) => ({ value: String(i), label: v.slice(v.lastIndexOf('/') + 1) })),
            ...cfg.comps.map((c, i) => ({ value: String(cfg.videos.length + i), label: `${c.name} (comp)` })),
          ]}
          onChange={(v) => patch({ featured: parseInt(v, 10) })}
        />
        {cfg.featured >= 0 && grid.rows * grid.cols > 1 && (
          <p className="hint">
            Sits at row {(cam?.cell[1] ?? 0) + 1}, column {(cam?.cell[0] ?? 0) + 1} — the same size as every other screen.
          </p>
        )}
      </Section>
      <Section title="Camera" hint="Both moves are keyframes on one slider — “Zoom to screen (%)” on the Wallmaker Camera null. 0 = the whole wall, 100 = that screen filling the comp.">
        <Toggle label="Start on the centered screen, pull back to the wall" value={cfg.intro === 'zoomOut'} onChange={(v) => patch({ intro: v ? 'zoomOut' : 'none' })} />
        {cfg.intro === 'zoomOut' && (
          <Row>
            <NumberInput label="Hold before moving (s)" value={cfg.introHold} min={0} max={60} step={0.1} onChange={(v) => patch({ introHold: v })} />
            <NumberInput label="Pull-back (s)" value={cfg.introDur} min={0.1} max={60} step={0.1} onChange={(v) => patch({ introDur: v })} />
          </Row>
        )}
        <Toggle label="Push back into it at the end" value={cfg.outro === 'zoomIn'} onChange={(v) => patch({ outro: v ? 'zoomIn' : 'none' })} />
        {cfg.outro === 'zoomIn' && (
          <Row>
            <NumberInput label="Push-in (s)" value={cfg.outroDur} min={0.1} max={60} step={0.1} onChange={(v) => patch({ outroDur: v })} />
            <NumberInput label="End hold (s)" value={cfg.outroHold} min={0} max={60} step={0.1} onChange={(v) => patch({ outroHold: v })} />
          </Row>
        )}
        {moving && cam && (
          <p className="hint">
            Keyframes at <b>{keyTimes.map((t) => `${t.toFixed(2)}s`).join(', ')}</b> · zoomed scale <b>{Math.round(cam.scale)}%</b>. Easy-eased both sides — retime or re-ease them in AE's graph editor and a rebuild will leave them exactly as you left them.
          </p>
        )}
        {moving && cfg.animate && cfg.intro === 'zoomOut' && cfg.revealStart < cfg.introHold && (
          <p className="hint">Tip: the power-on starts at {cfg.revealStart}s while the camera is still zoomed in until {cfg.introHold.toFixed(1)}s — set “Starts at” ≈ {cfg.introHold.toFixed(1)}s so the wall comes alive as it's revealed.</p>
        )}
      </Section>
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
                { value: 'sequence', label: 'In reading order' },
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
              Everything is fully on at <b>{animEnd.toFixed(1)} s</b>
              {animEnd > cfg.durationSec ? ` — that's after the comp ends (${cfg.durationSec} s)!` : ''} Both times are live sliders on the Controls null in AE.
            </p>
            {cfg.reveal !== 'none' && <Slider label="Randomness" value={cfg.jitter} min={0} max={1} step={0.05} onChange={(v) => patch({ jitter: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Mixes chance into ordered sweeps so they feel organic." />}
            <Field label="Each screen turns on with">
              <Segmented
                value={cfg.screenAnim}
                options={[
                  { value: 'cut', label: 'Cut', title: 'No per-screen animation — just on' },
                  { value: 'fade', label: 'Fade' },
                  { value: 'pop', label: 'Scale up', title: 'Scales up with a little overshoot' },
                ]}
                onChange={(v) => patch({ screenAnim: v })}
              />
            </Field>
            {cfg.screenAnim !== 'cut' && <Slider label="Turn-on length" value={cfg.screenAnimFrames} min={1} max={60} onChange={(v) => patch({ screenAnimFrames: v })} format={(v) => `${v} frames (${(v / cfg.fps).toFixed(2)} s)`} />}
          </>
        )}
        <Slider label="Dead screens" value={cfg.deadPct} min={0} max={90} onChange={(v) => patch({ deadPct: v })} format={(v) => (v === 0 ? 'none' : `${v}%`)} hint="Screens that never turn on — a live “Dead screens (%)” slider in AE, with or without the power-on." />
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
