import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Config } from '../core/types'
import { PRESETS } from '../core/presets'
import { useConfig } from './useConfig'
import { Preview } from './Preview'
import { SourcesPanel } from './panels/SourcesPanel'
import { WallPanel } from './panels/WallPanel'
import { LookPanel } from './panels/LookPanel'
import { RevealPanel } from './panels/RevealPanel'
import { BuildPanel } from './panels/BuildPanel'
import { isCEP, callHost } from '../ae/cep'
import { useSources } from './useSources'
import { compileWall, buildKeyFor } from '../core/scene'
import { buildInAE, defaultBuildFolder, hostInfoAE } from '../ae/build'

type Tab = 'videos' | 'wall' | 'look' | 'reveal' | 'ae'

declare global {
  interface Window {
    __wallmaker?: unknown
  }
}

export default function App() {
  const { cfg, patch, reset } = useConfig()
  const [tab, setTab] = useState<Tab>('videos')
  // two-step reset: blocking dialogs (confirm/alert) are unreliable inside CEP panels
  const [armReset, setArmReset] = useState(false)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const sourcesApi = useSources(cfg, patch)

  // debug hooks: lets the automated tests (and the curious) drive the panel from the CEF debug port
  useEffect(() => {
    window.__wallmaker = {
      get cfg() {
        return cfg
      },
      patch,
      reset,
      scene: () => compileWall(cfg),
      callHost,
      build: async () => {
        const info = await hostInfoAE().catch(() => null)
        const folder = defaultBuildFolder(info, buildKeyFor(cfg.compName))
        return buildInAE(cfg, { folder }, () => undefined)
      },
    }
  }, [cfg, patch, reset])

  const sources = cfg.videos.length + cfg.comps.length
  return (
    <div
      className={'app' + (dragOver ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length && !sourcesApi.addDropped(e.dataTransfer.files)) {
          sourcesApi.setError('Could not read dropped file paths here — use “Add files…” instead.')
        }
      }}
    >
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 32 32">
              <g fill="currentColor">
                <rect x="3" y="3" width="7.6" height="7.6" rx="1.4" />
                <rect x="12.2" y="3" width="7.6" height="7.6" rx="1.4" opacity=".85" />
                <rect x="21.4" y="3" width="7.6" height="7.6" rx="1.4" opacity=".35" />
                <rect x="3" y="12.2" width="7.6" height="7.6" rx="1.4" opacity=".55" />
                <rect x="12.2" y="12.2" width="7.6" height="7.6" rx="1.4" />
                <rect x="21.4" y="12.2" width="7.6" height="7.6" rx="1.4" opacity=".75" />
                <rect x="3" y="21.4" width="7.6" height="7.6" rx="1.4" opacity=".25" />
                <rect x="12.2" y="21.4" width="7.6" height="7.6" rx="1.4" opacity=".65" />
                <rect x="21.4" y="21.4" width="7.6" height="7.6" rx="1.4" />
              </g>
            </svg>
          </span>
          Wallmaker
          <span className="sub">{isCEP() ? 'walls of videos, as real AE layers' : 'walls of videos for After Effects'}</span>
        </div>
        <div className="topbtns">
          <select
            aria-label="Apply a look preset"
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.name === e.target.value)
              if (p) patch(p.patch)
            }}
          >
            <option value="" disabled>
              Looks…
            </option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name} title={p.hint}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={'btn' + (armReset ? ' danger' : '')}
            onClick={() => {
              if (armReset) {
                if (armTimer.current) clearTimeout(armTimer.current)
                setArmReset(false)
                reset()
              } else {
                setArmReset(true)
                armTimer.current = setTimeout(() => setArmReset(false), 3000)
              }
            }}
            title="Back to the default settings (your source list is cleared too)"
          >
            {armReset ? 'Really reset?' : 'Reset'}
          </button>
        </div>
      </header>
      <div className="main">
        <div className="stage">
          <Preview cfg={cfg} patch={patch} />
        </div>
        <aside className="panel">
          <nav className="tabs">
            {(
              [
                ['videos', `Videos${sources ? ` · ${sources}` : ''}`, TAB_ICONS.videos],
                ['wall', 'Wall', TAB_ICONS.wall],
                ['look', 'Look', TAB_ICONS.look],
                ['reveal', 'Power-on', TAB_ICONS.reveal],
                ['ae', 'Build', TAB_ICONS.ae],
              ] as [Tab, string, ReactNode][]
            ).map(([t, label, icon]) => (
              <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="panel-body">
            {tab === 'videos' && <SourcesPanel cfg={cfg} patch={patch} />}
            {tab === 'wall' && <WallPanel cfg={cfg} patch={patch} />}
            {tab === 'look' && <LookPanel cfg={cfg} patch={patch} />}
            {tab === 'reveal' && <RevealPanel cfg={cfg} patch={patch} />}
            {tab === 'ae' && <BuildPanel cfg={cfg} />}
          </div>
        </aside>
      </div>
    </div>
  )
}

const TAB_ICONS = {
  videos: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="3" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.7 6.1v3.8l3.4-1.9-3.4-1.9Z" fill="currentColor" />
    </svg>
  ),
  wall: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="1.5" width="5.6" height="5.6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.9" y="1.5" width="5.6" height="5.6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1.5" y="8.9" width="5.6" height="5.6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.9" y="8.9" width="5.6" height="5.6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  look: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5c3.6 0 6 3.2 6.6 5.5-.6 2.3-3 5.5-6.6 5.5S2 10.3 1.4 8C2 5.7 4.4 2.5 8 2.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
    </svg>
  ),
  reveal: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.5v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.4 3.6a6 6 0 1 0 7.2 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  ae: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path d="M9.2 1.2 3 9h4l-.9 5.8L12.9 7H9l.2-5.8Z" fill="currentColor" />
    </svg>
  ),
}

// re-exported for the debug console
export type { Config }
