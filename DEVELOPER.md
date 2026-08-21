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
| `cep/host/index.jsx` | ★ ES3 host: imports footage, builds the rig + screens/masks, writes the expressions and camera keys |
| `test/run-host.mjs` | rounds A, B, D, F: build via AppleScript `DoScript` into the running AE, then verify |
| `test/run-rebuild.mjs` | round E: build → user customizes → rebuild in place → remove; asserts nothing is lost or duplicated |
| `test/run-panel.mjs` | round C: drives the real panel over the CEF debug port (8724) |
| `test/verify.py` | asserts probes (post-expression opacity per screen), the camera rig (keys + evaluated transform) and snapshot pixels vs the plan |

## The rig

Two nulls, and nothing else structural:

```
Wallmaker Camera   <- Position + Scale are EXPRESSIONS; the move lives on its 'Zoom to screen (%)' keys
  └ Wallmaker Controls   <- at the camera's origin; its sliders drive every screen expression
      └ Screen 001 ... Screen NNN
Background (unparented, full frame)
```

The camera's expressions are, exactly:

```
S = (100 + Z*(fullScale - 100)) * ExtraScale        // Scale
P = compCenter + Pan - ExtraScale*Z*(fullScale/100)*targetOffset
targetOffset = (TargetCol - (cols-1)/2) * (cellW + Gap),  same for rows
```

