#!/usr/bin/env python3
"""Verifies one host-test round: evaluated expressions (probes) + rendered pixels (snapshots)
against the wall plan (wall.json) — the same numbers the panel preview shows.
Usage: python3 test/verify.py .test-out/A
"""
import json, math, sys
from pathlib import Path
from PIL import Image

round_dir = Path(sys.argv[1])
root = round_dir.parent.parent
wall = json.loads((round_dir / 'wall.json').read_text())
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
anim_len = rv['animFrames'] / fps
EPS = anim_len + 2.5 / fps + 0.05  # skip screens mid-transition (+ frame quantization slack)

failures = []
def fail(msg):
    failures.append(msg)
    print('  ✗', msg)

# ---------- camera model (mirrors planCamera / the null keyframes) ----------
cam = wall.get('camera')
DUR = wall['durationSec']
def cam_phase(t):
    """'zoomed' | 'neutral' | 'moving' at time t (the plan carries absolute clamped times)"""
    if not cam:
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
config = json.loads((round_dir / 'config.json').read_text())
if 'layers' in result:
    lays = result['layers']
    def count_pref(pref):
        return sum(1 for l in lays if l['comment'].startswith(pref))
    if count_pref('wallmaker-controls') != 1:
        fail('expected exactly one Controls null')
    if count_pref('wallmaker-screen') != n:
        fail(f"{count_pref('wallmaker-screen')} screen layers, plan has {n}")
    for pref, want, what in [
        ('wallmaker-bg', 1 if wall['bg']['mode'] != 'transparent' else 0, 'Background'),
        ('wallmaker-staticlayer', 1 if wall['bg']['mode'] == 'static' else 0, 'Static'),
        ('wallmaker-borders', 1 if wall.get('borders') else 0, 'Borders'),
        ('wallmaker-scanlines', 1 if wall.get('scanlines') else 0, 'Scanlines'),
        ('wallmaker-focus', 1 if wall.get('focus') else 0, 'Focus null'),
        ('wallmaker-label ', n if wall.get('labels') else 0, 'labels'),
    ]:
        got = count_pref(pref)
        if got != want:
            fail(f'{what}: {got} layer(s), expected {want}')
    print(f'  structure: {len(lays)} layers match the plan — ok')

# heroes must actually be planned when requested (the grid always fits them in these rounds)
requested_heroes = config.get('heroes', 0)
planned_heroes = sum(1 for sc in wall['screens'] if sc.get('span', 1) == 2 and not sc.get('featured'))
if requested_heroes and planned_heroes != requested_heroes:
    fail(f'{planned_heroes} hero screens planned, requested {requested_heroes}')

# ---------- probes: post-expression opacity of every screen ----------
spec_by_idx = {s['i']: s for s in wall['screens']}
assert len(result['probes']) >= 3, 'expected 3 probe times'
dropout_rate = rv.get('dropouts', 0)
blips = 0
alive_checks = 0
for tkey, probe in result['probes'].items():
    t = float(tkey)
    assert len(probe) == n, f'probe t={t}: {len(probe)} screens, expected {n}'
    checked = skipped = 0
    for row in probe:
        s = spec_by_idx[row['idx']]
        op = row['opacity']
        if s.get('featured'):
            checked += 1
            if abs(op - 100.0) > 0.6:
                fail(f't={t} featured screen {row["idx"]}: opacity {op:.2f}, expected always-on 100')
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
        if expected == 100.0:
            alive_checks += 1
            if dropout_rate > 0 and op <= 0.5:
                blips += 1  # a running screen mid-dropout — counted, bounded below
                continue
        if abs(op - expected) > 0.6:
            fail(f't={t} screen {row["idx"]} ({row["name"]}): opacity {op:.2f}, expected {expected}')
    print(f'  probe t={t}: {checked} screens checked, {skipped} in transition — ok' if not failures else f'  probe t={t}: checked {checked}')
if dropout_rate > 0:
    hi = max(3, round(alive_checks * 0.18))
    if not (1 <= blips <= hi):
        fail(f'dropouts at {dropout_rate}%: {blips} blipped screens across probes, expected 1..{hi} of {alive_checks}')
    else:
        print(f'  dropouts: {blips}/{alive_checks} running screens mid-blip — ok')

