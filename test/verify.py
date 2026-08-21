#!/usr/bin/env python3
"""Verifies one host-test round: evaluated expressions (probes), the camera rig (camState) and
rendered pixels (snapshots) against the wall plan (wall.json) — the same numbers the panel preview
shows. Usage: python3 test/verify.py .test-out/A
"""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageStat

round_dir = Path(sys.argv[1])
root = round_dir.parent.parent
wall = json.loads((round_dir / 'wall.json').read_text())
config = json.loads((round_dir / 'config.json').read_text())
result = json.loads((round_dir / 'result.json').read_text())
colors = json.loads((root / '.test-assets' / 'colors.json').read_text())
extra = round_dir / 'extra-colors.json'
if extra.exists():
    colors.update(json.loads(extra.read_text()))

assert result['ok'], f"AE build failed: {result.get('error')}"
g = wall['grid']
rv = wall['reveal']
n = len(wall['screens'])
fps = wall['fps']
W, H = wall['frame']['w'], wall['frame']['h']
anim_len = rv['animFrames'] / fps
EPS = anim_len + 2.5 / fps + 0.05  # skip screens mid-transition (+ frame quantization slack)

failures = []
def fail(msg):
    failures.append(msg)
    print('  ✗', msg)

# ---------- camera model (mirrors planCamera / the keyframed Zoom slider) ----------
cam = wall.get('camera')
has_move = bool(cam and (cam.get('intro') or cam.get('outro')))

def cam_phase(t):
    """'zoomed' | 'neutral' | 'moving' at time t (the plan carries absolute clamped times)"""
    if not has_move:
        return 'neutral'
    if cam.get('intro'):
        if t <= cam['intro']['hold'] - 0.02:
            return 'zoomed'
        if t < cam['intro']['end'] + 0.1:
            return 'moving'
    if cam.get('outro'):
        if t >= cam['outro']['end'] - 0.02:
            return 'zoomed'
        if t > cam['outro']['start'] - 0.1:
            return 'moving'
    return 'neutral'

# ---------- structure: the comp must contain exactly the layers the plan calls for ----------
if 'layers' in result:
    lays = result['layers']
    def count_pref(pref):
        return sum(1 for l in lays if l['comment'].startswith(pref))
    for pref, want, what in [
        ('wallmaker-controls', 1, 'Controls null'),
        ('wallmaker-camera', 1, 'Camera null'),
        ('wallmaker-screen', n, 'screens'),
        ('wallmaker-bg', 1 if wall['bg']['mode'] != 'transparent' else 0, 'Background'),
    ]:
        got = count_pref(pref)
        if got != want:
            fail(f'{what}: {got} layer(s), expected {want}')
    # nothing from the old CCTV-themed builds may survive a build
    for pref in ['wallmaker-staticlayer', 'wallmaker-borders', 'wallmaker-scanlines', 'wallmaker-focus', 'wallmaker-label', 'wallmaker-labeltpl']:
        if count_pref(pref):
            fail(f'stale layer {pref} present ({count_pref(pref)})')
    if len(lays) != n + 2 + (1 if wall['bg']['mode'] != 'transparent' else 0):
        fail(f'{len(lays)} layers in the comp, expected exactly the rig + screens + background')
    # the centred screen must be findable in AE: named "Center", tagged, and top of the screens
    centred = next((sc for sc in wall['screens'] if sc.get('featured')), None)
    named = [l for l in lays if l['name'].startswith('Center \u00b7')]
    tagged = [l for l in lays if l['comment'].endswith(' center')]
    if centred is None:
        if named or tagged:
            fail(f'no centred screen planned, but {len(named)} layer(s) are named Center')
    elif len(named) != 1 or len(tagged) != 1 or named[0]['comment'] != tagged[0]['comment']:
        fail(f'expected exactly one layer named/tagged Center, got {len(named)} named and {len(tagged)} tagged')
    else:
        want = wall['videos'][centred['v']]['name']
        if not named[0]['name'].endswith(want):
            fail(f'the Center layer plays {named[0]["name"]!r}, expected {want!r}')
        screens_from_top = [i for i, l in enumerate(lays) if l['comment'].startswith('wallmaker-screen')]
        if lays.index(named[0]) != screens_from_top[0]:
            fail('the Center layer is not the topmost screen')
        elif named[0].get('label') != 9:
            fail(f'the Center layer has label {named[0].get("label")}, expected the flagged colour 9')
        elif any(l.get('label') == 9 for l in lays if l is not named[0] and l['comment'].startswith('wallmaker-screen')):
            fail('another screen shares the Center label colour')
        else:
            print(f'  centre: “{named[0]["name"]}” is the topmost screen, tagged and colour-flagged — ok')
    print(f'  structure: {len(lays)} layers match the plan — ok')

