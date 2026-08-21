#!/usr/bin/env node

// scripts/render-tiles.mjs
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/core/defaults.ts
var DEFAULT_CONFIG = {
  videos: [],
  comps: [],
  compName: "Video Wall",
  compW: 1920,
  compH: 1080,
  fps: 30,
  durationSec: 12,
  gridMode: "auto",
  rows: 5,
  cols: 8,
  gap: 6,
  margin: 0,
  fill: "cover",
  cornerRadius: 0,
  cellAspect: "fill",
  cellAspectCustom: 1.7778,
  wallFit: "contain",
  centerFit: "grid",
  assign: "shuffle",
  randomStart: true,
  loop: true,
  muteAudio: true,
  featured: -1,
  intro: "none",
  introHold: 1,
  introDur: 2,
  outro: "none",
  outroHold: 0.5,
  outroDur: 2,
  background: "solid",
  bgColor: "#0a0a0c",
  tileZoom: 0,
  tileCodec: "h264",
  tileQuality: 60,
  tileMax: 4096,
  animate: false,
  reveal: "random",
  revealStart: 0.5,
  revealDuration: 6,
  screenAnim: "fade",
  screenAnimFrames: 8,
  jitter: 0.2,
  deadPct: 0,
  seed: 7
};

// src/core/grid.ts
function aspectOf(cfg) {
  switch (cfg.cellAspect) {
    case "fill":
      return null;
    case "wide":
      return 16 / 9;
    case "tv":
      return 4 / 3;
    case "square":
      return 1;
    case "tall":
      return 9 / 16;
    case "custom":
      return Math.max(0.05, Math.min(20, cfg.cellAspectCustom || 16 / 9));
  }
}
function cellFor(rows, cols, availW, availH, gap, aspect) {
  const maxW = (availW - (cols - 1) * gap) / cols;
  const maxH = (availH - (rows - 1) * gap) / rows;
  if (maxW <= 2 || maxH <= 2) return null;
  if (aspect === null) return { cellW: maxW, cellH: maxH };
  const cellW = Math.min(maxW, aspect * maxH);
  return { cellW, cellH: cellW / aspect };
}
function autoGrid(n, compW, compH, gap, margin, aspect) {
  const availW = Math.max(1, compW - 2 * margin);
  const availH = Math.max(1, compH - 2 * margin);
  let best = null;
  let bestScore = -Infinity;
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cell = cellFor(rows, cols, availW, availH, gap, aspect);
    if (!cell) continue;
    const waste = rows * cols - n;
    const score = aspect === null ? -Math.abs(Math.log(cell.cellW / cell.cellH / (16 / 9))) - waste / n * 0.4 : cell.cellW * cell.cellH * (1 - 0.35 * waste / n);
    if (score > bestScore) {
      bestScore = score;
      best = { rows, cols };
    }
  }
  return best ?? { rows: 1, cols: Math.max(1, n) };
}
function gridFor(cfg) {
  const n = Math.max(1, cfg.videos.length + cfg.comps.length || 12);
  const aspect = aspectOf(cfg);
  const base = cfg.gridMode === "manual" ? { rows: Math.max(1, cfg.rows), cols: Math.max(1, cfg.cols) } : autoGrid(n, cfg.compW, cfg.compH, cfg.gap, cfg.margin, aspect);
  const availW = Math.max(1, cfg.compW - 2 * cfg.margin);
  const availH = Math.max(1, cfg.compH - 2 * cfg.margin);
  const centred = needsOddGrid(cfg);
  const odd = (v) => centred && v % 2 === 0 ? v + 1 : v;
  let rows = odd(base.rows);
  let cols = odd(base.cols);
  const cell = cellFor(rows, cols, availW, availH, cfg.gap, aspect) ?? { cellW: Math.max(1, availW / cols), cellH: Math.max(1, availH / rows) };
  if (cfg.wallFit === "cover" && aspect !== null) {
    const shifting = hasCameraTarget(cfg) && cfg.centerFit === "shift";
    const settle = (start, avail, size) => {
      const step = size + cfg.gap;
      let n2 = odd(Math.max(start, Math.min(200, Math.ceil((avail + cfg.gap) / step))));
      while (shifting && n2 % 2 === 0 && n2 < 200 && (n2 * size + (n2 - 1) * cfg.gap) / 2 < avail / 2 + step / 2 - 0.01) n2++;
      return n2;
    };
    cols = settle(cols, availW, cell.cellW);
    rows = settle(rows, availH, cell.cellH);
  }
  return {
    rows,
    cols,
    cellW: cell.cellW,
    cellH: cell.cellH,
    wallW: cell.cellW * cols + cfg.gap * (cols - 1),
    wallH: cell.cellH * rows + cfg.gap * (rows - 1)
  };
}
function cellOnscreen(row, col, cfg, grid) {
  const [ox, oy] = wallOffset(cfg, grid);
  const x = (col - (grid.cols - 1) / 2) * (grid.cellW + cfg.gap) + ox;
  const y = (row - (grid.rows - 1) / 2) * (grid.cellH + cfg.gap) + oy;
  return Math.abs(x) + grid.cellW / 2 <= cfg.compW / 2 + 0.5 && Math.abs(y) + grid.cellH / 2 <= cfg.compH / 2 + 0.5;
}
function hasCameraTarget(cfg) {
  if (cfg.videos.length + cfg.comps.length === 0) return false;
  return cfg.featured >= 0 || cfg.intro === "zoomOut" || cfg.outro === "zoomIn";
}
function needsOddGrid(cfg) {
  return hasCameraTarget(cfg) && cfg.centerFit === "grid";
}
function wallOffset(cfg, grid) {
  if (!hasCameraTarget(cfg) || cfg.centerFit !== "shift") return [0, 0];
  return [grid.cols % 2 === 0 ? (grid.cellW + cfg.gap) / 2 : 0, grid.rows % 2 === 0 ? (grid.cellH + cfg.gap) / 2 : 0];
}

