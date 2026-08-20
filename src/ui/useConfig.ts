import { useCallback, useEffect, useRef, useState } from 'react'
import type { Config } from '../core/types'
import { DEFAULT_CONFIG } from '../core/defaults'

const KEY = 'wallmaker.config.v1'

/** union-typed fields and their allowed values — anything else a stale save carries is dropped */
const ENUMS: Partial<Record<keyof Config, readonly string[]>> = {
  gridMode: ['auto', 'manual'],
  fill: ['cover', 'contain', 'stretch'],
  assign: ['sequential', 'shuffle', 'random'],
  background: ['dark', 'static', 'transparent'],
  reveal: ['none', 'random', 'rows', 'cols', 'scanline', 'center', 'edges', 'diagonal'],
  screenAnim: ['cut', 'fade', 'flicker', 'pop'],
  cellAspect: ['fill', 'wide', 'tv', 'square', 'tall', 'custom'],
  intro: ['none', 'zoomOut'],
  outro: ['none', 'zoomIn'],
}

/** Strict whitelist over DEFAULT_CONFIG: correct types only, enum fields checked, unknown keys dropped. */
export function sanitize(raw: unknown): Config {
  const out = { ...DEFAULT_CONFIG }
  if (!raw || typeof raw !== 'object') return out
  const src = raw as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_CONFIG) as (keyof Config)[]) {
    const v = src[k]
    if (v === undefined) continue
    const d = DEFAULT_CONFIG[k]
    if (Array.isArray(d)) {
      if (!Array.isArray(v)) continue
      if (k === 'comps') {
        const comps = v.filter((x): x is { id: number; name: string } => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'number' && typeof (x as { name?: unknown }).name === 'string').map((x) => ({ id: x.id, name: x.name }))
        ;(out as Record<string, unknown>)[k] = comps.slice(0, 5000)
      } else if (v.every((x) => typeof x === 'string')) {
        ;(out as Record<string, unknown>)[k] = v.slice(0, 5000)
      }
    } else if (typeof v === typeof d) {
      const en = ENUMS[k]
      if (en && !en.includes(v as string)) continue
      if (typeof v === 'number' && !Number.isFinite(v)) continue
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

export function useConfig() {
  const [cfg, setCfg] = useState<Config>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULT_CONFIG }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(cfg))
      } catch {
        /* quota */
      }
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [cfg])
  const patch = useCallback((p: Partial<Config>) => setCfg((c) => ({ ...c, ...p })), [])
  const reset = useCallback(() => setCfg({ ...DEFAULT_CONFIG }), [])
  return { cfg, patch, reset, setCfg }
}
