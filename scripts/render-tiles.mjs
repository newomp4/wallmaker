#!/usr/bin/env node
/**
 * Bake a wall into tiles with ffmpeg.
 *   node scripts/render-tiles.mjs <config.json> <outDir> [--codec h264|prores] [--quality N] [--zoom N] [--max-tile N]
 *
 * Writes the tiles plus a `tiles.json` manifest that the After Effects side reads to place them.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG } from '../src/core/defaults.ts'
import { gridFor } from '../src/core/grid.ts'
import { planScreens, withAnimation } from '../src/core/reveal.ts'
import { planTiles, fillZoom } from '../src/core/tiles.ts'
import { tileJobs } from '../src/render/tilecmd.ts'

const run = promisify(execFile)

export async function probeDurations(paths, ffprobe = 'ffprobe') {
  const out = new Map()
  const uniq = [...new Set(paths)]
  const batch = 12
  for (let i = 0; i < uniq.length; i += batch) {
    await Promise.all(
      uniq.slice(i, i + batch).map(async (p) => {
        try {
          const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p])
          out.set(p, parseFloat(stdout.trim()) || 0)
        } catch {
          out.set(p, 0)
        }
      }),
    )
  }
  return out
}

/** Everything the AE side needs to rebuild the wall from tiles, and nothing it can get wrong. */
export function manifestFor(cfg, grid, plan, files) {
  return {
    version: 1,
    compName: cfg.compName,
    frame: { w: Math.round(cfg.compW), h: Math.round(cfg.compH) },
    fps: cfg.fps,
    durationSec: cfg.durationSec,
    bg: cfg.background === 'transparent' ? null : cfg.bgColor,
    /** master pixels per comp pixel: the layer scale is 100 / this */
    scale: plan.scale,
    master: { w: plan.masterW, h: plan.masterH },
    wall: { w: Math.round(grid.wallW), h: Math.round(grid.wallH) },
    offset: [plan.offsetX, plan.offsetY],
    grid: { rows: grid.rows, cols: grid.cols },
    tiles: plan.tiles.map((t, i) => ({
      file: files[i],
      /** the rendered rect in master px, bleed included */
      x: t.bx,
      y: t.by,
      w: t.bw,
      h: t.bh,
      /** centre of the rendered rect, in comp px relative to the wall centre */
      cx: (t.bx + t.bw / 2 - plan.masterW / 2) / plan.scale + plan.offsetX,
      cy: (t.by + t.bh / 2 - plan.masterH / 2) / plan.scale + plan.offsetY,
    })),
  }
}

export async function renderTiles(rawCfg, outDir, opts = {}) {
  // fill in anything the caller left out, so a partial config can never crash the renderer
  const cfg = { ...DEFAULT_CONFIG, ...rawCfg }
  const { codec = 'h264', quality = codec === 'prores' ? 3 : 40, maxTile = 4096, zoom, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', jobs = 3, onProgress = () => {}, shouldCancel = () => false, track = () => {} } = opts
  const anim = withAnimation(cfg)
  const grid = gridFor(anim)
  const screens = planScreens(anim, grid)
  const z = zoom ?? fillZoom(anim, grid)
  const plan = planTiles(anim, grid, screens, z, maxTile)
  mkdirSync(outDir, { recursive: true })

  const durations = await probeDurations(cfg.videos, ffprobe)
  const sources = cfg.videos.map((p) => ({ path: p, duration: durations.get(p) ?? 0 }))
  const missing = sources.filter((s) => !(s.duration > 0)).length
  const ext = codec === 'prores' ? 'mov' : 'mp4'
  const list = tileJobs(anim, plan, sources, codec, quality, outDir, ext)

  onProgress({ phase: 'start', tiles: list.length, master: [plan.masterW, plan.masterH], zoom: z, megapixels: plan.megapixels, missing })

  let done = 0
  const queue = list.slice()
  const errors = []
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      for (;;) {
        const job = queue.shift()
        if (!job || shouldCancel()) return
        const t0 = Date.now()
        await new Promise((res) => {
          const p = spawn(ffmpeg, job.args, { stdio: ['ignore', 'ignore', 'pipe'] })
          track(p)
          let err = ''
          p.stderr.on('data', (d) => { err += d.toString().slice(0, 2000) })
          p.on('close', (code) => {
            if (code !== 0) errors.push(`${job.file}: ${err.trim().split('\n').slice(-3).join(' | ')}`)
            done++
            onProgress({ phase: 'tile', done, total: list.length, file: job.file, ms: Date.now() - t0, size: [job.width, job.height], clips: job.clips, ok: code === 0 })
            res()
          })
        })
      }
    }),
  )

  const manifest = manifestFor(anim, grid, plan, list.map((j) => j.file))
  writeFileSync(join(outDir, 'tiles.json'), JSON.stringify(manifest, null, 2))
  onProgress({ phase: 'done', errors })
  return { manifest, plan, grid, errors, jobs: list }
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [cfgPath, outDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const flag = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
  if (!cfgPath || !outDir) {
    console.error('usage: node scripts/render-tiles.mjs <config.json> <outDir> [--codec h264|prores] [--quality N] [--zoom N] [--max-tile N] [--jobs N]')
    process.exit(1)
  }
  const cfg = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(cfgPath, 'utf8')) }
  const t0 = Date.now()
  const r = await renderTiles(cfg, outDir, {
    codec: flag('codec', 'h264'),
    quality: Number(flag('quality', flag('codec', 'h264') === 'prores' ? 3 : 40)),
    maxTile: Number(flag('max-tile', 4096)),
    zoom: flag('zoom') ? Number(flag('zoom')) : undefined,
    jobs: Number(flag('jobs', 3)),
    onProgress: (p) => {
      if (p.phase === 'start') console.log(`master ${p.master[0]}x${p.master[1]} · sharp to ${p.zoom.toFixed(1)}x · ${p.tiles} tiles · ${p.megapixels.toFixed(0)} MP/frame${p.missing ? ` · ${p.missing} unreadable sources` : ''}`)
      if (p.phase === 'tile') console.log(`  ${p.ok ? '✓' : '✗'} ${p.file}  ${p.size[0]}x${p.size[1]}  ${p.clips} clips  ${(p.ms / 1000).toFixed(1)}s   (${p.done}/${p.total})`)
    },
  })
  const bytes = r.jobs.reduce((n, j) => { const f = join(outDir, j.file); return n + (existsSync(f) ? readFileSync(f).length : 0) }, 0)
  console.log(`\n${r.errors.length ? '✗ ' + r.errors.length + ' failed:\n   ' + r.errors.join('\n   ') : '✓ done'}  in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${(bytes / 1e9).toFixed(2)} GB`)
  if (r.errors.length) process.exit(1)
}