// src/core/rng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// src/core/reveal.ts
function orderValue(mode, row, col, rows, cols, rng) {
  const n = rows * cols;
  const tie = (row * cols + col) / n * 1e-3;
  switch (mode) {
    case "none":
      return 0;
    case "random":
      return rng();
    case "rows":
      return row / Math.max(1, rows - 1 || 1) + tie;
    case "cols":
      return col / Math.max(1, cols - 1 || 1) + tie;
    case "sequence":
      return (row * cols + col) / n;
    case "snake":
      return (row * cols + (row % 2 === 1 ? cols - 1 - col : col)) / n;
    case "spiral": {
      const dr = row - (rows - 1) / 2;
      const dc = col - (cols - 1) / 2;
      const ring = Math.max(Math.abs(dr), Math.abs(dc));
      const maxRing = Math.max(0.5, Math.max((rows - 1) / 2, (cols - 1) / 2));
      const ang = (Math.atan2(dr, dc) + Math.PI) / (2 * Math.PI);
      return (ring + ang) / (maxRing + 1);
    }
    case "center": {
      const dx = (col - (cols - 1) / 2) / Math.max(1, cols / 2);
      const dy = (row - (rows - 1) / 2) / Math.max(1, rows / 2);
      return Math.sqrt(dx * dx + dy * dy) / Math.SQRT2 + tie;
    }
    case "edges": {
      const dx = (col - (cols - 1) / 2) / Math.max(1, cols / 2);
      const dy = (row - (rows - 1) / 2) / Math.max(1, rows / 2);
      return 1 - Math.sqrt(dx * dx + dy * dy) / Math.SQRT2 + tie;
    }
    case "diagonal":
      return (row + col) / Math.max(1, rows + cols - 2) + tie;
  }
}
function withAnimation(cfg) {
  return cfg.animate ? cfg : { ...cfg, reveal: "none", revealStart: 0, revealDuration: 0, screenAnim: "cut" };
}
function centerCell(grid) {
  return { row: Math.floor((grid.rows - 1) / 2), col: Math.floor((grid.cols - 1) / 2) };
}
function planScreens(cfg, grid) {
  const g = grid ?? gridFor(cfg);
  const rngAssign = mulberry32(cfg.seed * 4 + 1);
  const rngOrder = mulberry32(cfg.seed * 4 + 2);
  const rngDead = mulberry32(cfg.seed * 4 + 3);
  const rngOffset = mulberry32(cfg.seed * 4 + 4);
  const slots = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) slots.push({ row: r, col: c });
  const n = slots.length;
  const nvAll = cfg.videos.length + cfg.comps.length;
  const nv = Math.max(1, nvAll);
  const wantFeatured = cfg.featured >= 0 && nvAll > 0;
  const ctr = centerCell(g);
  const featuredSlot = wantFeatured ? ctr.row * g.cols + ctr.col : -1;
  const featuredIdx = wantFeatured ? Math.min(cfg.featured, nvAll - 1) : -1;
  const pool = [];
  for (let v = 0; v < nv; v++) if (v !== featuredIdx || nv === 1) pool.push(v);
  const np = pool.length;
  let vids;
  if (cfg.assign === "shuffle") {
    const onscreen = [];
    const offscreen = [];
    for (let i = 0; i < n; i++) (cellOnscreen(slots[i].row, slots[i].col, cfg, g) ? onscreen : offscreen).push(i);
    const order = shuffled(onscreen, rngAssign).concat(shuffled(offscreen, rngAssign));
    const seq = [];
    while (seq.length < n) {
      const round = shuffled(pool.slice(), rngAssign);
      for (let v = 0; v < round.length && seq.length < n; v++) seq.push(round[v]);
    }
    vids = new Array(n);
    for (let k = 0; k < n; k++) vids[order[k]] = seq[k];
  } else if (cfg.assign === "random") {
    vids = Array.from({ length: n }, () => pool[Math.floor(rngAssign() * np)]);
  } else {
    vids = Array.from({ length: n }, (_, i) => pool[i % np]);
  }
  const base = slots.map((slot) => {
    const v = orderValue(cfg.reveal, slot.row, slot.col, g.rows, g.cols, rngOrder);
    return cfg.reveal === "none" ? 0 : v + (rngOrder() - 0.5) * 2 * cfg.jitter;
  });
  const ranked = base.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const th = new Array(n);
  for (let r = 0; r < n; r++) th[ranked[r].i] = cfg.reveal === "none" ? 0 : (r + 0.5) / n * 100;
  const offsets = new Array(n).fill(0);
  if (cfg.randomStart) {
    const bySource = /* @__PURE__ */ new Map();
    for (let i = 0; i < n; i++) {
      if (i === featuredSlot) continue;
      const list = bySource.get(vids[i]);
      if (list) list.push(i);
      else bySource.set(vids[i], [i]);
    }
    const keys = Array.from(bySource.keys()).sort((a, b) => a - b);
    for (const v of keys) {
      const idxs = shuffled(bySource.get(v), rngOffset);
      for (let k = 0; k < idxs.length; k++) {
        offsets[idxs[k]] = Math.round((k + 0.15 + 0.7 * rngOffset()) / idxs.length * 0.95 * 1e4) / 1e4;
      }
    }
  }
  return slots.map((slot, i) => {
    const dead = Math.round(rngDead() * 1e4) / 1e4;
    const offset = offsets[i];
    if (i === featuredSlot) {
      return { i, row: slot.row, col: slot.col, v: featuredIdx, th: 0, dead: 1, offset: 0, featured: true };
    }
    return { i, row: slot.row, col: slot.col, v: vids[i], th: Math.round(th[i] * 100) / 100, dead, offset };
  });
}

