# Wallmaker — developer notes

Architecture (deliberately the same shape as [TwitchSim](https://github.com/newomp4/twitchsim)): a Vite + React + TS panel UI and an ExtendScript (ES3) host, talking through Adobe CEP.

```
Config (src/core/types.ts)
  └► planScreens() / gridFor()   src/core/reveal.ts, grid.ts   ★ SHARED MATH
        ├► panel preview          src/ui/Preview.tsx  (canvas, plays the reveal)
        └► compileWall()          src/core/scene.ts → wall.json
              └► cep/host/index.jsx (ExtendScript) → footage, layers, masks, expressions
```

**The golden rule:** the preview and the AE build consume the *same plan* (`planScreens`) and the AE
expressions mirror `screenStateAt()`. Change one side and you change both — that's what the tests check.

## Key files

| | |
|---|---|
| `src/core/reveal.ts` | ★ thresholds / dead ranks / offsets — the wall plan, deterministic from the seed |
| `src/core/scene.ts` | Config → `wall.json` (pure, also runs under Node for the tests) |
| `src/ae/cep.ts` | CEP bridge: evalScript, file IO, folder listing (no-op outside AE) |
| `src/ae/build.ts` | begin → step… → finish batching (evalScript blocks the panel thread; small batches keep it responsive) |
| `cep/host/index.jsx` | ★ ES3 host: imports footage, builds screens/masks/labels, writes the expressions |
| `test/run-host.mjs` | rounds A, B, D, F: build via AppleScript `DoScript` into the running AE, then verify |
| `test/run-rebuild.mjs` | round E: build → user customizes → rebuild in place → remove; asserts nothing is lost or duplicated |
| `test/run-panel.mjs` | round C: drives the real panel over the CEF debug port (8724) |
| `test/verify.py` | asserts probes (post-expression opacity per screen) and snapshot pixels vs the plan — including a model check of the Focus falloff |

## The expressions

Every screen layer gets Position / Scale / Opacity expressions that read sliders on the
**Wallmaker Controls** null (falling back to the built values if the null is renamed/deleted):

- Position: `(col - (cols-1)/2) * (cellW + Gap)` — live `Gap (px)`.
- Opacity: threshold `th` (baked per screen) → on-time `= Reveal start + th/100 * Reveal duration`;
  then cut / fade / flicker (seedRandom per frame) / pop.
- Dead: baked random rank vs the live `Dead screens (%)` slider; dropouts hash a per-second block
  through `seedRandom`. The Focus null factors in as a smoothstep falloff on scale and opacity.
- Comp sources loop through a time-remap **expression** (`(off + time) % srcDur`) — footage
  interpretation looping only exists for files. Enable `timeRemapEnabled` BEFORE extending
  `outPoint`, or AE clamps the layer to the source span (that was a real bug).

The reveal is **time-based** (scrub the timeline and the wall powers on), controls are **live**
(retime without rebuilding), the **order** is baked (change it in the panel and rebuild).

**The rebuild contract** (round E verifies both directions): a JSON record after `|` in the
Controls null's comment stores every slider value the builder last wrote. On rebuild, an
untouched slider (no keys, value still equals the record) FOLLOWS the panel; a changed or
keyframed slider is the user's and is kept. Disabled features get their sliders removed so a
stale value can't keep driving expressions. The camera similarly owns the null's
Scale/Position only while enabled (a ` cam` marker in the comment), and `planCamera` clamps
all key times ONCE in shared code so the preview and the keyframes cannot disagree.

## ES3 landmines (host/index.jsx)

ASCII only, semicolons everywhere, no trailing commas, no array methods, `var` only.
Never build a string with `+ someArray/Error` — `String(x)` first. Text layers: exactly ONE scripted
TextDocument write per build (AE leaks undo objects per set — labels are duplicates of one template
with a `sourceText` *expression*, never per-label TextDocument writes).

## Testing

```bash
npm run test:unit     # pure-core unit tests (plan determinism, grid/camera math, thresholds)
npm run test:videos   # ffmpeg: 12 solid-color clips + 2 patterned, .test-assets/
npm run test:host     # rounds A+B+D — ⚠ closes the current AE project without saving
npm run test:rebuild  # round E (rebuild-in-place / remove lifecycle) — same warning
npm run test:panel    # round C — needs the panel installed & open (npm run cep:install, restart AE)
```

Round D covers the feature set (hero 2×2 screens, borders, scanlines, Focus falloff vs the math
model, and a comp as a source — the runner creates a solid-color comp and swaps it into the plan).
Round F covers aspect-locked cells + the featured screen + the camera: `ctlState` returns the
Controls null's evaluated Scale/Position per time, and the verifier checks zoomed frames are
literally the featured source's pixels corner-to-corner, neutral frames match the cell grid, and
the letterbox band above an aspect-locked wall is background.

Verification is two-layered: `probe` returns every screen's **post-expression opacity** at a time
(asserted exactly against the plan), and `snapshot` (saveFrameToPng) frames are checked
**pixel-by-pixel** — each solid-color test clip must show its color at its cell center once on,
and the background where off/dead. `saveFrameToPng` is async: wait for the file to stop growing.
