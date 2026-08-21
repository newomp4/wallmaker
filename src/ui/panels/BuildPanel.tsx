import { useEffect, useState } from 'react'
import type { Config } from '../../core/types'
import { gridFor } from '../../core/grid'
import { planScreens, withAnimation } from '../../core/reveal'
import { buildKeyFor } from '../../core/scene'
import { isCEP } from '../../ae/cep'
import { buildInAE, defaultBuildFolder, hostInfoAE, removeBuild, proxies, type AEHostInfo, type ProxyState } from '../../ae/build'
import { Toggle } from '../controls'
import { setBuildState, useBuildState } from '../buildStore'

export function BuildPanel({ cfg }: { cfg: Config }) {
  const inAE = isCEP()
  const [info, setInfo] = useState<AEHostInfo | null>(null)
  const [infoErr, setInfoErr] = useState('')
  const [prox, setProx] = useState<ProxyState | null>(null)
  const buildKey = buildKeyFor(cfg.compName)
  const { busy, progress, result, error, removed } = useBuildState()
  const grid = gridFor(cfg)
  const n = planScreens(withAnimation(cfg), grid).length
  const sources = cfg.videos.length + cfg.comps.length

  useEffect(() => {
    if (!inAE) return
    hostInfoAE()
      .then(setInfo)
      .catch((e) => setInfoErr(String(e instanceof Error ? e.message : e)))
  }, [inAE])

  // does a build of this comp exist, and is it on stand-ins right now?
  useEffect(() => {
    if (!inAE) return
    let live = true
    proxies(buildKey)
      .then((p) => live && setProx(p))
      .catch(() => live && setProx(null))
    return () => {
      live = false
    }
  }, [inAE, buildKey, result, removed])

  const setFast = async (on: boolean) => {
    try {
      setProx(await proxies(buildKey, on))
    } catch (e) {
      setBuildState({ error: String(e instanceof Error ? e.message : e) })
    }
  }

  const build = async () => {
    if (busy) return
    setBuildState({ busy: true, error: '', result: null, removed: '' })
    try {
      const latest = await hostInfoAE().catch(() => info)
      const folder = defaultBuildFolder(latest, buildKeyFor(cfg.compName))
      const r = await buildInAE(cfg, { folder }, (p) => setBuildState({ progress: p }))
      setBuildState({ result: r })
    } catch (e) {
      setBuildState({ error: String(e instanceof Error ? e.message : e), progress: null })
    } finally {
      setBuildState({ busy: false })
    }
  }

  const remove = async () => {
    if (busy) return
    setBuildState({ busy: true, error: '', removed: '' })
    try {
      const r = await removeBuild(buildKeyFor(cfg.compName))
      setBuildState({ result: null, progress: null, removed: r.removed ? `Removed “${cfg.compName}”.` : '' })
      if (!r.removed) setBuildState({ error: 'No build with that comp name.' })
    } catch (e) {
      setBuildState({ error: String(e instanceof Error ? e.message : e) })
    } finally {
      setBuildState({ busy: false })
    }
  }

  if (!inAE) {
    return (
      <section className="sec">
        <h3>Build</h3>
        <p className="hint">
          Building runs inside the After Effects panel: <code>npm run cep:install</code>, restart AE, then <b>Window ▸ Extensions ▸ Wallmaker</b>.
        </p>
      </section>
    )
  }

  const building = busy || (progress && progress.phase !== 'done' && progress.phase !== 'error')
  return (
    <>
      <section className="sec">
        <h3>Build</h3>
        <p className="hint">
          <b>{cfg.compName}</b> · {grid.rows}×{grid.cols} · {n} screens · {cfg.compW}×{cfg.compH} · {cfg.durationSec}s @ {cfg.fps}
          {info?.projectName ? ` · ${info.projectName}` : ''}
        </p>
        {infoErr && <p className="hint err">{infoErr}</p>}
        {info && info.scriptFileAccess === false && <p className="hint err">Enable Preferences ▸ Scripting &amp; Expressions ▸ “Allow Scripts to Write Files…”</p>}
        {sources === 0 && <p className="hint err">Add sources first.</p>}
        {cfg.animate && cfg.revealStart + cfg.revealDuration > cfg.durationSec && (
          <p className="hint err">The power-on ends after the comp does — some screens never come on.</p>
        )}
        {n > 400 && <p className="hint">{n} layers — this will take a while in AE.</p>}
        <div className="btns exportbar">
          <button type="button" className="btn primary big" disabled={!!building || sources === 0} onClick={build}>
            {building ? 'Building…' : 'Build'}
          </button>
          <button type="button" className="btn" disabled={!!building} onClick={remove} title="Delete this build's comp and folder from the project">
            Remove
          </button>
        </div>
        {progress && (
          <div className="progress">
            <div className="bar">
              <div className="fill" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
            <div className="ptext">{progress.message}</div>
          </div>
        )}
        {prox?.found && prox.count > 0 && (
          <>
            <Toggle label="Fast preview" value={prox.using > 0} onChange={setFast} />
            <p className="hint">
              {prox.using > 0
                ? `${prox.using} of ${prox.count} sources on grey stand-ins — no video decoding. Turn off before you render.`
                : `Swaps all ${prox.count} sources for solids of the same size. Identical geometry; nothing else changes.`}
            </p>
            {!!prox.failed && prox.failed > 0 && <p className="hint err">{prox.failed} source(s) refused a stand-in{prox.reason ? `: ${prox.reason}` : ''}</p>}
          </>
        )}
        {error && <p className="hint err">{error}</p>}
        {removed && <p className="hint ok">{removed}</p>}
        {result && (
          <p className="hint ok">
            Built {result.screens} screens in {result.seconds.toFixed(1)} s.
            {result.skipped.length > 0 && ` Skipped ${result.skipped.length}: ${result.skipped.slice(0, 3).join(', ')}${result.skipped.length > 3 ? '…' : ''}`}
          </p>
        )}
      </section>
      <BuildNotes />
    </>
  )
}

function BuildNotes() {
  return (
    <details className="disc">
      <summary>What gets built</summary>
      <div className="disc-body">
        <ul className="help-list">
          <li>
            <b>Wallmaker Camera</b> — the move is one keyframable slider, <b>Zoom to screen (%)</b>: 0 the whole wall, 100 the center screen filling the comp. Also <b>Target column / row</b>, <b>Extra scale</b>, <b>Pan</b>.
          </li>
          <li>
            <b>Wallmaker Controls</b> — every screen hangs off it. Live sliders: <b>Gap</b>, <b>Reveal start / duration</b>, <b>Turn-on</b>, <b>Dead screens</b>, <b>Screen scale</b>, <b>Screens opacity</b>.
          </li>
          <li>
            <b>Screen 001…</b> — one real footage layer per screen, plus a <b>Background</b> solid.
          </li>
          <li>Rebuilding with the same comp name updates it in place. Values and keyframes you changed are kept; untouched ones follow the panel.</li>
        </ul>
      </div>
    </details>
  )
}
