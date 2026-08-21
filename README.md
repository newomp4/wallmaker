# Wallmaker — walls of videos for After Effects

Build a perfect grid of videos — every screen identical, perfectly aligned and spaced — as **real, editable After Effects layers**, and zoom out of one of them to reveal the whole wall.

Point it at a folder of videos (or select comps right in your project), choose the grid, and press **Build**: every screen is a real layer (masked, scaled, randomly offset in time), the wall hangs off a **Wallmaker Controls** null, and that null hangs off a **Wallmaker Camera** null whose zoom is one keyframable slider you own.

## What it does

**Sources**
- A folder of videos (searched recursively), individual files, drag & drop — or **comps from your open project** ("From selection"): they render live on the wall, no export needed.
- Fewer sources than screens? They repeat — shuffled by default, so duplicates scatter across the wall instead of running in order, and the leftover cells are filled by a random pick rather than always the first few files.
- Duplicates of one clip get **stratified start points**: their offsets are spread across the clip rather than drawn independently, so two copies never sit on the same frame and read as one video.
- Every screen can start at a **random point** in its clip, looped, muted — a wall of one video won't look synchronized.

**The grid**
- Automatic rows × columns from your source count, or set them yourself — 2×2 to 1000+ screens. Every cell is exactly the same size.
- **Cell shape lock**: keep every screen 16:9 / 4:3 / 1:1 / 9:16 / custom — the wall centers itself instead of stretching; or fill the comp edge-to-edge.
- **No black bands, two ways.** A locked cell shape only reaches the comp edges when the grid happens to match the comp's aspect. The panel always tells you how big the bands are, and you pick how to kill them:
  - **Fit exactly** — one click solves for the rows × columns *and gap* that reach the edges with cells of exactly that shape. 9:16 screens in a 1920×1080 comp: 3 × 9 at a 21.08 px gap.
  - **Wall: Cover** — keep your shape *and* your gap, and add whole rows/columns until the wall runs past the comp edges. The outer screens are simply cut off by the frame. 9:16 at gap 8 becomes 3 × 10 with 6 screens off-frame — and the sources are dealt onto the in-frame cells first, so every clip is still seen and the cut-off cells hold the duplicates.
- Gap, outer margin, rounded corners. Video fit per screen: Fill (crop), Fit (letterbox) or Stretch.
- **Arrangements** — one-click grid presets (Auto, Edge to edge, 16:9 cells, 3×3, 4×3, 5×5, Spaced).
- A **quick bar** under the live preview holds the tune-while-you-watch controls (grid, gap, cell shape, seed).
- Background: one solid color, or nothing at all. Grading, glow and texture belong on your own layers above the wall — this tool does not do looks.

**The camera — the zoom-out**
- Pick a **centered screen**: one source (file or comp) pinned to the middle cell, always on, playing from its start, kept out of the general rotation. Same size as everything else. **Click any screen in the preview** to move its video to the centre (click the centre one to clear it); it's ringed on the wall and named under the preview.
- A middle cell only exists on an **odd grid**, so while a screen is centered the rows and columns round up to odd — otherwise "centered" would sit half a cell off (a 4 × 4 wall has no middle).
- Turn on **Start on the centered screen, pull back to the wall** and/or **Push back into it at the end**. That's the "start inside my video, zoom out into a wall of videos" shot, in two clicks.
- In AE the move is **one keyframed slider**: `Zoom to screen (%)` on the Wallmaker Camera null — 0 = the whole wall, 100 = that screen filling the comp. Retime the keys, re-ease them in the graph editor, replace them entirely, drive them from another property. A rebuild **never touches keyframes you have edited**.
- `Target column` / `Target row` (keyframe them to fly between screens), `Extra scale (%)` and `Pan (px)` layer your own move on top of the zoom.

**The power-on** *(off by default — the base wall is simply on)*
- Turn on **Animate the power-on** and screens come alive one by one: random, row by row, column by column, reading order, snake, center-out, spiral-out, edges-in, or diagonally — with adjustable randomness, a start time, and one number for how long until **all** screens are on.
- Per-screen style: **Cut**, **Fade**, **Flicker** (stutters on like a tube warming up) or **Scale up** — over any number of frames.
- **Dead screens**: monitors that never come on, with or without the reveal.
- Deterministic from a seed; the preview plays exactly what AE will do.

**Fast preview**
- One toggle in the Build tab swaps every source for a **solid proxy of its own exact dimensions**, so AE stops decoding video entirely — the expensive part of a big wall. Flip it back before you render.
- Nothing about the layers changes: same parenting, transforms, masks, expressions and in/out points. The test suite renders the same frames three ways (real → proxies → real) and asserts the **alpha channel is identical byte for byte**, every screen's evaluated position/scale/opacity is exactly equal, and turning it off reproduces the original frames byte for byte.
- Caveats worth knowing: a solid proxy is opaque, so a source with its own alpha renders as a filled rectangle while it's on; and proxying a *comp* affects that comp everywhere it's used in your project (standard AE proxy behaviour — the toggle undoes it).

**In After Effects — live, no rebuild**
- Move / scale / rotate the **Wallmaker Controls** null → the whole wall follows. Animate the **Wallmaker Camera** null's controls → the shot follows.
- Sliders drive the wall through expressions: **Gap (px)** (keyframe it — the screens fly apart), **Reveal start / duration (s)**, **Turn-on (frames)**, **Dead screens (%)**, **Screen scale (%)**, **Screens opacity (%)**.
- Each `Screen 001…` is a normal layer — swap its source, restyle it, parent things to it.
- Building again with the same comp name **updates the comp in place**: sliders and keyframes you changed keep your values, untouched ones follow the panel, and any layers you added survive.

## Install

```bash
git clone https://github.com/newomp4/wallmaker.git
cd wallmaker
npm install
npm run cep:install
```

Then (re)start After Effects (2024 or newer) → **Window ▸ Extensions ▸ Wallmaker**.

> The installer copies the panel into Adobe's CEP extensions folder and switches on CEP's PlayerDebugMode so the unsigned, self-built panel is allowed to load. `npm run cep:uninstall` removes it.

## Use

1. **Sources** — a folder, files, or your Project-panel selection (footage *and* comps).
2. **Wall** — arrangement, grid, cell shape, gap, fit, background, comp settings.
3. **Camera** — the center screen and the zoom.
4. **Animate** — the power-on (optional).
5. **Build** — one click; the comp opens when done.

> Power-on animation is **off by default** — the base wall is simply on. Everything animated is opt-in.

## Development

```bash
npm run dev        # the panel UI in a normal browser (preview works, AE features are stubbed)
npm run typecheck  # tsc
npm run lint       # oxlint
npm run cep:link   # symlink the panel into CEP extensions (rebuild + reopen panel to see changes)
```

The automated tests build real walls inside After Effects and verify both the rendered pixels and the evaluated expressions — see [DEVELOPER.md](DEVELOPER.md).

## License

MIT — see [LICENSE](LICENSE). Not affiliated with Adobe.
