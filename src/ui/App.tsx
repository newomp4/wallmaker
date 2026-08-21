import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Config } from '../core/types'
import { useConfig } from './useConfig'
import { Preview } from './Preview'
import { SourcesPanel } from './panels/SourcesPanel'
import { WallPanel } from './panels/WallPanel'
import { CameraPanel } from './panels/CameraPanel'
import { AnimatePanel } from './panels/AnimatePanel'
import { BuildPanel } from './panels/BuildPanel'
import { TilesPanel } from './panels/TilesPanel'
import { callHost, isDesktop } from '../ae/cep'
import { useSources } from './useSources'
import { compileWall, buildKeyFor } from '../core/scene'
import { buildInAE, defaultBuildFolder, hostInfoAE } from '../ae/build'

type Tab = 'videos' | 'wall' | 'camera' | 'animate' | 'tiles' | 'ae'

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
  const dragDepth = useRef(0)
  const sourcesApi = useSources(cfg, patch)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4000)
  }

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
      className={'app' + (dragOver ? ' dragging' : '') + (isDesktop() ? ' desktop' : '')}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current++
        setDragOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        // enter/leave fire per child element -- a depth counter is the only reliable "really left"
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        if (e.dataTransfer.files.length) {
          if (sourcesApi.addDropped(e.dataTransfer.files)) showToast(`Added ${e.dataTransfer.files.length} file${e.dataTransfer.files.length === 1 ? '' : 's'}`)
          else showToast('Could not read those paths — use Files instead')
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
        </div>
        <div className="topbtns">
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
            title="Back to defaults — clears your sources too"
          >
            {armReset ? 'Sure?' : 'Reset'}
          </button>
        </div>
      </header>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <div className="main">
        <div className="stage">
          <Preview cfg={cfg} patch={patch} />
        </div>
        <aside className="panel">
          <nav className="tabs">
            {(
              [
                ['videos', `Sources${sources ? ` · ${sources}` : ''}`, TAB_ICONS.videos],
                ['wall', 'Wall', TAB_ICONS.wall],
                ['camera', 'Camera', TAB_ICONS.camera],
                ['animate', 'Animate', TAB_ICONS.animate],
                ['tiles', 'Tiles', TAB_ICONS.tiles],
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
            {tab === 'camera' && <CameraPanel cfg={cfg} patch={patch} />}
            {tab === 'animate' && <AnimatePanel cfg={cfg} patch={patch} />}
            {tab === 'tiles' && <TilesPanel cfg={cfg} patch={patch} />}
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
  camera: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.4" y="4.2" width="9" height="7.6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11.2 8.4 14.5 6v4.8l-3.3-2.4Z" fill="currentColor" />
    </svg>
  ),
  animate: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.6v5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.6 3.8a5.6 5.6 0 1 0 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  tiles: (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.4" y="1.4" width="5.4" height="5.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.2" y="1.4" width="5.4" height="5.4" rx="1" fill="currentColor" opacity=".55" />
      <rect x="1.4" y="9.2" width="5.4" height="5.4" rx="1" fill="currentColor" opacity=".55" />
      <rect x="9.2" y="9.2" width="5.4" height="5.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
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
