import { useEffect, useRef, useState } from 'react'
import type { Config } from '../../core/types'
import { gridFor } from '../../core/grid'
import { planScreens, withAnimation } from '../../core/reveal'
import { planTiles, fillZoom } from '../../core/tiles'
import { isDesktop, isNative, desktop, systemPath, posixPath, callHost } from '../../ae/cep'
import { Field, NumberInput, Row, Section, Segmented, Slider } from '../controls'

type Phase = { phase: string; done?: number; total?: number; file?: string; ms?: number; ok?: boolean; errors?: string[] }

/**
 * Bake the wall into a few big movies and hand them to After Effects. This is the answer to a wall
 * AE will never scrub live: it only decodes the tiles on screen, so it gets faster as you zoom in.
 */
export function TilesPanel({ cfg, patch }: { cfg: Config; patch: (p: Partial<Config>) => void }) {
  const anim = withAnimation(cfg)
  const grid = gridFor(anim)
  const screens = planScreens(anim, grid)
  const natural = fillZoom(anim, grid)
  const zoom = cfg.tileZoom > 0 ? cfg.tileZoom : natural
  const plan = planTiles(anim, grid, screens, zoom, cfg.tileMax)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<Phase | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [tools, setTools] = useState<{ version: string; ae: string | null } | null>(null)
  const outRef = useRef<string>('')

  useEffect(() => {
    if (!isDesktop()) return
    desktop().probeTools().then(setTools).catch(() => setTools(null))
    return desktop().onTileProgress((p) => setProg(p as Phase))
  }, [])

  // ~1.1 bytes per pixel per second at the h264 bitrate we ask for; ProRes is far heavier
  const secs = Math.max(1, cfg.durationSec)
  const gb = (plan.megapixels * secs * (cfg.tileCodec === 'prores' ? 0.55 : 0.09)) / 1000
  const heavy = plan.tiles.length > 24 || gb > 40

  const render = async () => {
    setErr('')
    setNote('')
    setBusy(true)
    try {
      const base = isDesktop() ? systemPath('downloads') : systemPath('myDocuments')
      const dir = posixPath(`${base}/Wallmaker tiles/${cfg.compName || 'Wall'}`)
      outRef.current = dir
      if (isDesktop()) {
        const r = await desktop().renderTiles({ ...cfg }, dir, { codec: cfg.tileCodec, quality: cfg.tileCodec === 'prores' ? 3 : cfg.tileQuality, maxTile: cfg.tileMax, zoom, jobs: 3 })
        if (!r.ok) throw new Error((r.errors ?? ['render failed']).join(' · '))
        setNote(`${plan.tiles.length} tiles in ${dir}`)
        const reply = await callHost<{ tiles: number; missing: string[] }>('importTiles', { jsonPath: `${dir}/tiles.json`, dir })
        setNote(`Placed ${reply.tiles} tiles in After Effects · ${dir}`)
      } else {
        setErr('Rendering runs in the Wallmaker app; the panel places the tiles once they exist.')
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const placeExisting = async () => {
    setErr('')
    try {
      const base = isDesktop() ? systemPath('downloads') : systemPath('myDocuments')
      const dir = outRef.current || posixPath(`${base}/Wallmaker tiles/${cfg.compName || 'Wall'}`)
      const reply = await callHost<{ tiles: number; missing: string[] }>('importTiles', { jsonPath: `${dir}/tiles.json`, dir })
      setNote(`Placed ${reply.tiles} tiles in After Effects${reply.missing.length ? ` · ${reply.missing.length} missing` : ''}`)
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    }
  }

  return (
    <>
      <Section title="Bake to tiles">
        <p className="hint">
          Renders the wall as {plan.tiles.length} movie{plan.tiles.length === 1 ? '' : 's'} that snap back together in After Effects, all on one null. AE only decodes the tiles on screen, so it speeds up as you zoom in.
        </p>
        <Field label="Sharp up to" hint={`${zoom.toFixed(1)}× zoom — ${natural.toFixed(1)}× is one whole screen filling the frame.`}>
          <Segmented
            value={cfg.tileZoom > 0 ? 'custom' : 'auto'}
            options={[
              { value: 'auto', label: `Auto · ${natural.toFixed(1)}×` },
              { value: 'custom', label: 'Set it' },
            ]}
            onChange={(v) => patch({ tileZoom: v === 'auto' ? 0 : Math.round(natural * 10) / 10 })}
          />
        </Field>
        {cfg.tileZoom > 0 && <Slider label="Zoom" value={cfg.tileZoom} min={1} max={32} step={0.5} onChange={(v) => patch({ tileZoom: v })} format={(v) => `${v}×`} />}
        <Field label="Codec">
          <Segmented
            value={cfg.tileCodec}
            options={[
              { value: 'h264', label: 'H.264', title: 'All-intra, so it scrubs like ProRes at a fraction of the size' },
              { value: 'prores', label: 'ProRes', title: 'ProRes 422 HQ — bigger, no chroma subsampling' },
            ]}
            onChange={(v) => patch({ tileCodec: v })}
          />
        </Field>
        {cfg.tileCodec === 'h264' && <Slider label="Bitrate" value={cfg.tileQuality} min={10} max={200} step={5} onChange={(v) => patch({ tileQuality: v })} format={(v) => `${v} Mb/s`} />}
        <Row>
          <NumberInput label="Largest tile (px)" value={cfg.tileMax} min={512} max={16384} step={256} onChange={(v) => patch({ tileMax: Math.round(v) })} />
        </Row>
        <p className={'hint' + (heavy ? ' err' : '')}>
          master {plan.masterW}×{plan.masterH} · {plan.cols}×{plan.rows} tiles · {plan.megapixels.toFixed(0)} MP/frame · about {gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`} for {secs}s
          {heavy ? ' — that is a lot; lower the zoom or raise the tile size.' : ''}
        </p>
        <div className="btns exportbar">
          <button type="button" className="btn primary big" disabled={busy || !isNative() || cfg.videos.length + cfg.comps.length === 0} onClick={render}>
            {busy ? 'Rendering…' : isDesktop() ? 'Render & send to After Effects' : 'Render tiles'}
          </button>
          {busy && isDesktop() && (
            <button type="button" className="btn" onClick={() => desktop().cancelTiles()}>
              Stop
            </button>
          )}
          {!busy && <button type="button" className="btn" onClick={placeExisting} disabled={!isNative()}>Place existing tiles</button>}
        </div>
        {busy && prog?.phase === 'tile' && (
          <div className="progress">
            <div className="bar">
              <div className="fill" style={{ width: `${Math.round(((prog.done ?? 0) / Math.max(1, prog.total ?? 1)) * 100)}%` }} />
            </div>
            <div className="ptext">
              tile {prog.done}/{prog.total} · {prog.file}
            </div>
          </div>
        )}
        {note && <p className="hint ok">{note}</p>}
        {err && <p className="hint err">{err}</p>}
        {tools && <p className="hint">{tools.version || 'ffmpeg not found — install it with: brew install ffmpeg'}{tools.ae ? ` · ${tools.ae}` : ' · After Effects is not running'}</p>}
      </Section>
    </>
  )
}