# ---------- 'cover': the wall runs past the comp edges, and every source is still seen ----------
def onscreen(sc):
    cx = (sc['col'] - (g['cols'] - 1) / 2) * (g['cellW'] + g['gap'])
    cy = (sc['row'] - (g['rows'] - 1) / 2) * (g['cellH'] + g['gap'])
    return abs(cx) + g['cellW'] / 2 <= W / 2 + 0.5 and abs(cy) + g['cellH'] / 2 <= H / 2 + 0.5

VISIBLE = [sc for sc in wall['screens'] if onscreen(sc)]
if config.get('wallFit') == 'cover' and config.get('cellAspect', 'fill') != 'fill':
    if g['wallW'] < W - 0.5 or g['wallH'] < H - 0.5:
        fail(f"cover: wall {g['wallW']}x{g['wallH']} does not reach past the comp {W}x{H}")
    if len(VISIBLE) >= n:
        fail('cover: no screen is cut off by the frame — nothing was added')
    seen = {sc['v'] for sc in VISIBLE}
    if len(seen) != len(wall['videos']):
        fail(f'cover: only {len(seen)}/{len(wall["videos"])} sources appear in frame — duplicates took visible cells')
    else:
        print(f"  cover: wall {round(g['wallW'])}x{round(g['wallH'])} over a {W}x{H} comp, {n - len(VISIBLE)} screens cut off, all {len(seen)} sources in frame — ok")

# every cell holds exactly one screen, all the same size
if n != g['rows'] * g['cols']:
    fail(f"{n} screens for a {g['rows']}x{g['cols']} grid — every cell must hold exactly one")
if len({(s['row'], s['col']) for s in wall['screens']}) != n:
    fail('two screens share a cell')

# ---------- probes: post-expression opacity of every screen ----------
spec_by_idx = {s['i']: s for s in wall['screens']}
assert len(result['probes']) >= 3, 'expected 3 probe times'
for tkey, probe in result['probes'].items():
    t = float(tkey)
    assert len(probe) == n, f'probe t={t}: {len(probe)} screens, expected {n}'
    checked = skipped = 0
    scales = []
    for row in probe:
        s = spec_by_idx[row['idx']]
        op = row['opacity']
        scales.append(row['scale'][0])
        if s.get('featured'):
            checked += 1
            if abs(op - 100.0) > 0.6:
                fail(f't={t} centered screen {row["idx"]}: opacity {op:.2f}, expected always-on 100')
            continue
        dead = s['dead'] * 100 < rv['deadPct']
        on_time = rv['start'] + s['th'] / 100 * rv['duration']
        if dead:
            expected = 0.0
        elif t < on_time - 0.05:
            expected = 0.0
        elif t > on_time + EPS:
            expected = 100.0
        else:
            skipped += 1
            continue
        checked += 1
        if abs(op - expected) > 0.6:
            fail(f't={t} screen {row["idx"]} ({row["name"]}): opacity {op:.2f}, expected {expected}')
    print(f'  probe t={t}: {checked} screens checked, {skipped} in transition — ok')

# flicker must actually flicker: a screen mid-turn-on lands on a partial opacity, never just 0/100
if rv['style'] == 'flicker':
    partials = 0
    for tkey, probe in result['probes'].items():
        t = float(tkey)
        for row in probe:
            sc = spec_by_idx[row['idx']]
            if sc.get('featured') or sc['dead'] * 100 < rv['deadPct']:
                continue
            on_time = rv['start'] + sc['th'] / 100 * rv['duration']
            if on_time - 0.05 <= t <= on_time + EPS and 0.5 < row['opacity'] < 99.5:
                partials += 1
    if partials == 0:
        fail('flicker: no screen showed a partial opacity mid-turn-on — the flicker branch never ran')
    else:
        print(f'  flicker: {partials} screen-samples caught mid-flicker — ok')

