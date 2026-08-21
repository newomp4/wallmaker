#!/usr/bin/env python3
"""Proves that fast preview (solid proxies) changes NOTHING but the pixels inside each screen.

Compares three renders of the same frames — real footage, solid proxies, real footage again — on:
  1. evaluated geometry: every screen's post-expression position, scale and opacity, exactly equal
  2. source dimensions: the proxy must report the same width / height / pixel aspect
  3. silhouette: which pixels are wall and which are background, compared pixel for pixel
  4. restore: turning it back off must reproduce the original frame exactly
Usage: python3 test/verify-proxy.py .test-out/G
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

d = Path(sys.argv[1])
wall = json.loads((d / 'wall.json').read_text())
config = json.loads((d / 'config.json').read_text())
base = json.loads((d / 'result.json').read_text())
prox = json.loads((d / 'result-proxy.json').read_text())
rest = json.loads((d / 'result-restored.json').read_text())
lay = json.loads((d / 'result-layout.json').read_text())
layoff = json.loads((d / 'result-layoutoff.json').read_text())
W, H = wall['frame']['w'], wall['frame']['h']
bg = tuple(int(config['bgColor'].lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))

failures = []
def fail(m):
    failures.append(m)
    print('  ✗', m)

n_src = len(wall['videos'])
if not (prox['state']['found'] and prox['state']['using'] == n_src and prox['state'].get('failed', 0) == 0):
    fail(f"fast preview on: {prox['state']} — expected all {n_src} sources proxied")
if rest['state']['using'] != 0:
    fail(f"fast preview off: {rest['state']['using']} sources still proxied")
print(f"  toggle: {prox['state']['using']}/{n_src} sources proxied, then {rest['state']['using']} — ok")

# ---- 1 + 2: geometry and source dimensions, per screen, per frame ----
for tkey in base['probes']:
    a = {r['idx']: r for r in base['probes'][tkey]}
    b = {r['idx']: r for r in prox['probes'][tkey]}
    c = {r['idx']: r for r in rest['probes'][tkey]}
    if set(a) != set(b) or set(a) != set(c):
        fail(f't={tkey}: the screen set changed')
        continue
    moved = []
    for i in a:
        for key in ('pos', 'scale'):
            if any(abs(x - y) > 1e-9 for x, y in zip(a[i][key], b[i][key])):
                moved.append(f'{i}.{key} {a[i][key]} -> {b[i][key]}')
        if abs(a[i]['opacity'] - b[i]['opacity']) > 1e-9:
            moved.append(f'{i}.opacity {a[i]["opacity"]} -> {b[i]["opacity"]}')
    if moved:
        fail(f't={tkey}: fast preview moved {len(moved)} screen properties — {moved[:3]}')
    sa = {r['idx']: r for r in base['probes'][tkey]}
    da = {r['idx']: r for r in prox['srcs'][tkey]}
    db = {r['idx']: r for r in rest['srcs'][tkey]}
    bad = [i for i in da if da[i]['w'] != db[i]['w'] or da[i]['h'] != db[i]['h'] or abs(da[i]['par'] - db[i]['par']) > 1e-9]
    if bad:
        fail(f't={tkey}: {len(bad)} sources report different dimensions under the proxy')
    if any(r['proxy'] != 1 for r in prox['srcs'][tkey]):
        fail(f't={tkey}: some screens were not on their proxy')
    _ = sa
print(f'  geometry: every screen identical (position, scale, opacity) across all {len(base["probes"])} frames — ok')
print('  sources: proxies report the same width, height and pixel aspect — ok')

# ---- 3 + 4: coverage and restore, pixel for pixel ----
# The comp renders on transparency, so a pixel's ALPHA is pure geometry -- mask coverage and layer
# opacity, nothing to do with what the footage looks like. If fast preview moved, resized or
# reshaped anything at all, the alpha channel would differ somewhere.
for tkey in base['probes']:
    real = Image.open(d / f'snap-{tkey}.png').convert('RGBA')
    pxy = Image.open(d / f'snap-proxy-{tkey}.png').convert('RGBA')
    res = Image.open(d / f'snap-restored-{tkey}.png').convert('RGBA')
    if real.size != pxy.size or real.size != res.size:
        fail(f't={tkey}: frame sizes differ')
        continue
    a_real = real.getchannel('A').tobytes()
    a_pxy = pxy.getchannel('A').tobytes()
    covered = sum(1 for v in a_real if v)
    if covered < W * H * 0.5:
        fail(f't={tkey}: only {covered} px of the frame are covered — the alpha check would be vacuous')
    diff = sum(1 for x, y in zip(a_real, a_pxy) if x != y)
    if diff:
        fail(f't={tkey}: coverage differs on {diff} px — fast preview moved something')
    else:
        print(f'  coverage t={tkey}: {covered} covered px, alpha channel identical to the byte — ok')

    # ...and it really is showing greys, or the comparison proved nothing
    a_px, b_px = real.load(), pxy.load()
    g_ = wall['grid']
    greys = colours = 0
    for s_ in wall['screens']:
        ox_, oy_ = wall.get('wallOffset', [0, 0])
        cx = int(W / 2 + (s_['col'] - (g_['cols'] - 1) / 2) * (g_['cellW'] + g_['gap']) + ox_)
        cy = int(H / 2 + (s_['row'] - (g_['rows'] - 1) / 2) * (g_['cellH'] + g_['gap']) + oy_)
        if not (0 <= cx < W and 0 <= cy < H):
            continue
        r, g, b, _a = b_px[cx, cy]
        if abs(r - g) <= 3 and abs(g - b) <= 3:
            greys += 1
        rr, gg, bb, _aa = a_px[cx, cy]
        if not (abs(rr - gg) <= 3 and abs(gg - bb) <= 3):
            colours += 1
    if greys == 0 or colours == 0:
        fail(f't={tkey}: expected {colours} coloured clips to render as greys, got {greys}')
    else:
        print(f'  t={tkey}: {colours} coloured screens render as {greys} greys — ok')

    # turning it off must give back the original frame exactly
    if real.tobytes() != res.tobytes():
        back = sum(1 for x, y in zip(real.tobytes(), res.tobytes()) if x != y)
        fail(f't={tkey}: {back} bytes differ after turning fast preview off')
print('  restore: turning it off reproduces the original frames byte for byte — ok')

# ---- layout only: the boxes must land on exactly the same pixels as the videos ----
# Same trick as above: a transparent comp means alpha is pure geometry. The guide is drawn from the
# grid numbers and a repeater, the screens from per-layer expressions -- completely separate code
# paths -- so identical coverage is real evidence they agree, not a tautology.
if not (lay['state']['found'] and lay['state']['on']):
    fail(f"layout on: {lay['state']}")
if layoff['state']['on']:
    fail('layout off: the guide is still showing')
print(f"  layout: guide on, {lay['state']['screens']} video layers switched off, then back — ok")

for tkey in base['probes']:
    real = Image.open(d / f'snap-{tkey}.png').convert('RGBA')
    guide = Image.open(d / f'snap-layout-{tkey}.png').convert('RGBA')
    back = Image.open(d / f'snap-layoutoff-{tkey}.png').convert('RGBA')
    # Compare the two coverage masks with a ONE PIXEL tolerance: the guide is a shape-layer
    # rectangle and a screen is a masked footage layer, so their shared edges antialias slightly
    # differently. A box that had actually moved would fail this by its whole offset.
    solid = lambda im: im.getchannel('A').point(lambda v: 255 if v else 0)
    ma, mb = solid(real), solid(guide)
    outside = ImageChops.subtract(ma, mb.filter(ImageFilter.MaxFilter(3)))  # video where no box
    missing = ImageChops.subtract(mb.filter(ImageFilter.MinFilter(3)), ma)  # box where no video
    diff = sum(outside.point(lambda v: 1 if v else 0).getdata()) + sum(missing.point(lambda v: 1 if v else 0).getdata())
    covered = sum(ma.point(lambda v: 1 if v else 0).getdata())
    if diff:
        fail(f't={tkey}: the layout guide and the videos disagree on {diff} px by more than a pixel')
    else:
        print(f'  layout t={tkey}: {covered} covered px, every box lands on its video to the pixel — ok')
    # the guide must be a faint wash, not a solid block
    alphas = [v for v in guide.getchannel('A').getdata() if v]
    if alphas and (sum(alphas) / len(alphas)) > 160:
        fail(f't={tkey}: the layout guide is not low-opacity (mean alpha {sum(alphas) / len(alphas):.0f})')
    if real.tobytes() != back.tobytes():
        fail(f't={tkey}: turning layout off did not restore the frame exactly')
print('  layout: switching back restores the videos frame for frame — ok')

if failures:
    print(f'\n✗ {len(failures)} proxy failure(s)')
    sys.exit(1)
print('  fast preview verified: geometry identical, pixels restore exactly')