# fully-on counts at the middle probe time must match the plan exactly
mid_key = sorted(result['probes'], key=float)[1]
mid_t = float(mid_key)
actual_on = sum(1 for row in result['probes'][mid_key] if row['opacity'] >= 99.5)
mid_blip_slack = max(3, round(n * 0.1)) if dropout_rate > 0 else 0
expected_on = sum(
    1 for s in wall['screens']
    if not (s['dead'] * 100 < rv['deadPct']) and mid_t > rv['start'] + s['th'] / 100 * rv['duration'] + EPS
)
expected_max = sum(
    1 for s in wall['screens']
    if not (s['dead'] * 100 < rv['deadPct']) and mid_t > rv['start'] + s['th'] / 100 * rv['duration'] - 0.05
)
expected_on -= mid_blip_slack
if not (expected_on <= actual_on <= expected_max):
    fail(f'fully-on count at t={mid_t}: {actual_on}, expected between {expected_on} and {expected_max}')
else:
    print(f'  on-count at t={mid_t}: {actual_on} (plan: {expected_on}..{expected_max}) — ok')

# ---------- camera: the Controls null's evaluated Scale/Position must match the plan ----------
if cam and 'ctls' in result:
    kexp = cam['scale']
    W, H = wall['frame']['w'], wall['frame']['h']
    zoom_pos = [W / 2 - kexp / 100 * cam['p'][0], H / 2 - kexp / 100 * cam['p'][1]]
    for tkey, ctl in result['ctls'].items():
        ph = cam_phase(float(tkey))
        if ph == 'moving':
            continue
        want_s, want_p = (kexp, zoom_pos) if ph == 'zoomed' else (100.0, [W / 2, H / 2])
        if abs(ctl['scale'][0] - want_s) > 0.6 or abs(ctl['pos'][0] - want_p[0]) > 1.5 or abs(ctl['pos'][1] - want_p[1]) > 1.5:
            fail(f'camera t={tkey} ({ph}): scale {ctl["scale"][0]:.2f} pos {ctl["pos"][0]:.1f},{ctl["pos"][1]:.1f}, expected {want_s:.2f} @ {want_p[0]:.1f},{want_p[1]:.1f}')
        else:
            print(f'  camera t={tkey}: {ph} — ok (scale {ctl["scale"][0]:.1f})')

# ---------- snapshots: sample every cell center ----------
def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

