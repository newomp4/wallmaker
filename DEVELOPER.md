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
| `test/run-host.mjs` | rounds A & B: build via AppleScript `DoScript` into the running AE, then verify |
| `test/run-panel.mjs` | round C: drives the real panel over the CEF debug port (8724) |
| `test/verify.py` | asserts probes (post-expression opacity per screen) and snapshot pixels vs the plan |

## The expressions

Every screen layer gets Position / Scale / Opacity expressions that read sliders on the
**Wallmaker Controls** null (falling back to the built values if the null is renamed/deleted):

- Position: `(col - (cols-1)/2) * (cellW + Gap)` — live `Gap (px)`.
- Opacity: threshold `th` (baked per screen) → on-time `= Reveal start + th/100 * Reveal duration`;
  then cut / fade / flicker (seedRandom per frame) / pop.
- Dead: baked random rank vs the live `Dead screens (%)` slider.

The reveal is **time-based** (scrub the timeline and the wall powers on), controls are **live**
(retime without rebuilding), the **order** is baked (change it in the panel and rebuild).

## ES3 landmines (host/index.jsx)

ASCII only, semicolons everywhere, no trailing commas, no array methods, `var` only.
Never build a string with `+ someArray/Error` — `String(x)` first. Text layers: exactly ONE scripted
TextDocument write per build (AE leaks undo objects per set — labels are duplicates of one template
with a `sourceText` *expression*, never per-label TextDocument writes).

## Testing

```bash
npm run test:videos   # ffmpeg: 12 solid-color clips + 2 patterned, .test-assets/
npm run test:host     # rounds A+B — ⚠ closes the current AE project without saving
npm run test:panel    # round C — needs the panel installed & open (npm run cep:install, restart AE)
```

Verification is two-layered: `probe` returns every screen's **post-expression opacity** at a time
(asserted exactly against the plan), and `snapshot` (saveFrameToPng) frames are checked
**pixel-by-pixel** — each solid-color test clip must show its color at its cell center once on,
and the background where off/dead. `saveFrameToPng` is async: wait for the file to stop growing.
