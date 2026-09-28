#!/usr/bin/env python
"""Record drum takes back to back against a collab kit's reference, with a spoken report after
each one, so you never have to leave the kit.

  .venv/bin/python scripts/take-session.py --kit audio/collab/labon-ko-bars33-66 [--takes 5] [--rest 30]

Each take is recorded by the kit's drum-take binary (scripts/drum-take.swift) as takeN.mid, numbered
after the last one in the folder, then rendered and analysed:
  lean    median distance of your hits from the song's 16th grid (negative = ahead)
  spread  interquartile range of that distance around your own lean (lower = steadier)
  loosest the 4-bar block with the widest spread
  lock    shift that lines the take up with the band's guide drums (what the video will use)
The report is printed and spoken with `say` through the default output, i.e. into your
headphones on a MIX IN rig. Leave a take unplayed (fewer than 40 hits) to end the session.
"""
import argparse, json, os, re, subprocess, sys
import numpy as np, librosa

ap = argparse.ArgumentParser()
ap.add_argument('--kit', required=True)
ap.add_argument('--takes', type=int, default=5)
ap.add_argument('--rest', type=float, default=30, help='seconds between the end of one take and the next count-in')
ap.add_argument('--reference', default='labon-ko-collab-reference.wav')
ap.add_argument('--no-say', action='store_true')
a = ap.parse_args()

kit = json.load(open(os.path.join(a.kit, 'sync.json')))
BAR = 240 / kit['bpm']
SIX = BAR / 16
FIRST_BAR = kit['first_bar']
Z = kit['reference_band_start_s'] + kit['chart_zero_clip_s']  # first full bar, in reference seconds
recorder = os.path.join(a.kit, 'drum-take')
SR, HOP = 22050, 128


def say(text: str) -> None:
    print(text, flush=True)
    if not a.no_say:
        subprocess.run(['say', '-r', '190', text.replace('–', ' to ')])


def env(path: str) -> np.ndarray:
    e = librosa.onset.onset_strength(y=librosa.load(path, sr=SR)[0], sr=SR, hop_length=HOP)
    return (e - e.mean()) / (e.std() + 1e-9)


guide = env(os.path.join(a.kit, kit['guide_drums']))


def lock_ms(drums_wav: str) -> float:
    d = env(drums_wav)
    exp = kit['reference_band_start_s']
    best = max(
        (float(np.dot(guide[: len(d[k:k + len(guide)])], d[k:k + len(guide)])), k * HOP / SR)
        for k in range(int((exp - 0.25) * SR / HOP), int((exp + 0.25) * SR / HOP))
    )
    return (best[1] - exp) * 1000


def report(n: int) -> bool:
    hits = json.load(open(os.path.join(a.kit, f'take{n}.raw.json')))
    t = np.array([h['time'] for h in hits])
    t = t[t >= Z - 0.05]
    if len(t) < 40:
        say(f'Take {n}: only {len(t)} hits. Ending the session.')
        return False
    # Distance to the nearest 16th, measured around the take's own lean (circular mean) so a hit
    # 70 ms early is not wrapped round to 69 ms late.
    phase = np.angle(np.mean(np.exp(2j * np.pi * (t - Z) / SIX))) * SIX / (2 * np.pi)
    dev = ((t - Z - phase + SIX / 2) % SIX) - SIX / 2 + phase
    lean = np.median(dev) * 1000
    spread = np.subtract(*np.percentile(dev, [75, 25])) * 1000
    last_bar = FIRST_BAR + int((t.max() - Z) // BAR)
    blocks = []
    for b0 in range(0, last_bar - FIRST_BAR + 1, 4):
        m = (t >= Z + b0 * BAR - 0.05) & (t < Z + (b0 + 4) * BAR - 0.05)
        if m.sum() >= 12:
            blocks.append((np.subtract(*np.percentile(dev[m], [75, 25])) * 1000, FIRST_BAR + b0))
    loose, at = max(blocks) if blocks else (0, FIRST_BAR)
    subprocess.run([recorder, 'render', '--midi', os.path.join(a.kit, f'take{n}.mid'), '--out', os.path.join(a.kit, f'take{n}-drums.wav')], check=True, stdout=subprocess.DEVNULL)
    lock = lock_ms(os.path.join(a.kit, f'take{n}-drums.wav'))
    ahead = f'{abs(lean):.0f} milliseconds {"ahead" if lean < 0 else "behind"}'
    say(f'Take {n}. {len(t)} hits. {ahead}. Spread {spread:.0f}. Loosest: bars {at}–{min(at + 3, last_bar)}, spread {loose:.0f}.')
    with open(os.path.join(a.kit, 'takes.log'), 'a') as f:
        f.write(json.dumps({'take': n, 'hits': len(t), 'lean_ms': round(lean, 1), 'spread_ms': round(spread, 1), 'loosest_bars': [at, min(at + 3, last_bar)], 'loosest_spread_ms': round(loose, 1), 'lock_ms': round(lock, 1)}) + '\n')
    return True


existing = [int(m.group(1)) for f in os.listdir(a.kit) if (m := re.fullmatch(r'take(\d+)\.mid', f))]
n = max(existing, default=0) + 1
for i in range(a.takes):
    pre = 10 if i == 0 else a.rest
    say(f'Take {n} starts in {pre:.0f} seconds.')
    rec = subprocess.run([recorder, 'record', '--reference', os.path.join(a.kit, a.reference), '--out', os.path.join(a.kit, f'take{n}.mid'), '--pre', str(max(0, pre - 3))], stdout=subprocess.PIPE, text=True)
    last = [l for l in rec.stdout.replace('\r', '\n').splitlines() if l.strip()]
    print(last[-1] if last else f'take {n}: recorder exited {rec.returncode}', flush=True)
    if rec.returncode != 0 or not report(n):
        break
    n += 1
say('Session over.')
