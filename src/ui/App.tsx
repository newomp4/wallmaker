import { useEffect, useRef, useState } from 'react'
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
    <div className="app">
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
          <Preview cfg={cfg} />
        </div>
        <aside className="panel">
          <nav className="tabs">
            {(
              [
                ['videos', `Videos${sources ? ` (${sources})` : ''}`],
                ['wall', 'Wall'],
                ['look', 'Look'],
                ['reveal', 'Power-on'],
                ['ae', 'Build'],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {label}
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

// re-exported for the debug console
export type { Config }