// src/core/tiles.ts
function fillZoom(cfg, grid) {
  return Math.max(1, Math.min(64, Math.min(cfg.compW / grid.cellW, cfg.compH / grid.cellH)));
}
function cutsFor(total, count, candidates, maxSpan) {
  const cuts = [];
  let prev = 0;
  let snapped = 0;
  for (let i = 1; i < count; i++) {
    const ideal = total * i / count;
    let best = ideal;
    let bestD = Infinity;
    for (const c of candidates) {
      const d = Math.abs(c - ideal);
      if (d < bestD && c - prev > 8 && c - prev <= maxSpan && total - c <= maxSpan * (count - i)) {
        best = c;
        bestD = d;
      }
    }
    if (bestD < Infinity) snapped++;
    const cut = Math.round(best);
    cuts.push(cut);
    prev = cut;
  }
  return { cuts, snapped };
}
function bestCuts(total, minCount, candidates, maxSpan) {
  let best = null;
  for (let n = minCount; n <= minCount + 2; n++) {
    const { cuts, snapped } = cutsFor(total, n, candidates, maxSpan);
    if (snapped === n - 1) return { cuts, count: n };
    if (!best || snapped > best.snapped) best = { cuts, count: n, snapped };
  }
  return { cuts: best.cuts, count: best.count };
}
function spans(total, cuts) {
  const out = [];
  let at = 0;
  for (const c of cuts) {
    out.push({ at, size: c - at });
    at = c;
  }
  out.push({ at, size: total - at });
  return out;
}
function planTiles(cfg, grid, screens, zoom, maxTile = 4096, bleed = 8) {
  const m = Math.max(1, Math.min(64, zoom));
  const wallW = grid.wallW;
  const wallH = grid.wallH;
  const masterW = Math.max(2, Math.round(wallW * m));
  const masterH = Math.max(2, Math.round(wallH * m));
  const maxEdge = Math.max(256, Math.min(16384, Math.round(maxTile)));
  const minCols = Math.max(1, Math.ceil(masterW / maxEdge));
  const minRows = Math.max(1, Math.ceil(masterH / maxEdge));
  const gapX = [];
  for (let c = 0; c < grid.cols - 1; c++) gapX.push((c * (grid.cellW + cfg.gap) + grid.cellW + cfg.gap / 2) * m);
  const gapY = [];
  for (let r = 0; r < grid.rows - 1; r++) gapY.push((r * (grid.cellH + cfg.gap) + grid.cellH + cfg.gap / 2) * m);
  const xs = spans(masterW, bestCuts(masterW, minCols, gapX, maxEdge).cuts);
  const ys = spans(masterH, bestCuts(masterH, minRows, gapY, maxEdge).cuts);
  const tiles = [];
  for (let iy = 0; iy < ys.length; iy++) {
    for (let ix = 0; ix < xs.length; ix++) {
      const sx = xs[ix];
      const sy = ys[iy];
      const bx = Math.max(0, sx.at - bleed);
      const by = Math.max(0, sy.at - bleed);
      const bw = Math.min(masterW, sx.at + sx.size + bleed) - bx;
      const bh = Math.min(masterH, sy.at + sy.size + bleed) - by;
      tiles.push({
        ix,
        iy,
        x: sx.at,
        y: sy.at,
        w: sx.size,
        h: sy.size,
        bx,
        by,
        // encoders want even dimensions
        bw: bw % 2 ? bw + (bx + bw < masterW ? 1 : -1) : bw,
        bh: bh % 2 ? bh + (by + bh < masterH ? 1 : -1) : bh,
        file: `tile-${String(iy + 1).padStart(2, "0")}-${String(ix + 1).padStart(2, "0")}`
      });
    }
  }
  const cellW = grid.cellW * m;
  const cellH = grid.cellH * m;
  const tScreens = screens.map((s) => ({
    i: s.i,
    th: s.featured ? 0 : s.th,
    v: s.v,
    offset: s.offset,
    x: s.col * (grid.cellW + cfg.gap) * m,
    y: s.row * (grid.cellH + cfg.gap) * m,
    w: cellW,
    h: cellH
  }));
  const [ox, oy] = wallOffset(cfg, grid);
  return {
    scale: m,
    masterW,
    masterH,
    wallW,
    wallH,
    offsetX: ox,
    offsetY: oy,
    cols: xs.length,
    rows: ys.length,
    bleed,
    tiles,
    screens: tScreens,
    megapixels: tiles.reduce((n, t) => n + t.bw * t.bh / 1e6, 0),
    deadRank: Object.fromEntries(screens.map((s) => [s.i, s.dead]))
  };
}
function screensForTile(plan, t) {
  const out = [];
  for (const s of plan.screens) {
    if (s.x + s.w <= t.bx || s.x >= t.bx + t.bw || s.y + s.h <= t.by || s.y >= t.by + t.bh) continue;
    out.push({ s, x: Math.round(s.x - t.bx), y: Math.round(s.y - t.by) });
  }
  return out;
}

