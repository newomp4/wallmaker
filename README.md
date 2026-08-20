# Wallmaker — walls of videos for After Effects

Build a wall of videos — a CCTV-style monitor grid, a broadcast video wall, a mosaic of hundreds of clips — as **real, editable After Effects layers**, from a panel with a live animated preview.

Point it at a folder of videos (or select comps right in your project), choose the grid, and press **Build**: every screen is a real layer (masked, scaled, randomly offset in time), everything is parented to one **Wallmaker Controls** null, and the whole "screens come to life one by one" power-on runs live off sliders on that null — scrub it, retime it, keyframe it, no rebuild needed.

## Features

**Sources**
- A folder of videos (searched recursively), individual files, drag & drop — or **comps from your open project** ("From selection"): they render live on the wall, no export needed.
- Fewer sources than screens? They repeat (in order, shuffled evenly, or picked at random).
- Every screen can start at a **random point** in its clip, looped, muted — a wall of one video won’t look synchronized.

**The wall**
- Any grid: automatic rows × columns from your source count, or set them yourself — 2×2 to 1000+ screens, perfectly aligned and spaced (gap, margin, rounded corners).
- **Big screens**: hero monitors spanning 2×2 cells, placed by the seed.
- Video fit per screen: Fill (crop), Fit (letterbox) or Stretch — mixed sizes and aspect ratios welcome.
- Looks: background panel, CCTV **static noise** where screens are off, per-cell **borders**, CRT **scanlines**, `CAM 01` labels — or fully transparent for compositing.
- **Look presets** (top bar): CCTV wall, Clean mosaic, Hero mosaic, Retro CRT, Gallery fade.

**The power-on** *(off by default — the base wall is simply on)*
- Turn on **Animate the power-on** and screens come alive one by one: random, row by row, column by column, scanline, center-out, edges-in, or diagonally — with adjustable randomness, a start time, and one number for how long until **all** screens are on.
- Per-screen style: **Cut**, **Flicker** (CCTV fluorescent), **Fade**, or **Pop** — over any number of frames.
- **Dead screens** (monitors that never come on) and **signal dropouts** (running screens briefly black out) — with or without the reveal.
- Deterministic from a seed; the preview plays exactly what AE will do.

**In After Effects — live, no rebuild**
- Move / scale / rotate the **Wallmaker Controls** null → the whole wall follows.
- Sliders drive the wall through expressions: **Reveal start / duration (s)**, **Turn-on (frames)**, **Dead screens (%)**, **Dropouts (%)**, **Gap (px)** (keyframe it — the screens fly apart), **Screen scale (%)**, **Screens opacity (%)**, plus Border / Scanlines / Static / Label sliders when those are on.
- **Focus spotlight**: an optional draggable **Wallmaker Focus** null — screens near it zoom in, the rest dim. Keyframe it to sweep attention across the wall (try it in the preview with your mouse).
- Each `Screen 001…` is a normal layer — swap its source, restyle it, parent things to it.
- Building again with the same comp name **updates the comp in place**: the Controls null (your values and keyframes) and any layers you added survive.

## Install

```bash
git clone https://github.com/newomp4/wallmaker.git
cd wallmaker
npm install
npm run cep:install
```

Then (re)start After Effects (2024 or newer) → **Window ▸ Extensions ▸ Wallmaker**.

> The installer copies the panel into Adobe’s CEP extensions folder and switches on CEP’s PlayerDebugMode so the unsigned, self-built panel is allowed to load. `npm run cep:uninstall` removes it.

## Use

1. **Videos** — add a folder, files, or your Project-panel selection (footage *and* comps).
2. **Wall** — comp size / fps / duration, the grid, big screens, fit.
3. **Look** — background, borders, scanlines, labels, the Focus spotlight.
4. **Power-on** — flip the toggle, pick an order and timing, press ▶ in the preview.
5. **Build** — one click; the comp opens when done.

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
