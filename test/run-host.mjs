#!/usr/bin/env node
/**
 * Host-level test rounds: compiles wall scenes under Node (the exact code the panel runs),
 * drives the running After Effects via AppleScript DoScript to build them with cep/host/index.jsx,
 * then verifies pixels (snapshots) and evaluated expressions (probes) with test/verify.py.
 *
 * ⚠ Closes the current AE project WITHOUT saving and builds in a fresh one.
 * Usage: node test/run-host.mjs [A] [B]   (default: both rounds)
 */
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, '.test-assets')
const outRoot = join(root, '.test-out')
const AE = 'Adobe After Effects 2025'

if (!existsSync(join(assets, 'colors.json'))) execFileSync('node', [join(root, 'scripts/make-test-videos.mjs')], { stdio: 'inherit' })

const clips = (n) => Array.from({ length: n }, (_, i) => join(assets, `clip-${String(i + 1).padStart(2, '0')}.mp4`))

// A deliberately long filename. AE caps a solid proxy's name at 31 BYTES, so fast preview has to
// truncate -- with short test names that limit was never reached and the bug shipped.
const LONG_NAME = 'a-very-long-source-filename-that-would-blow-the-limit.mp4'
const LONG_CLIP = join(assets, LONG_NAME)
if (!existsSync(LONG_CLIP)) copyFileSync(join(assets, 'clip-01.mp4'), LONG_CLIP)

const ROUNDS = {
  A: {
    // straightforward wall: 3x4, one solid-color clip per screen, fade reveal, no camera move
    cfg: {
      videos: clips(12),
      compName: 'Wallmaker test A',
      compW: 1920, compH: 1080, fps: 30, durationSec: 10,
      gridMode: 'manual', rows: 3, cols: 4, gap: 8, margin: 40,
      fill: 'stretch', cornerRadius: 0, assign: 'sequential',
      randomStart: true, loop: true, muteAudio: true,
      background: 'solid', bgColor: '#101014',
      animate: true, reveal: 'random', revealStart: 0.5, revealDuration: 5,
      screenAnim: 'fade', screenAnimFrames: 6, jitter: 0.2, deadPct: 0, seed: 3,
    },
    times: [0.2, 3.0, 8.0],
  },
  B: {
    // stress + variance: 10x10 vertical, source reuse, dead screens, scale-up power-on, contain fit
    cfg: {
      videos: [...clips(12), join(assets, 'pattern-hd.mp4'), join(assets, 'pattern-vertical.mp4')],
      compName: 'Wallmaker test B',
      compW: 1080, compH: 1920, fps: 24, durationSec: 12,
      gridMode: 'manual', rows: 10, cols: 10, gap: 4, margin: 0,
      fill: 'contain', cornerRadius: 6, assign: 'shuffle',
      randomStart: true, loop: true, muteAudio: true,
      background: 'solid', bgColor: '#05070a',
      animate: true, reveal: 'center', revealStart: 1, revealDuration: 6,
      screenAnim: 'pop', screenAnimFrames: 10, jitter: 0.1, deadPct: 20, seed: 11,
    },
    times: [0.5, 4.37, 9.43],
  },
  D: {
    // rounded corners, a comp as a source, a spiral flicker-on sweep, an outer margin
    cfg: {
      videos: clips(10),
      compName: 'Wallmaker test D',
      compW: 1920, compH: 1080, fps: 30, durationSec: 10,
      gridMode: 'manual', rows: 6, cols: 6, gap: 8, margin: 20,
      fill: 'cover', cornerRadius: 26, assign: 'sequential',
      randomStart: true, loop: true, muteAudio: true,
      background: 'solid', bgColor: '#0b0b0e',
      animate: true, reveal: 'spiral', revealStart: 0.4, revealDuration: 4,
      screenAnim: 'flicker', screenAnimFrames: 10, jitter: 0, deadPct: 0, seed: 21,
    },
    times: [0.15, 1.35, 2.4, 7.0], // three inside the flicker sweep so a mid-flicker sample is never a fluke
    // the runner swaps one video for a freshly created solid-color comp (tests comps as sources)
    compSource: { name: 'WM comp source', hex: '2ECC71' },
  },
  G: {
    // 'cover': 9:16 cells keep their exact shape and the outer screens run off the comp edges
    cfg: {
      videos: [...clips(7), LONG_CLIP],
      compName: 'Wallmaker test G',
      compW: 1920, compH: 1080, fps: 30, durationSec: 8,
      gridMode: 'manual', rows: 3, cols: 9, gap: 8, margin: 0,
      cellAspect: 'tall', wallFit: 'cover',
      fill: 'cover', cornerRadius: 12, assign: 'shuffle',
      randomStart: true, loop: true, muteAudio: true,
      // transparent so the proxy check can compare the ALPHA channel: pure coverage, no colour
      background: 'transparent', bgColor: '#0a0a0c',
      animate: false, reveal: 'random', revealStart: 0, revealDuration: 0,
      screenAnim: 'cut', screenAnimFrames: 1, jitter: 0, deadPct: 0, seed: 4,
    },
    times: [0.3, 3.0, 6.5],
    extraColors: { [LONG_NAME]: JSON.parse(readFileSync(join(assets, 'colors.json'), 'utf8'))['clip-01.mp4'] },
    proxy: true, // also verifies fast preview: identical geometry, identical restore
  },
  F: {
    // THE use case: aspect-locked identical cells, one source centered, zoom out then back in
    cfg: {
      videos: clips(9),
      compName: 'Wallmaker test F',
      compW: 1920, compH: 1080, fps: 30, durationSec: 10,
      gridMode: 'manual', rows: 4, cols: 5, gap: 6, margin: 0,
      cellAspect: 'wide',
      featured: 4, centerFit: 'shift', // keeps the even 4x5 grid and nudges the wall instead
      intro: 'zoomOut', introHold: 1, introDur: 2,
      outro: 'zoomIn', outroHold: 0.4, outroDur: 2,
      fill: 'cover', cornerRadius: 0, assign: 'sequential',
      randomStart: true, loop: true, muteAudio: true,
      background: 'solid', bgColor: '#0d0d10',
      animate: false, reveal: 'random', revealStart: 0, revealDuration: 0,
      screenAnim: 'cut', screenAnimFrames: 1, jitter: 0, deadPct: 0, seed: 9,
    },
    times: [0.5, 5.0, 9.8],
  },
}