`Z` is `Zoom to screen (%) / 100`. Because the offset is recomputed from the **live** Gap slider and
the target is addressed in **cell coordinates**, the move stays correct when the user changes Gap,
and keyframing `Target column/row` flies the camera between screens. `cameraAt()` in
`src/core/reveal.ts` evaluates the identical formula for the preview (its easing is a smoothstep
approximation of AE's easy-ease — retiming in the graph editor is expected to diverge).

## The expressions

Every screen layer gets Position / Scale / Opacity expressions that read sliders on the
**Wallmaker Controls** null (falling back to the built values if the null is renamed/deleted):

- Position: `(col - (cols-1)/2) * (cellW + Gap)` — live `Gap (px)`.
- Opacity: threshold `th` (baked per screen) → on-time `= Reveal start + th/100 * Reveal duration`;
  then cut / fade / pop (pop animates on Scale, so opacity is 1 while it grows).
- Dead: baked random rank vs the live `Dead screens (%)` slider. The centered screen bypasses
  the whole gate — pinned means pinned.
- Comp sources loop through a time-remap **expression** (`(off + time) % srcDur`) — footage
  interpretation looping only exists for files. Enable `timeRemapEnabled` BEFORE extending
  `outPoint`, or AE clamps the layer to the source span (that was a real bug).

The reveal is **time-based** (scrub the timeline and the wall powers on), controls are **live**
(retime without rebuilding), the **order** is baked (change it in the panel and rebuild).

**The rebuild contract** (round E verifies both directions, for sliders *and* camera keyframes):
a JSON record after `|` in each rig null's comment stores every value the builder last wrote —
slider values, point-control values, and the camera's keyframe list. On rebuild:

- an untouched slider (no keys, value still equals the record) FOLLOWS the panel;
- a changed or keyframed slider is the user's and is kept;
- the camera's `Zoom to screen (%)` keys are rewritten only if they still match the record
  **exactly — count, times, values AND easing** (`keysAreOurs`); anything else is a hand edit and is
  left completely alone (`finish()` reports `keptCamKeys: true`);
- controls belonging to removed features are deleted so a stale value can't keep driving anything.

`planCamera` clamps all key times ONCE in shared code, so the preview and the written keyframes
cannot disagree. Builds made by the pre-rig version are migrated on rebuild (`rec.__v < 2`: the old
camera keys on the Controls null were ours, so they are cleared and the null is re-parented).

## ES3 landmines (host/index.jsx)

ASCII only, semicolons everywhere, no trailing commas, no array methods, `var` only.
Never build a string with `+ someArray/Error` — `String(x)` first. If you ever add text layers back:
exactly ONE scripted TextDocument write per build (AE leaks undo objects per set — duplicate a
template and drive the copies with a `sourceText` *expression*).

The centred screen is deliberately findable in AE: named `Center · <source>`, comment
`wallmaker-screen <i> center`, label colour 9, and lifted to the top of the screen stack by
`finish()`. `verify.py` asserts all four (and that nothing else wears the colour).

## The two view switches

`WALLMAKER.layout({buildKey, on})` enables the `Wallmaker Layout` shape layer (all cells as one
repeater-driven rectangle grid, drawn from the same numbers and the same live `Gap (px)` slider as
the screens) and disables every screen layer. `WALLMAKER.proxies` is independent; either works alone.
The state is remembered in the Controls null's record (`__layout`) so a rebuild comes back the way
you were working.

**AE rewrites a child's transform when you parent it**, to preserve its world transform — and the
camera's Scale is an *expression* that may evaluate to 900% at the current time. Set position AND
scale AFTER `layer.parent = …` or the child inherits the inverse of the zoom. This bit the Controls
null once and the layout layer once; round G now carries a camera move so the alignment check runs
against a non-identity camera scale and would catch it a third time.

## Fast preview (proxies)

`WALLMAKER.proxies({buildKey, on})` gives every source an `AVItem.setProxyWithSolid(color, name,
width, height, pixelAspect)` — note **five** args, no duration; passing six throws — using the
source's own width/height/pixel aspect, then flips `useProxy`. The layers are never touched, so
geometry cannot drift: AE maps source pixels through the layer transform, and identical source
dimensions give identical device pixels. Sources that already have a proxy keep it and are just
switched on/off.

Round G proves it rather than asserting it: it renders the same frames real -> proxied -> real in
three separate `DoScript` passes (a queued `saveFrameToPng` must never straddle a toggle) on a
**transparent** background, so `test/verify-proxy.py` can compare the ALPHA channel — pure coverage,
independent of colour — and require it identical to the byte, plus exact equality of every screen's
evaluated position/scale/opacity and a byte-for-byte restore.

Reply keys must never be called `error`: `callHost` throws on any reply carrying one.
`setProxyWithSolid`'s *name* is capped at **31 bytes** — a real filename blows it, and every source
refuses. Round G's sources include a 57-character filename so the limit is actually exercised.

## Testing

```bash
npm run test:unit     # pure-core unit tests (plan determinism, grid/camera math, thresholds)
npm run test:videos   # ffmpeg: 12 solid-color clips + 2 patterned, .test-assets/
npm run test:host     # rounds A+B+D+F+G — ⚠ closes the current AE project without saving
npm run test:rebuild  # round E (rebuild-in-place / remove lifecycle) — same warning
npm run test:panel    # round C — needs the panel installed & open (npm run cep:install, restart AE)
```

Round D covers rounded corners, an ordered sweep, an outer margin and **a comp as a source** (the
runner creates a solid-color comp and swaps it into the plan). Round F covers THE use case:
aspect-locked identical cells + a centered screen + zoom out and back in. `camState` returns the
camera null's evaluated Scale/Position, the live `Zoom to screen (%)` value and its keyframe list,
and the verifier checks the keys match `planCamera` exactly, zoomed frames are literally the
centered source's pixels corner-to-corner, neutral frames match the cell grid, and the letterbox
band above an aspect-locked wall is background.

Every round also asserts **cell uniformity** (screens sharing a source must render at one identical
scale) and that the comp contains *exactly* the rig + screens + background — no stale layers from
an older build, nothing missing.

Verification is two-layered: `probe` returns every screen's **post-expression opacity** at a time
(asserted exactly against the plan), and `snapshot` (saveFrameToPng) frames are checked
**pixel-by-pixel** — each solid-color test clip must show its color at its cell center once on,
and the background where off/dead. `saveFrameToPng` is async: wait for the file to stop growing.
