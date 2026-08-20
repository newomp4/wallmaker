import type { Config } from '../../core/types'
import { gridFor } from '../../core/grid'
import { ColorInput, Section, Segmented, Slider, TextInput, Toggle } from '../controls'

export function LookPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const grid = gridFor(cfg)
  const n = grid.rows * grid.cols
  return (
    <>
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
        {cfg.background === 'static' && <Slider label="Static brightness" value={cfg.staticBrightness} min={0} max={100} onChange={(v) => patch({ staticBrightness: v })} format={(v) => `${v}%`} hint="Live 'Static brightness (%)' slider in AE." />}
      </Section>
      <Section title="Screen styling">
        <Slider label="Screen corners" value={cfg.cornerRadius} min={0} max={60} onChange={(v) => patch({ cornerRadius: v })} format={(v) => `${v} px`} />
        <Toggle label="Borders around every screen" value={cfg.borders} onChange={(v) => patch({ borders: v })} hint="A thin frame per cell — shows in the gaps and keeps off screens visible as empty monitors." />
        {cfg.borders && (
          <>
            <Slider label="Border width" value={cfg.borderWidth} min={1} max={20} onChange={(v) => patch({ borderWidth: v })} format={(v) => `${v} px`} />
            <ColorInput label="Border color" value={cfg.borderColor} onChange={(v) => patch({ borderColor: v })} />
          </>
        )}
        <Toggle label="Scanlines (CRT)" value={cfg.scanlines} onChange={(v) => patch({ scanlines: v })} hint="A subtle scanline overlay across the wall — live 'Scanlines (%)' slider in AE." />
        {cfg.scanlines && <Slider label="Scanline strength" value={cfg.scanStrength} min={0} max={100} onChange={(v) => patch({ scanStrength: v })} format={(v) => `${v}%`} />}
      </Section>
      <Section title="Labels">
        <Toggle label={`Screen labels (${cfg.labelPrefix || 'CAM'} 01, ${cfg.labelPrefix || 'CAM'} 02…)`} value={cfg.labels} onChange={(v) => patch({ labels: v })} />
        {cfg.labels && <TextInput label="Label prefix" value={cfg.labelPrefix} onChange={(v) => patch({ labelPrefix: v })} placeholder="CAM" />}
        {cfg.labels && n > 500 && <p className="hint err">⚠ {n} screens = {n} extra text layers — builds get slow past ~500.</p>}
      </Section>
      <Section title="Focus spotlight" hint="Adds a draggable 'Wallmaker Focus' null in AE: screens near it zoom in, screens far away dim. Keyframe the null to sweep attention across the wall. Try it on the preview with your mouse.">
        <Toggle label="Focus spotlight" value={cfg.focus} onChange={(v) => patch({ focus: v })} />
        {cfg.focus && (
          <>
            <Slider label="Radius" value={cfg.focusRadius} min={50} max={2000} step={10} onChange={(v) => patch({ focusRadius: v })} format={(v) => `${v} px`} />
            <Slider label="Zoom" value={cfg.focusZoom} min={100} max={300} onChange={(v) => patch({ focusZoom: v })} format={(v) => `${v}%`} />
            <Slider label="Dim the rest" value={cfg.focusDim} min={0} max={100} onChange={(v) => patch({ focusDim: v })} format={(v) => `${v}%`} />
          </>
        )}
      </Section>
    </>
  )
}
