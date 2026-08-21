/**
 * ffmpeg command generation for baking a wall into tiles. Pure: takes the plan, returns argv.
 * Both the After Effects panel and the standalone app run these, so a tile can never come out
 * geometrically different depending on which one you used.
 */
import type { Config } from '../core/types'
import type { TilePlan, TileRect } from '../core/tiles'
import { screensForTile } from '../core/tiles'

export type TileCodec = 'h264' | 'prores'

export interface TileSource {
  path: string
  /** un-looped duration in seconds, from ffprobe */
  duration: number
}

export interface TileJob {
  file: string
  args: string[]
  width: number
  height: number
  clips: number
}

const hex = (c: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim())
  return '0x' + (m ? m[1] : '0a0a0c')
}

/** Where a clip starts, in seconds, mirroring the AE build's `offset * un-looped duration`. */
export function startAt(offset: number, duration: number, fps: number): number {
  if (!(duration > 0)) return 0
  return Math.round(offset * duration * fps) / fps
}

/**
 * One ffmpeg invocation per tile. A tile only opens the clips that appear inside it, which is what
 * keeps this fast: 261 screens across 15 tiles is ~18 decoders per process, not 261.
 */
export function tileJob(cfg: Config, plan: TilePlan, tile: TileRect, sources: TileSource[], codec: TileCodec, quality: number): TileJob {
  const here = screensForTile(plan, tile)
  const fps = Math.max(1, cfg.fps)
  const dur = Math.max(1 / fps, cfg.durationSec)
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error', '-stats_period', '0.5', '-progress', 'pipe:1', '-nostdin']

  // the background the wall sits on, exactly the colour the live build uses
  args.push('-f', 'lavfi', '-i', `color=c=${hex(cfg.bgColor)}:s=${tile.bw}x${tile.bh}:r=${fps}:d=${dur}`)

  const filters: string[] = []
  let last = '[0:v]'
  let n = 1
  for (const { s, x, y } of here) {
    const src = sources[s.v]
    if (!src) continue
    const dead = plan.deadRank[s.i] * 100 < cfg.deadPct
    if (dead) continue
    const w = Math.max(2, Math.round(s.w))
    const h = Math.max(2, Math.round(s.h))
    const ss = startAt(s.offset, src.duration, fps)
    if (cfg.loop) args.push('-stream_loop', '-1')
    args.push('-ss', ss.toFixed(4), '-t', dur.toFixed(4), '-i', src.path)
    const fit =
      cfg.fill === 'stretch'
        ? `scale=${w}:${h}`
        : cfg.fill === 'contain'
          ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:${hex(cfg.bgColor)}`
          : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    const bits = [`fps=${fps}`, fit, 'setsar=1', 'format=rgba']
    // the power-on, baked: a screen appears at its own moment
    const on = cfg.animate ? cfg.revealStart + (s.th / 100) * cfg.revealDuration : 0
    if (on > 0.0005 || (cfg.animate && cfg.screenAnim !== 'cut')) {
      const fadeD = cfg.animate && cfg.screenAnim !== 'cut' ? Math.max(1, cfg.screenAnimFrames) / fps : 1 / fps
      bits.push(`fade=t=in:st=${on.toFixed(4)}:d=${fadeD.toFixed(4)}:alpha=1`)
    }
    filters.push(`[${n}:v]${bits.join(',')}[c${n}]`)
    filters.push(`${last}[c${n}]overlay=${x}:${y}:eof_action=pass[o${n}]`)
    last = `[o${n}]`
    n++
  }
  // Stay in RGB the whole way and convert ONCE at the end, explicitly to bt709 LIMITED range.
  // Left to itself ffmpeg wrote full-range video that After Effects read as limited, which crushed
  // the wall's background from (16,16,20) to (2,3,5) and lifted every clip -- it looked like seams.
  filters.push(`${last}format=rgb24,scale=out_range=tv:out_color_matrix=bt709,trim=duration=${dur.toFixed(4)},setpts=PTS-STARTPTS[out]`)

  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-r', String(fps), '-t', dur.toFixed(4), '-an')
  if (codec === 'prores') {
    // ProRes 422 (profile 2) up to 4444 (4) — intra-frame, scrubs instantly, big on disk
    args.push('-c:v', 'prores_ks', '-profile:v', String(Math.max(0, Math.min(4, quality))), '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le')
  } else {
    // all-intra h264: every frame a keyframe, so scrubbing is as quick as ProRes at a fraction
    // of the size. Long-GOP would make AE rebuild runs of frames every time you drag back.
    args.push('-c:v', 'h264_videotoolbox', '-b:v', `${Math.max(4, quality)}M`, '-g', '1', '-realtime', '0', '-pix_fmt', 'yuv420p')
  }
  args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv')
  if (codec !== 'prores') args.push('-movflags', '+faststart')
  return { file: tile.file, args, width: tile.bw, height: tile.bh, clips: n - 1 }
}

export function tileJobs(cfg: Config, plan: TilePlan, sources: TileSource[], codec: TileCodec, quality: number, dir: string, ext: string): TileJob[] {
  return plan.tiles.map((t) => {
    const job = tileJob(cfg, plan, t, sources, codec, quality)
    return { ...job, args: [...job.args, `${dir}/${job.file}.${ext}`], file: `${job.file}.${ext}` }
  })
}