# every screen renders at the same size (identical cells) -- compare same-source screens only,
# since fit modes scale each source to its own cell differently
by_source = {}
last_probe = result['probes'][sorted(result['probes'], key=float)[-1]]
for row in last_probe:
    by_source.setdefault(spec_by_idx[row['idx']]['v'], []).append(row['scale'][0])
for v, group in by_source.items():
    if len(group) > 1 and max(group) - min(group) > 0.01:
        fail(f'source {v}: screens rendered at different scales {min(group):.2f}..{max(group):.2f} — cells are not identical')
print(f'  cell uniformity: {len(by_source)} source group(s) all render at one scale — ok')

# fully-on counts at the middle probe time must match the plan exactly
mid_key = sorted(result['probes'], key=float)[1]
mid_t = float(mid_key)
actual_on = sum(1 for row in result['probes'][mid_key] if row['opacity'] >= 99.5)
expected_on = sum(
    1 for s in wall['screens']
    if not (s['dead'] * 100 < rv['deadPct']) and mid_t > rv['start'] + s['th'] / 100 * rv['duration'] + EPS
)
expected_max = sum(
    1 for s in wall['screens']
    if not (s['dead'] * 100 < rv['deadPct']) and mid_t > rv['start'] + s['th'] / 100 * rv['duration'] - 0.05
)
if not (expected_on <= actual_on <= expected_max):
    fail(f'fully-on count at t={mid_t}: {actual_on}, expected between {expected_on} and {expected_max}')
else:
    print(f'  on-count at t={mid_t}: {actual_on} (plan: {expected_on}..{expected_max}) — ok')

# ---------- the camera rig ----------
if 'cams' in result:
    first = result['cams'][sorted(result['cams'], key=float)[0]]
    if first.get('ctlParent') != 'Wallmaker Camera':
        fail(f'the Controls null is parented to {first.get("ctlParent")!r}, expected the camera null')
    if first.get('ctlPos') and (abs(first['ctlPos'][0]) > 0.01 or abs(first['ctlPos'][1]) > 0.01):
        fail(f'the wall null sits at {first["ctlPos"]}, expected the camera origin [0, 0]')
    # the keyframes on 'Zoom to screen (%)' must be exactly the plan's move
    want_keys = []
    if has_move:
        if cam.get('intro'):
            if cam['intro']['hold'] > 0:
                want_keys.append([0.0, 100])
            want_keys += [[cam['intro']['hold'], 100], [cam['intro']['end'], 0]]
        if cam.get('outro'):
            want_keys += [[cam['outro']['start'], 0], [cam['outro']['end'], 100]]
    got_keys = first.get('keys') or []
    if len(got_keys) != len(want_keys) or any(
        abs(a[0] - b[0]) > 1.0 / fps or abs(a[1] - b[1]) > 0.01 for a, b in zip(got_keys, want_keys)
    ):
        fail(f'zoom keyframes {got_keys}, expected {want_keys}')
    else:
        print(f'  camera: {len(got_keys)} zoom keyframe(s) match the plan — ok')
    kexp = cam['scale'] if cam else 100.0
    zoom_pos = [W / 2 - kexp / 100 * cam['p'][0], H / 2 - kexp / 100 * cam['p'][1]] if cam else [W / 2, H / 2]
    for tkey, c in result['cams'].items():
        ph = cam_phase(float(tkey))
        if ph == 'moving':
            continue
        want_s, want_p, want_z = (kexp, zoom_pos, 100.0) if ph == 'zoomed' else (100.0, [W / 2, H / 2], 0.0)
        if abs(c['scale'][0] - want_s) > 0.6 or abs(c['pos'][0] - want_p[0]) > 1.5 or abs(c['pos'][1] - want_p[1]) > 1.5:
            fail(f'camera t={tkey} ({ph}): scale {c["scale"][0]:.2f} pos {c["pos"][0]:.1f},{c["pos"][1]:.1f}, expected {want_s:.2f} @ {want_p[0]:.1f},{want_p[1]:.1f}')
        elif c.get('zoom') is not None and abs(c['zoom'] - want_z) > 0.6:
            fail(f'camera t={tkey} ({ph}): zoom slider {c["zoom"]:.2f}, expected {want_z}')
        else:
            print(f'  camera t={tkey}: {ph} — ok (scale {c["scale"][0]:.1f}, zoom {c.get("zoom")})')

# ---------- snapshots: sample every cell center ----------
def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

