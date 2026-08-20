import { useEffect, useState } from 'react'
import type { Config } from '../../core/types'
import { gridFor } from '../../core/grid'
import { planScreens, withAnimation } from '../../core/reveal'
import { buildKeyFor } from '../../core/scene'
import { isCEP, hostInfo } from '../../ae/cep'
import { buildInAE, defaultBuildFolder, hostInfoAE, removeBuild, type AEHostInfo } from '../../ae/build'
import { setBuildState, useBuildState } from '../buildStore'

export function BuildPanel({ cfg }: { cfg: Config }) {
  const inAE = isCEP()
  const [info, setInfo] = useState<AEHostInfo | null>(null)
  const [infoErr, setInfoErr] = useState('')
  const { busy, progress, result, error, removed } = useBuildState()
  const grid = gridFor(cfg)
  const n = planScreens(withAnimation(cfg), grid).length
  const heroCount = cfg.heroes > 0 ? planScreens(withAnimation(cfg), grid).filter((s) => s.span === 2).length : 0
  const sources = cfg.videos.length + cfg.comps.length

  useEffect(() => {
    if (!inAE) return
    hostInfoAE()
      .then(setInfo)
      .catch((e) => setInfoErr(String(e instanceof Error ? e.message : e)))
  }, [inAE])

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
      setBuildState({ result: null, progress: null, removed: r.removed ? `Removed “${cfg.compName}” and its Wallmaker folder from the project.` : '' })
      if (!r.removed) setBuildState({ error: 'No build of this comp name found in the project.' })
    } catch (e) {
      setBuildState({ error: String(e instanceof Error ? e.message : e) })
    } finally {
      setBuildState({ busy: false })
    }
  }

  if (!inAE) {
    return (
      <section className="sec">
        <h3>After Effects</h3>
        <p className="hint">
          This tab comes alive inside the After Effects panel. Install it with <code>npm run cep:install</code>, restart AE and open <b>Window ▸ Extensions ▸ Wallmaker</b>.
        </p>
        <BuildNotes />
      </section>
    )
  }

  const host = hostInfo()
  const building = busy || (progress && progress.phase !== 'done' && progress.phase !== 'error')
  return (
    <>
      <section className="sec">
        <h3>Build</h3>
        <p className="hint">
          <b>{n}</b> screens ({grid.rows}×{grid.cols} cells{heroCount > 0 ? `, ${heroCount} big` : ''}) from <b>{sources}</b> source{sources === 1 ? '' : 's'} → comp “<b>{cfg.compName}</b>” · {cfg.compW}×{cfg.compH} · {cfg.durationSec} s @ {cfg.fps} fps
        </p>
        {host && (
          <p className="hint">
            After Effects {host.version} {info ? (info.projectName ? `· project: ${info.projectName}` : '· unsaved project') : ''}
          </p>
        )}
        {infoErr && <p className="hint err">{infoErr}</p>}
        {info && info.scriptFileAccess === false && <p className="hint err">⚠ Enable Preferences ▸ Scripting &amp; Expressions ▸ “Allow Scripts to Write Files…” — the build writes its plan next to your project.</p>}
        {sources === 0 && <p className="hint err">Add videos or comps on the Videos tab first.</p>}
        {cfg.animate && cfg.revealStart + cfg.revealDuration > cfg.durationSec && (
          <p className="hint err">⚠ The power-on ends after the comp does ({(cfg.revealStart + cfg.revealDuration).toFixed(1)} s &gt; {cfg.durationSec} s) — some screens will never be seen on. Shorten it on the Power-on tab or lengthen the comp.</p>
        )}
        {n > 400 && <p className="hint">⚠ {n} screens is a lot of layers — the build takes a while and AE will want proxies / lower preview resolution.</p>}
        <div className="btns exportbar">
          <button type="button" className="btn primary big" disabled={!!building || sources === 0} onClick={build}>
            {building ? 'Building…' : 'Build in After Effects'}
          </button>
          <button type="button" className="btn" disabled={!!building} onClick={remove} title="Deletes the Wallmaker folder & comp for this comp name from the project">
            Remove build
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
        {error && <p className="hint err">{error}</p>}
        {removed && <p className="hint ok">✓ {removed}</p>}
        {result && (
          <p className="hint ok">
            ✓ Built {result.screens} screens from {result.videos} videos in {result.seconds.toFixed(1)} s.
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
    <section className="sec">
      <h3>What gets built</h3>
      <ul className="help-list">
        <li>
          <b>Wallmaker Controls</b> (null) — everything is parented to it: move / scale / rotate it to place the whole wall. Its sliders drive the wall live, no rebuild: <b>Reveal start / duration</b>, <b>Turn-on (frames)</b>, <b>Dead screens (%)</b>, <b>Dropouts (%)</b>, <b>Gap (px)</b> (keyframe it — the screens fly apart), <b>Screen scale (%)</b>, <b>Screens opacity (%)</b> — plus <b>Border / Scanlines / Static / Label / Focus</b> sliders when those features are on.
        </li>
        <li>
          <b>Wallmaker Focus</b> (null, with the Focus spotlight on) — drag or keyframe it and nearby screens zoom while the rest dim.
        </li>
        <li>
          <b>Screen 001…</b> — one real footage layer per screen (masked &amp; scaled, random start point). Restyle or swap any of them like any AE layer.
        </li>
        <li>
          <b>Background</b> / <b>Static</b> — the panel behind the wall; static noise shows wherever screens are off.
        </li>
        <li>Building again with the same comp name updates the comp in place. Sliders you changed or keyframed in AE keep your values; untouched sliders follow the panel's new settings. Your own added layers survive.</li>
      </ul>
    </section>
  )
}
