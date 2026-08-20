# Wallmaker — walls of videos for After Effects

Build a wall of videos — a CCTV-style monitor grid, a broadcast video wall, a mosaic of hundreds of clips — as **real, editable After Effects layers**, from a panel with a live animated preview.

Point it at a folder of videos, choose the grid, and press **Build**: every screen is a real footage layer (masked, scaled, randomly offset in time), everything is parented to one **Wallmaker Controls** null, and the whole "screens come to life one by one" power-on animation runs live off sliders on that null — scrub it, retime it, keyframe it, no rebuild needed.

## Features

**The wall**
- Any grid: automatic rows × columns from your video count, or set them yourself — from 2×2 to 1000+ screens.
- Perfectly aligned and spaced: gap (bezel), outer margin, rounded screen corners.
- Video fit per screen: **Fill** (crop), **Fit** (letterbox) or **Stretch** — mixed sizes and aspect ratios welcome.
- Video order: sequential, shuffled evenly, or randomly picked per screen; fewer videos than screens just repeat.
- Every screen can start at a **random point** in its clip (a wall of one video won't look synchronized), looped, muted.
- Optional **CAM 01 / CAM 02…** screen labels, background panel, or CCTV **static noise** wherever screens are off, or fully transparent for compositing.

**The power-on**
- Screens turn on one by one: random, row by row, column by column, scanline, from the center out, from the edges in, or a diagonal sweep — with adjustable randomness.
- Per-screen turn-on style: **Flicker** (CCTV fluorescent), **Fade**, **Pop** (with overshoot) or **Cut**, over any number of frames.
- **Dead screens**: a share of monitors that never come on.
- Fully deterministic from a seed — reroll until you like it; the preview shows exactly what AE will do.

**In After Effects — live, no rebuild**
Everything hangs off the **Wallmaker Controls** null:
- Move / scale / rotate the null → the whole wall follows.
- Sliders drive the wall through expressions: **Reveal start (s)**, **Reveal duration (s)**, **Turn-on (frames)**, **Dead screens (%)**, **Gap (px)** (keyframe it — the screens fly apart), **Screen scale (%)**, **Screens opacity (%)**.
- Each `Screen 001…` is a normal footage layer — swap its source, restyle it, parent things to it.
- Building again with the same comp name **updates the comp in place**: the Controls null (your values and keyframes) and any layers you added survive.

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

1. **Videos** — add a folder (searched recursively) or individual files.
2. **Wall** — comp size/fps/duration, the grid, fit, labels, background.
3. **Power-on** — order, timing, per-screen style, dead screens, seed. Press play in the preview.
4. **Build** — one click. Progress shows in the panel; the comp opens when done.

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