bg = hex_rgb(config['bgColor'].lstrip('#'))
featured_screen = next((s for s in wall['screens'] if s.get('featured')), None)
for tkey, probe in result['probes'].items():
    t = float(tkey)
    img = Image.open(round_dir / f'snap-{tkey}.png').convert('RGB')
    assert img.size == (W, H), f'snapshot size {img.size}'
    op_by_idx = {row['idx']: row['opacity'] for row in probe}
    phase = cam_phase(t)
    if phase != 'neutral':
        if phase == 'zoomed' and featured_screen is not None:
            # fully zoomed onto the centered screen: the whole frame is that source
            name = wall['videos'][featured_screen['v']]['name']
            if name in colors:
                want = hex_rgb(colors[name])
                for px_, py_ in [(W // 2, H // 2), (W // 5, H // 5), (4 * W // 5, 4 * H // 5)]:
                    got = img.getpixel((px_, py_))
                    if any(abs(gc - wc) > 48 for gc, wc in zip(got, want)):
                        fail(f'snap t={t} zoomed: pixel {px_},{py_} rgb {got}, expected the centered screen ~{want}')
                print(f'  snapshot t={t}: zoomed-in frame is the centered screen — ok')
        continue
    # wall smaller than the comp (locked cell aspect / margins): the band above it must be background
    band = (H - g['wallH']) / 2
    if band > 12 and config['background'] != 'transparent':
        got = img.getpixel((W // 2, int(band / 2)))
        if any(abs(gc - b) > 26 for gc, b in zip(got, bg)):
            fail(f'snap t={t}: margin band rgb {got}, expected bg {bg}')
    checked = 0
    for s in VISIBLE:
        cx = W / 2 + (s['col'] - (g['cols'] - 1) / 2) * (g['cellW'] + g['gap'])
        cy = H / 2 + (s['row'] - (g['rows'] - 1) / 2) * (g['cellH'] + g['gap'])
        mean = ImageStat.Stat(img.crop((int(cx) - 3, int(cy) - 3, int(cx) + 4, int(cy) + 4))).mean
        op = op_by_idx[s['i']]
        on_time = rv['start'] + s['th'] / 100 * rv['duration']
        if on_time - 0.05 <= t <= on_time + EPS and not (s['dead'] * 100 < rv['deadPct']):
            continue  # mid-transition (e.g. scale-up: opacity 100 while still growing)
        name = wall['videos'][s['v']]['name']
        if op >= 99.5 and name in colors:
            want = hex_rgb(colors[name])
            if any(abs(m - w) > 48 for m, w in zip(mean, want)):
                fail(f'snap t={t} screen {s["i"]} ({name}): rgb {tuple(round(m) for m in mean)}, expected ~{want}')
            checked += 1
        elif op <= 0.5:
            # off screens show the (dark) background
            if sum(mean) / 3 > 82:
                fail(f'snap t={t} screen {s["i"]}: off but bright (mean {tuple(round(m) for m in mean)}, bg {bg})')
            checked += 1
    if checked < max(1, len(VISIBLE) * 0.4):
        fail(f'snap t={t}: only {checked}/{len(VISIBLE)} in-frame cells were checkable — the pixel verification has gone vacuous')
    # big rounded corners must actually cut the video: the cell's corner shows background, not clip
    if wall['cornerRadius'] >= 20:
        pos_by_idx = {row['idx']: row['pos'] for row in probe}
        corners = 0
        for s in VISIBLE:
            name = wall['videos'][s['v']]['name']
            pos = pos_by_idx[s['i']]
            if op_by_idx[s['i']] < 99.5 or name not in colors:
                continue
            cx_ = W / 2 + pos[0]
            cy_ = H / 2 + pos[1]
            got = img.getpixel((int(cx_ - g['cellW'] / 2 + 3), int(cy_ - g['cellH'] / 2 + 3)))
            want = hex_rgb(colors[name])
            if all(abs(gc - wc) <= 60 for gc, wc in zip(got, want)):
                fail(f'snap t={t} screen {s["i"]}: corner pixel {got} still shows the clip {want} — corners are not rounded')
            corners += 1
        if corners:
            print(f'  corner radius: {corners} screen corners verified cut')
    print(f'  snapshot t={t}: {checked} cell centers verified')

if failures:
    print(f'\n✗ {len(failures)} failure(s)')
    sys.exit(1)
print('  all checks passed')
