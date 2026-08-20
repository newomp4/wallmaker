import { useState, type ReactNode } from 'react'

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="sec">
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  )
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={'row ' + (className ?? '')}>{children}</div>
}

/** Labelled group. A <div>, not a <label>: a label's implicit target would make the caption press the first button. */
export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <span className="lbl">{label}</span>
      {children}
      {hint && <span className="fhint">{hint}</span>}
    </div>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, format, hint }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / Math.max(1e-9, max - min)) * 100))
  return (
    <label className="field slider">
      <span className="lbl">
        {label} <b>{format ? format(value) : value}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ ['--fill' as never]: `${pct}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <span className="fhint">{hint}</span>}
    </label>
  )
}

export function Toggle({ label, value, onChange, hint }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
      <span className="lbl">{label}</span>
      {hint && <span className="fhint">{hint}</span>}
    </label>
  )
}

export function Select<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="fhint">{hint}</span>}
    </label>
  )
}

export function TextInput({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="fhint">{hint}</span>}
    </label>
  )
}

export function NumberInput({ label, value, onChange, min, max, step, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string }) {
  // keep what the user is typing (e.g. an empty field) until it becomes a valid number
  const [text, setText] = useState<string | null>(null)
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input
        type="number"
        value={text ?? (Number.isFinite(value) ? value : '')}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v) && v === clamp(v)) onChange(v)
        }}
        onBlur={() => {
          const v = parseFloat(text ?? '')
          if (!Number.isNaN(v)) onChange(clamp(v))
          setText(null)
        }}
      />
      {hint && <span className="fhint">{hint}</span>}
    </label>
  )
}

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field color">
      <span className="lbl">{label}</span>
      <span className="colorwrap">
        <input type="color" aria-label={`${label} (picker)`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
        <input
          type="text"
          aria-label={`${label} (hex)`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (/^[0-9a-f]{6}$/i.test(v)) onChange('#' + v.toLowerCase())
          }}
        />
      </span>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} title={o.title} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Compact − value + control for the numbers you nudge while watching the preview. */
export function Stepper({ label, value, min, max, step = 1, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const [text, setText] = useState<string | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  // snap to the step grid without floating-point dust (0.05 steps must not show 1.8300000000000003)
  const snap = (v: number) => parseFloat((Math.round(v / step) * step).toFixed(6))
  const nudge = (d: number) => onChange(clamp(snap(value + d * step)))
  return (
    <div className="stepper" role="group" aria-label={label}>
      <span className="st-lbl">{label}</span>
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => nudge(-1)} disabled={value <= min}>
        −
      </button>
      <input
        value={text ?? (format ? format(value) : String(value))}
        aria-label={label}
        onFocus={(e) => {
          setText(String(value))
          e.target.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text ?? '')
          if (!Number.isNaN(v)) onChange(clamp(snap(v)))
          setText(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            // arrows step from what's typed, not from the stale committed value
            const typed = parseFloat(text ?? '')
            const base = Number.isNaN(typed) ? value : clamp(snap(typed))
            onChange(clamp(snap(base + (e.key === 'ArrowUp' ? 1 : -1) * step)))
            setText(null)
          }
        }}
      />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => nudge(1)} disabled={value >= max}>
        +
      </button>
    </div>
  )
}