bg = hex_rgb(json.loads((round_dir / 'config.json').read_text())['bgColor'].lstrip('#'))
featured_screen = next((s for s in wall['screens'] if s.get('featured')), None)
for tkey, probe in result['probes'].items():
    t = float(tkey)
    img = Image.open(round_dir / f'snap-{tkey}.png').convert('RGB')
    assert img.size == (wall['frame']['w'], wall['frame']['h']), f'snapshot size {img.size}'
    op_by_idx = {row['idx']: row['opacity'] for row in probe}
    phase = cam_phase(t)
    if phase != 'neutral':
        if phase == 'zoomed' and featured_screen is not None:
            # fully zoomed onto the featured screen: the whole frame is that source
            name = wall['videos'][featured_screen['v']]['name']
            if name in colors:
                want = hex_rgb(colors[name])
                W, H = img.size
                for px_, py_ in [(W // 2, H // 2), (W // 5, H // 5), (4 * W // 5, 4 * H // 5)]:
                    got = img.getpixel((px_, py_))
                    if any(abs(g - w) > 48 for g, w in zip(got, want)):
                        fail(f'snap t={t} zoomed: pixel {px_},{py_} rgb {got}, expected featured ~{want}')
                print(f'  snapshot t={t}: zoomed-in frame is the featured screen — ok')
        continue
    # wall smaller than the comp (locked cell aspect / margins): the band above it must be background
    band = (wall['frame']['h'] - wall['grid']['wallH']) / 2
    if band > 12 and json.loads((round_dir / 'config.json').read_text())['background'] != 'transparent':
        got = img.getpixel((wall['frame']['w'] // 2, int(band / 2)))
        if any(abs(g - b) > 26 for g, b in zip(got, bg)):
            fail(f'snap t={t}: margin band rgb {got}, expected bg {bg}')
    checked = 0
    for s in wall['screens']:
        span = s.get('span', 1)
        cx = wall['frame']['w'] / 2 + (s['col'] + (span - 1) / 2 - (g['cols'] - 1) / 2) * (g['cellW'] + g['gap'])
        cy = wall['frame']['h'] / 2 + (s['row'] + (span - 1) / 2 - (g['rows'] - 1) / 2) * (g['cellH'] + g['gap'])
        px = img.crop((int(cx) - 3, int(cy) - 3, int(cx) + 4, int(cy) + 4))
        mean = [sum(c) / len(c) for c in zip(*list(px.getdata()))]
        op = op_by_idx[s['i']]
        on_time = rv['start'] + s['th'] / 100 * rv['duration']
        if on_time - 0.05 <= t <= on_time + EPS and not (s['dead'] * 100 < rv['deadPct']):
            continue  # mid-transition (e.g. pop: opacity 100 while still scaling up)
        name = wall['videos'][s['v']]['name']
        if op >= 99.5 and name in colors:
            want = hex_rgb(colors[name])
            # scanlines darken the wall by up to strength% (stripes may cover the whole sample window)
            dark = 1 - (wall.get('scanlines') or {'strength': 0})['strength'] / 100
            if any(m > w + 48 or m < w * dark - 48 for m, w in zip(mean, want)):
                fail(f'snap t={t} screen {s["i"]} ({name}): rgb {tuple(round(m) for m in mean)}, expected ~{want} (x{dark:.2f} scanline floor)')
            checked += 1
        elif op <= 0.5:
            # off screens show the (dark) background / faint static
            if sum(mean) / 3 > 82:
                fail(f'snap t={t} screen {s["i"]}: off but bright (mean {tuple(round(m) for m in mean)}, bg {bg})')
            checked += 1
    if checked < max(1, n * 0.4):
        fail(f'snap t={t}: only {checked}/{n} cells were checkable — the pixel verification has gone vacuous')
    # big rounded corners must actually cut the video: the cell's corner shows background, not clip
    if wall['cornerRadius'] >= 20:
        pos_by_idx = {row['idx']: row['pos'] for row in probe}
        corners = 0
        for s in wall['screens']:
            span = s.get('span', 1)
            name = wall['videos'][s['v']]['name']
            pos = pos_by_idx[s['i']]
            # far from the wall center so the Focus zoom cannot let a neighbor cover this corner
            if op_by_idx[s['i']] < 99.5 or name not in colors or math.hypot(*pos) < 800:
                continue
            w_ = g['cellW'] * span + g['gap'] * (span - 1)
            h_ = g['cellH'] * span + g['gap'] * (span - 1)
            cx_ = wall['frame']['w'] / 2 + pos[0]
            cy_ = wall['frame']['h'] / 2 + pos[1]
            got = img.getpixel((int(cx_ - w_ / 2 + 3), int(cy_ - h_ / 2 + 3)))
            want = hex_rgb(colors[name])
            if all(abs(gc - wc) <= 60 for gc, wc in zip(got, want)):
                fail(f'snap t={t} screen {s["i"]}: corner pixel {got} still shows the clip {want} — corners are not rounded')
            corners += 1
        if corners:
            print(f'  corner radius: {corners} screen corners verified cut')
    print(f'  snapshot t={t}: {checked} cell centers verified')

# ---------- focus spotlight: screens close to the (unmoved) Focus null must render larger ----------
if wall.get('focus') and wall['focus']['zoom'] > 105:
    # model check: measured scale ratio between two screens sharing a video must match the falloff math
    last = result['probes'][sorted(result['probes'], key=float)[-1]]
    spec = {row['idx']: row for row in last}
    R, Z = wall['focus']['radius'], wall['focus']['zoom'] / 100

    def zoom_at(s):
        d = math.hypot(*spec[s['i']]['pos'])
        k = max(0.0, 1 - d / R)
        k = k * k * (3 - 2 * k)
        return 1 + (Z - 1) * k

    by_video = {}
    for s in wall['screens']:
        if s.get('span', 1) == 1:
            by_video.setdefault(s['v'], []).append(s)
    checked_focus = 0
    for v, group in by_video.items():
        if len(group) < 2:
            continue
        dist = lambda s: math.hypot(*spec[s['i']]['pos'])
        near, far = min(group, key=dist), max(group, key=dist)
        expected_ratio = zoom_at(near) / zoom_at(far)
        measured_ratio = spec[near['i']]['scale'][0] / max(0.01, spec[far['i']]['scale'][0])
        if abs(measured_ratio - expected_ratio) > 0.08:
            fail(f'focus: screens {near["i"]}/{far["i"]} scale ratio {measured_ratio:.3f}, model says {expected_ratio:.3f}')
        checked_focus += 1
    print(f'  focus zoom: {checked_focus} near/far pairs verified against the falloff model')

# hero screens must exist when requested and be span 2
heroes = [s for s in wall['screens'] if s.get('span', 1) == 2]
if heroes:
    print(f'  heroes: {len(heroes)} big screens in the plan')

if failures:
    print(f'\n✗ {len(failures)} failure(s)')
    sys.exit(1)
print('  all checks passed')
