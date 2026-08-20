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

# ---------- probes: post-expression opacity of every screen ----------
spec_by_idx = {s['i']: s for s in wall['screens']}
assert len(result['probes']) >= 3, 'expected 3 probe times'
for tkey, probe in result['probes'].items():
    t = float(tkey)
    assert len(probe) == n, f'probe t={t}: {len(probe)} screens, expected {n}'
    checked = skipped = 0
    for row in probe:
        s = spec_by_idx[row['idx']]
        dead = s['dead'] * 100 < rv['deadPct']
        on_time = rv['start'] + s['th'] / 100 * rv['duration']
        op = row['opacity']
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
    print(f'  probe t={t}: {checked} screens checked, {skipped} in transition — ok' if not failures else f'  probe t={t}: checked {checked}')

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

# ---------- snapshots: sample every cell center ----------
def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

bg = hex_rgb(json.loads((round_dir / 'config.json').read_text())['bgColor'].lstrip('#'))
for tkey, probe in result['probes'].items():
    t = float(tkey)
    img = Image.open(round_dir / f'snap-{tkey}.png').convert('RGB')
    assert img.size == (wall['frame']['w'], wall['frame']['h']), f'snapshot size {img.size}'
    op_by_idx = {row['idx']: row['opacity'] for row in probe}
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