// src/render/tilecmd.ts
var hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  return "0x" + (m ? m[1] : "0a0a0c");
};
function startAt(offset, duration, fps) {
  if (!(duration > 0)) return 0;
  return Math.round(offset * duration * fps) / fps;
}
function tileJob(cfg, plan, tile, sources, codec, quality) {
  const here = screensForTile(plan, tile);
  const fps = Math.max(1, cfg.fps);
  const dur = Math.max(1 / fps, cfg.durationSec);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-stats_period", "0.5", "-progress", "pipe:1", "-nostdin"];
  args.push("-f", "lavfi", "-i", `color=c=${hex(cfg.bgColor)}:s=${tile.bw}x${tile.bh}:r=${fps}:d=${dur}`);
  const filters = [];
  let last = "[0:v]";
  let n = 1;
  for (const { s, x, y } of here) {
    const src = sources[s.v];
    if (!src) continue;
    const dead = plan.deadRank[s.i] * 100 < cfg.deadPct;
    if (dead) continue;
    const w = Math.max(2, Math.round(s.w));
    const h = Math.max(2, Math.round(s.h));
    const ss = startAt(s.offset, src.duration, fps);
    if (cfg.loop) args.push("-stream_loop", "-1");
    args.push("-ss", ss.toFixed(4), "-t", dur.toFixed(4), "-i", src.path);
    const fit = cfg.fill === "stretch" ? `scale=${w}:${h}` : cfg.fill === "contain" ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:${hex(cfg.bgColor)}` : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    const bits = [`fps=${fps}`, fit, "setsar=1", "format=rgba"];
    const on = cfg.animate ? cfg.revealStart + s.th / 100 * cfg.revealDuration : 0;
    if (on > 5e-4 || cfg.animate && cfg.screenAnim !== "cut") {
      const fadeD = cfg.animate && cfg.screenAnim !== "cut" ? Math.max(1, cfg.screenAnimFrames) / fps : 1 / fps;
      bits.push(`fade=t=in:st=${on.toFixed(4)}:d=${fadeD.toFixed(4)}:alpha=1`);
    }
    filters.push(`[${n}:v]${bits.join(",")}[c${n}]`);
    filters.push(`${last}[c${n}]overlay=${x}:${y}:eof_action=pass[o${n}]`);
    last = `[o${n}]`;
    n++;
  }
  filters.push(`${last}format=rgb24,scale=out_range=tv:out_color_matrix=bt709,trim=duration=${dur.toFixed(4)},setpts=PTS-STARTPTS[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-r", String(fps), "-t", dur.toFixed(4), "-an");
  if (codec === "prores") {
    args.push("-c:v", "prores_ks", "-profile:v", String(Math.max(0, Math.min(4, quality))), "-vendor", "apl0", "-pix_fmt", "yuv422p10le");
  } else {
    args.push("-c:v", "h264_videotoolbox", "-b:v", `${Math.max(4, quality)}M`, "-g", "1", "-realtime", "0", "-pix_fmt", "yuv420p");
  }
  args.push("-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv");
  if (codec !== "prores") args.push("-movflags", "+faststart");
  return { file: tile.file, args, width: tile.bw, height: tile.bh, clips: n - 1 };
}
function tileJobs(cfg, plan, sources, codec, quality, dir, ext) {
  return plan.tiles.map((t) => {
    const job = tileJob(cfg, plan, t, sources, codec, quality);
    return { ...job, args: [...job.args, `${dir}/${job.file}.${ext}`], file: `${job.file}.${ext}` };
  });
}

// scripts/render-tiles.mjs
var run = promisify(execFile);
async function probeDurations(paths, ffprobe = "ffprobe") {
  const out = /* @__PURE__ */ new Map();
  const uniq = [...new Set(paths)];
  const batch = 12;
  for (let i = 0; i < uniq.length; i += batch) {
    await Promise.all(
      uniq.slice(i, i + batch).map(async (p) => {
        try {
          const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]);
          out.set(p, parseFloat(stdout.trim()) || 0);
        } catch {
          out.set(p, 0);
        }
      })
    );
  }
  return out;
}
function manifestFor(cfg, grid, plan, files) {
  return {
    version: 1,
    compName: cfg.compName,
    frame: { w: Math.round(cfg.compW), h: Math.round(cfg.compH) },
    fps: cfg.fps,
    durationSec: cfg.durationSec,
    bg: cfg.background === "transparent" ? null : cfg.bgColor,
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
      cy: (t.by + t.bh / 2 - plan.masterH / 2) / plan.scale + plan.offsetY
    }))
  };
}
async function renderTiles(rawCfg, outDir, opts = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...rawCfg };
  const { codec = "h264", quality = codec === "prores" ? 3 : 40, maxTile = 4096, zoom, ffmpeg = "ffmpeg", ffprobe = "ffprobe", jobs = 3, onProgress = () => {
  }, shouldCancel = () => false, track = () => {
  } } = opts;
  const anim = withAnimation(cfg);
  const grid = gridFor(anim);
  const screens = planScreens(anim, grid);
  const z = zoom ?? fillZoom(anim, grid);
  const plan = planTiles(anim, grid, screens, z, maxTile);
  mkdirSync(outDir, { recursive: true });
  const durations = await probeDurations(cfg.videos, ffprobe);
  const sources = cfg.videos.map((p) => ({ path: p, duration: durations.get(p) ?? 0 }));
  const missing = sources.filter((s) => !(s.duration > 0)).length;
  const ext = codec === "prores" ? "mov" : "mp4";
  const list = tileJobs(anim, plan, sources, codec, quality, outDir, ext);
  onProgress({ phase: "start", tiles: list.length, master: [plan.masterW, plan.masterH], zoom: z, megapixels: plan.megapixels, missing });
  let done = 0;
  const queue = list.slice();
  const errors = [];
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      for (; ; ) {
        const job = queue.shift();
        if (!job || shouldCancel()) return;
        const t0 = Date.now();
        await new Promise((res) => {
          const p = spawn(ffmpeg, job.args, { stdio: ["ignore", "ignore", "pipe"] });
          track(p);
          let err = "";
          p.stderr.on("data", (d) => {
            err += d.toString().slice(0, 2e3);
          });
          p.on("close", (code) => {
            if (code !== 0) errors.push(`${job.file}: ${err.trim().split("\n").slice(-3).join(" | ")}`);
            done++;
            onProgress({ phase: "tile", done, total: list.length, file: job.file, ms: Date.now() - t0, size: [job.width, job.height], clips: job.clips, ok: code === 0 });
            res();
          });
        });
      }
    })
  );
  const manifest = manifestFor(anim, grid, plan, list.map((j) => j.file));
  writeFileSync(join(outDir, "tiles.json"), JSON.stringify(manifest, null, 2));
  onProgress({ phase: "done", errors });
  return { manifest, plan, grid, errors, jobs: list };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [cfgPath, outDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flag = (n, d) => {
    const i = process.argv.indexOf("--" + n);
    return i > 0 ? process.argv[i + 1] : d;
  };
  if (!cfgPath || !outDir) {
    console.error("usage: node scripts/render-tiles.mjs <config.json> <outDir> [--codec h264|prores] [--quality N] [--zoom N] [--max-tile N] [--jobs N]");
    process.exit(1);
  }
  const cfg = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(cfgPath, "utf8")) };
  const t0 = Date.now();
  const r = await renderTiles(cfg, outDir, {
    codec: flag("codec", "h264"),
    quality: Number(flag("quality", flag("codec", "h264") === "prores" ? 3 : 40)),
    maxTile: Number(flag("max-tile", 4096)),
    zoom: flag("zoom") ? Number(flag("zoom")) : void 0,
    jobs: Number(flag("jobs", 3)),
    onProgress: (p) => {
      if (p.phase === "start") console.log(`master ${p.master[0]}x${p.master[1]} \xB7 sharp to ${p.zoom.toFixed(1)}x \xB7 ${p.tiles} tiles \xB7 ${p.megapixels.toFixed(0)} MP/frame${p.missing ? ` \xB7 ${p.missing} unreadable sources` : ""}`);
      if (p.phase === "tile") console.log(`  ${p.ok ? "\u2713" : "\u2717"} ${p.file}  ${p.size[0]}x${p.size[1]}  ${p.clips} clips  ${(p.ms / 1e3).toFixed(1)}s   (${p.done}/${p.total})`);
    }
  });
  const bytes = r.jobs.reduce((n, j) => {
    const f = join(outDir, j.file);
    return n + (existsSync(f) ? readFileSync(f).length : 0);
  }, 0);
  console.log(`
${r.errors.length ? "\u2717 " + r.errors.length + " failed:\n   " + r.errors.join("\n   ") : "\u2713 done"}  in ${((Date.now() - t0) / 1e3).toFixed(1)}s \xB7 ${(bytes / 1e9).toFixed(2)} GB`);
  if (r.errors.length) process.exit(1);
}
export {
  manifestFor,
  probeDurations,
  renderTiles
};