const argRounds = process.argv.slice(2)
const unknown = argRounds.filter((a) => !ROUNDS[a])
if (unknown.length) {
  console.error(`Unknown round(s): ${unknown.join(', ')} — valid: ${Object.keys(ROUNDS).join(', ')} (round C lives in run-panel.mjs, E in run-rebuild.mjs)`)
  process.exit(1)
}
const runs = argRounds.length ? argRounds : ['A', 'B', 'D', 'F', 'G']

for (const key of runs) {
  const round = ROUNDS[key]
  const dir = join(outRoot, key)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const cfgPath = join(dir, 'config.json')
  const wallPath = join(dir, 'wall.json')
  writeFileSync(cfgPath, JSON.stringify(round.cfg, null, 2))
  execFileSync('npx', ['tsx', join(root, 'test/make-scene.ts'), cfgPath, wallPath], { stdio: 'inherit', cwd: root })
  const wall = JSON.parse(readFileSync(wallPath, 'utf8'))

  const extra = { ...(round.extraColors ?? {}), ...(round.compSource ? { [round.compSource.name]: round.compSource.hex } : {}) }
  if (Object.keys(extra).length) writeFileSync(join(dir, 'extra-colors.json'), JSON.stringify(extra))
  const runner = makeRunner({ wallPath, dir, compName: wall.compName, times: round.times, compSource: round.compSource })
  const runnerPath = join(dir, 'runner.jsx')
  writeFileSync(runnerPath, runner)
  rmSync(join(dir, 'result.json'), { force: true })

  console.log(`\n=== Round ${key}: building ${wall.screens.length} screens in After Effects…`)
  const t0 = Date.now()
  execSync(
    `osascript -e 'with timeout of 900 seconds' -e 'tell application "${AE}" to DoScript "$.evalFile(\\"${runnerPath}\\")"' -e 'end timeout'`,
    { stdio: 'inherit' },
  )
  // saveFrameToPng is async — wait for result.json, check it, THEN wait for stable png sizes
  await waitFor(() => existsSync(join(dir, 'result.json')), 120000, 'result.json')
  const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))
  if (!result.ok) throw new Error(`Round ${key} build failed in AE: ${result.error}`)
  await waitForStablePngs(dir, round.times)
  console.log(`Round ${key} built in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(result.finish))

  console.log(`Round ${key}: verifying…`)
  execFileSync('python3', [join(root, 'test/verify.py'), dir], { stdio: 'inherit' })

  if (round.proxy) {
    // Fast preview must not move ANYTHING. Render the same frames three ways -- real footage,
    // solid proxies, real footage again -- in separate DoScript passes so a queued saveFrameToPng
    // can never straddle a proxy toggle, then compare geometry and pixels.
    for (const pass of [
      { tag: 'proxy', on: true },
      { tag: 'restored', on: false },
    ]) {
      const rp = join(dir, `runner-${pass.tag}.jsx`)
      rmSync(join(dir, `result-${pass.tag}.json`), { force: true })
      writeFileSync(rp, makeProxyRunner({ dir, compName: wall.compName, buildKey: wall.buildKey, times: round.times, ...pass }))
      execSync(`osascript -e 'with timeout of 600 seconds' -e 'tell application "${AE}" to DoScript "$.evalFile(\\"${rp}\\")"' -e 'end timeout'`, { stdio: 'inherit' })
      await waitFor(() => existsSync(join(dir, `result-${pass.tag}.json`)), 120000, `result-${pass.tag}.json`)
      const pr = JSON.parse(readFileSync(join(dir, `result-${pass.tag}.json`), 'utf8'))
      if (!pr.ok) throw new Error(`Round ${key} ${pass.tag} pass failed in AE: ${pr.error}`)
      await waitForStablePngs(dir, round.times, `snap-${pass.tag}-`)
      console.log(`Round ${key}: ${pass.tag} pass — ${JSON.stringify(pr.state)}`)
    }
    execFileSync('python3', [join(root, 'test/verify-proxy.py'), dir], { stdio: 'inherit' })
  }
  console.log(`✓ Round ${key} passed`)
}
console.log('\n✓ all host rounds passed')

function makeRunner({ wallPath, dir, compName, times, compSource }) {
  const j = (v) => JSON.stringify(JSON.stringify(v)) // ES3 string literal containing JSON
  // optionally create a solid-color comp and swap it in for the last source before begin()
  const compSrc = compSource
    ? `  var srcComp = app.project.items.addComp(${JSON.stringify(compSource.name)}, 640, 360, 1, 6, 30);
  srcComp.layers.addSolid([${parseInt(compSource.hex.slice(0, 2), 16) / 255}, ${parseInt(compSource.hex.slice(2, 4), 16) / 255}, ${parseInt(compSource.hex.slice(4, 6), 16) / 255}], 'color', 640, 360, 1, 6);
  var wallData = WALLMAKER_JSON.parse((function () { var f = new File(${JSON.stringify(wallPath)}); f.encoding = 'UTF-8'; f.open('r'); var t = f.read(); f.close(); return t; })());
  var lastV = wallData.videos.length - 1;
  wallData.videos[lastV] = { compId: srcComp.id, name: ${JSON.stringify(compSource.name)} };
  (function () { var f = new File(${JSON.stringify(wallPath)}); f.encoding = 'UTF-8'; f.open('w'); f.write(WALLMAKER_JSON.stringify(wallData)); f.close(); })();
`
    : ''
  let probes = ''
  let snaps = ''
  for (const t of times) {
    probes += `  probes[${j(String(t))}.replace(/"/g, '')] = WALLMAKER_JSON.parse(WALLMAKER.probe(${j({ compName, time: t })}));\n`
    probes += `  cams[${j(String(t))}.replace(/"/g, '')] = WALLMAKER_JSON.parse(WALLMAKER.camState(${j({ compName, time: t })}));\n`
    snaps += `  WALLMAKER.snapshot(${j({ compName, time: t, path: `${dir}/snap-${t}.png` })});\n`
  }
  return `// generated by test/run-host.mjs -- ES3
try { app.preferences.savePrefAsLong('Main Pref Section', 'Pref_SCRIPTING_FILE_NETWORK_SECURITY', 1); } catch (e) {}
$.evalFile(${JSON.stringify(join(root, 'cep/host/index.jsx'))});
function WRITE(name, s) {
  var f = new File(${JSON.stringify(dir)} + '/' + name);
  f.encoding = 'UTF-8';
  f.open('w');
  f.write(s);
  f.close();
}
try {
  try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e) {}
  app.newProject();
${compSrc}  WALLMAKER.begin(${j({ jsonPath: wallPath, folder: dir })});
  var guard = 0;
  while (guard++ < 1000) {
    var s = WALLMAKER_JSON.parse(WALLMAKER.step('{"count":25}'));
    if (s.done >= s.total) break;
  }
  var fin = WALLMAKER.finish();
  var layersJ = WALLMAKER_JSON.parse(WALLMAKER.layers(${j({ compName })}));
  var probes = {};
  var cams = {};
${probes}
${snaps}
  WRITE('result.json', WALLMAKER_JSON.stringify({ ok: true, finish: WALLMAKER_JSON.parse(fin), probes: probes, cams: cams, layers: layersJ }));
} catch (e) {
  WRITE('result.json', WALLMAKER_JSON.stringify({ ok: false, error: String(e && e.message ? e.message + ' (line ' + e.line + ')' : e) }));
}
`
}

/** A pass that flips fast preview and re-renders the same frames. */
function makeProxyRunner({ dir, compName, buildKey, times, tag, on }) {
  const j = (v) => JSON.stringify(JSON.stringify(v))
  let body = ''
  for (const t of times) {
    body += `  probes[${JSON.stringify(String(t))}] = WALLMAKER_JSON.parse(WALLMAKER.probe(${j({ compName, time: t })}));\n`
    body += `  srcs[${JSON.stringify(String(t))}] = WALLMAKER_JSON.parse(WALLMAKER.sourceDims(${j({ compName })}));\n`
    body += `  WALLMAKER.snapshot(${j({ compName, time: t, path: `${dir}/snap-${tag}-${t}.png` })});\n`
  }
  return `// generated by test/run-host.mjs -- ES3
$.evalFile(${JSON.stringify(join(root, 'cep/host/index.jsx'))});
function WRITE(name, s) { var f = new File(${JSON.stringify(dir)} + '/' + name); f.encoding = 'UTF-8'; f.open('w'); f.write(s); f.close(); }
try {
  var state = WALLMAKER_JSON.parse(WALLMAKER.proxies(${j({ buildKey, on })}));
  var probes = {};
  var srcs = {};
${body}  WRITE('result-${tag}.json', WALLMAKER_JSON.stringify({ ok: true, state: state, probes: probes, srcs: srcs }));
} catch (e) {
  WRITE('result-${tag}.json', WALLMAKER_JSON.stringify({ ok: false, error: String(e && e.message ? e.message + ' (line ' + e.line + ')' : e) }));
}
`
}

function waitFor(fn, ms, what) {
  return new Promise((res, rej) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (fn()) {
        clearInterval(iv)
        res()
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv)
        rej(new Error(`timed out waiting for ${what}`))
      }
    }, 250)
  })
}

async function waitForStablePngs(dir, times, prefix = 'snap-') {
  for (const t of times) {
    const p = join(dir, `${prefix}${t}.png`)
    await waitFor(() => existsSync(p), 60000, p)
    let last = -1
    await waitFor(() => {
      try {
        const s = statSync(p).size
        const stable = s > 0 && s === last
        last = s
        return stable
      } catch {
        return false
      }
    }, 60000, `${p} to stop growing`)
  }
}
