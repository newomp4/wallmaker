import type { Config } from '../../core/types'
import { gridFor } from '../../core/grid'
import { planScreens, planCamera, withAnimation } from '../../core/reveal'
import { NumberInput, Row, Section, Select, Toggle } from '../controls'

export function CameraPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const grid = gridFor(cfg)
  const cam = planCamera(cfg, grid, planScreens(withAnimation(cfg), grid))
  const keys = cam
    ? [
        ...(cam.intro ? (cam.intro.hold > 0 ? [0, cam.intro.hold, cam.intro.end] : [cam.intro.hold, cam.intro.end]) : []),
        ...(cam.outro ? [cam.outro.start, cam.outro.end] : []),
      ]
    : []
  return (
    <>
      <Section title="Center screen">
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
        <p className="hint">
          {cfg.featured >= 0
            ? `Dead centre of the ${grid.rows}×${grid.cols} grid, always on. Click any screen in the preview to swap it.`
            : 'The camera zooms to the middle cell. Pick one here, or click a screen in the preview.'}
        </p>
      </Section>
      <Section title="Move">
        <Toggle label="Zoom out to the wall" value={cfg.intro === 'zoomOut'} onChange={(v) => patch({ intro: v ? 'zoomOut' : 'none' })} />
        {cfg.intro === 'zoomOut' && (
          <Row>
            <NumberInput label="Hold (s)" value={cfg.introHold} min={0} max={60} step={0.1} onChange={(v) => patch({ introHold: v })} />
            <NumberInput label="Duration (s)" value={cfg.introDur} min={0.1} max={60} step={0.1} onChange={(v) => patch({ introDur: v })} />
          </Row>
        )}
        <Toggle label="Zoom back in at the end" value={cfg.outro === 'zoomIn'} onChange={(v) => patch({ outro: v ? 'zoomIn' : 'none' })} />
        {cfg.outro === 'zoomIn' && (
          <Row>
            <NumberInput label="Duration (s)" value={cfg.outroDur} min={0.1} max={60} step={0.1} onChange={(v) => patch({ outroDur: v })} />
            <NumberInput label="End hold (s)" value={cfg.outroHold} min={0} max={60} step={0.1} onChange={(v) => patch({ outroHold: v })} />
          </Row>
        )}
        {keys.length > 0 && cam && (
          <p className="hint">
            Keyframes at {keys.map((t) => `${t.toFixed(2)}s`).join(', ')} on <b>Zoom to screen (%)</b>, easy-eased. Retime or re-ease them in AE — a rebuild keeps your edits.
          </p>
        )}
      </Section>
    </>
  )
}
