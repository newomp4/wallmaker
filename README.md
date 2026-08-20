# Wallmaker — walls of videos for After Effects

Build a perfect grid of videos — every screen identical, perfectly aligned and spaced — as **real, editable After Effects layers**, and zoom out of one of them to reveal the whole wall.

Point it at a folder of videos (or select comps right in your project), choose the grid, and press **Build**: every screen is a real layer (masked, scaled, randomly offset in time), the wall hangs off a **Wallmaker Controls** null, and that null hangs off a **Wallmaker Camera** null whose zoom is one keyframable slider you own.

## What it does

**Sources**
- A folder of videos (searched recursively), individual files, drag & drop — or **comps from your open project** ("From selection"): they render live on the wall, no export needed.
- Fewer sources than screens? They repeat (in order, shuffled evenly, or picked at random).
- Every screen can start at a **random point** in its clip, looped, muted — a wall of one video won't look synchronized.

**The grid**
- Automatic rows × columns from your source count, or set them yourself — 2×2 to 1000+ screens. Every cell is exactly the same size.
- **Cell shape lock**: keep every screen 16:9 / 4:3 / 1:1 / 9:16 / custom — the wall centers itself instead of stretching; or fill the comp edge-to-edge.
- Gap, outer margin, rounded corners. Video fit per screen: Fill (crop), Fit (letterbox) or Stretch.
- **Arrangements** — one-click grid presets (Auto, Edge to edge, 16:9 cells, 3×3, 4×3, 5×5, Spaced).
- A **quick bar** under the live preview holds the tune-while-you-watch controls (grid, gap, cell shape, seed) so tweaking never means scrolling.
- Background: one solid color, or nothing at all. Grading, glow and texture belong on your own layers above the wall — this tool does not do looks.

**The camera — the zoom-out**
- Pick a **centered screen**: one source (file or comp) pinned to the middle cell, always on, playing from its start, kept out of the general rotation. Same size as everything else.
- Turn on **Start on the centered screen, pull back to the wall** and/or **Push back into it at the end**. That's the "start inside my video, zoom out into a wall of videos" shot, in two clicks.
- In AE the move is **one keyframed slider**: `Zoom to screen (%)` on the Wallmaker Camera null — 0 = the whole wall, 100 = that screen filling the comp. Retime the keys, re-ease them in the graph editor, replace them entirely, drive them from another property. A rebuild **never touches keyframes you have edited**.
- `Target column` / `Target row` (keyframe them to fly between screens), `Extra scale (%)` and `Pan (px)` layer your own move on top of the zoom.

**The power-on** *(off by default — the base wall is simply on)*
- Turn on **Animate the power-on** and screens come alive one by one: random, row by row, column by column, reading order, center-out, edges-in, or diagonally — with adjustable randomness, a start time, and one number for how long until **all** screens are on.
- Per-screen style: **Cut**, **Fade** or **Scale up** — over any number of frames.
- **Dead screens**: monitors that never come on, with or without the reveal.
- Deterministic from a seed; the preview plays exactly what AE will do.

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

1. **Sources** — add a folder, files, or your Project-panel selection (footage *and* comps).
2. **Wall** — arrangement, grid, cell shape, gap, fit, background, comp size / fps / duration.
3. **Motion** — the centered screen, the camera move, and (optionally) the power-on.
4. **Build** — one click; the comp opens when done.

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
