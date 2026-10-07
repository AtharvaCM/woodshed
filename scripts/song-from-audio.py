#!/usr/bin/env python
"""Audio in, WOODSHED song zip out: the whole chart pipeline in one command.

  .venv/bin/python scripts/song-from-audio.py "audio/02 Labon Ko.m4a"

Steps, each cached in the work folder (default audio/work/<id>/) and skipped when its output is already there:

  1. stems       demucs-mlx htdemucs_ft → drums / bass / other / vocals (about 6 min for a 5-minute song on an M4)
  2. mix         bass + other + vocals summed by ffmpeg → the drum-less play-along mix (AAC)
  3. transcribe  drum2midi (default) or ADTOF on the drum stem → a MIDI of hits in audio seconds
  4. grid        tempo, first downbeat and the transcriber's lead, measured from the hits and the stem → grid.json
  5. song        scripts/transcription-to-song.py → audio/songs/<id>/ and audio/songs/<id>.zip

Title, artist, album, year and genre come from the file's tags unless given. When over a quarter of the hats come
out open, they are written closed: drum2midi hears accented closed 16ths as open (36 % of Labon Ko's hats). The grid assumes a constant tempo in
4/4 (a click-recorded studio track): the fit reports how well the hits sit on it and warns when they drift, and
--bpm / --offset override what it finds. Then drag the zip onto the library and check the offset by ear in Studio.

The grid. The tempo is the one whose 16th grid the hits line up on best (the length of the mean of
exp(2πi·t/16th) over every hit), searched around librosa's estimate and its double, half and 3:2 relatives;
within 1 % of a whole BPM it snaps to it. A snare on one beat a bar instead of two (2 and 4) means the
tempo was counted double, and it is halved. Which 16th starts the bar comes from the drums: snare on 2 and 4, kick
and crashes on 1. Bar 1 is the first downbeat at or after the start of the audio, so bar numbers count from the
top of the song whether or not the drums play yet.

The lead. Transcribers stamp a hit slightly before its audible attack. It is measured on the drum stem as the
median gap from each hat and snare note to where its band's envelope first reaches 10 % of the hit's peak, and
added to every note and to the offset. (Labon Ko, drum2midi: hats +3.6 ms, snare +5.4 ms. Kicks are left out:
a 40–120 Hz envelope rises over a whole cycle of the note, so it reads late.)
"""
import argparse, json, os, re, shutil, subprocess, sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
VENV_BIN = Path(sys.executable).parent  # run with the project's .venv/bin/python
REPO = VENV_BIN.parent.parent  # the checkout that owns .venv (tools/ lives there too, even from a worktree)

KICK, SNARE, HATS, CRASH = {35, 36}, {37, 38, 40}, {42, 44, 46}, {49, 52, 55, 57}
GM_DRUMS = set(range(35, 60))
MIN_BPM, MAX_BPM = 60, 200
SNAP_BPM = 0.99  # a whole BPM wins when it fits at least this well relative to the best fit
OPEN_HAT_FOLD = 0.25  # open hats past this share of all hats are the transcriber hearing accents, not a foot opening the hats
DRIFT_WARN = 0.015  # s: hits a third of the way through sitting this far off the grid's phase mean the tempo moves


def run(cmd, **kw):
    print('  $', ' '.join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def fresh(out: Path, *deps: Path) -> bool:
    """Built, newer than its inputs, and not empty: a failed ffmpeg run leaves a zero-byte file behind."""
    return out.exists() and out.stat().st_size > 0 and all(out.stat().st_mtime >= d.stat().st_mtime for d in deps)


def tags(path: Path) -> dict:
    try:
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', str(path)], capture_output=True, text=True, check=True)
        return {k.lower(): v for k, v in json.loads(probe.stdout).get('format', {}).get('tags', {}).items()}
    except Exception:
        return {}


def slug(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


# ---------------------------------------------------------------- grid


def grid_fit(t: np.ndarray, bpm: float):
    """How well hits at times t sit on a 16th grid at bpm: (|mean resultant| 0..1, phase of the grid in s)."""
    six = 60 / bpm / 4
    z = np.exp(2j * np.pi * t / six).mean()
    return abs(z), (np.angle(z) / (2 * np.pi) * six) % six


def on_grid(t: np.ndarray, bpm: float) -> float:
    """Share of hits within a quarter of a 16th (at most 30 ms) of the 16th grid at bpm, at its best phase."""
    six = 60 / bpm / 4
    _, phase = grid_fit(t, bpm)
    off = ((t - phase + six / 2) % six) - six / 2
    return float(np.mean(np.abs(off) <= min(0.03, six / 4)))


def find_tempo(t: np.ndarray, seed: float) -> tuple[float, float]:
    """Best-fitting tempo near the seed or its double/half/3:2 relatives, and its fit.

    Which relative is decided by the share of hits on its 16th grid, not by the fit: hits jitter by the same few ms
    at any tempo, so a slower grid always fits a little better, and a groove made only of 8ths sits just as well on
    the 16ths of half its tempo. Where the shares tie, the seed (librosa, which leans towards 120) stays if it is a
    plausible tempo; otherwise the tie goes to the one nearest 100 BPM.
    """
    def best_near(c):
        bpms = np.arange(c * 0.96, c * 1.04, 0.002)
        fits = [grid_fit(t, b)[0] for b in bpms]
        i = int(np.argmax(fits))
        return float(bpms[i])

    cands = [best_near(seed * k) for k in (1, 2, 0.5, 1.5, 2 / 3) if MIN_BPM <= seed * k <= MAX_BPM]
    share = {b: on_grid(t, b) for b in cands}
    top = max(share.values())
    tied = [b for b in cands if share[b] >= top - 0.03]
    bpm = cands[0] if cands[0] in tied and 70 <= cands[0] <= 160 else min(tied, key=lambda b: abs(np.log(b / 100)))
    fit = grid_fit(t, bpm)[0]
    whole = round(bpm)
    if abs(bpm - whole) < 0.05 and grid_fit(t, whole)[0] >= fit * SNAP_BPM:
        return float(whole), grid_fit(t, whole)[0]
    return round(bpm, 3), fit


def downbeat_slot(t: np.ndarray, pitch: np.ndarray, bpm: float, phase: float) -> int:
    """Which 16th of the grid (0..15 from `phase`) starts the bar, for 4/4: snare on 2 and 4, kick and crashes on 1."""
    six = 60 / bpm / 4
    slot = np.round((t - phase) / six).astype(int) % 16
    hist = lambda notes: np.bincount(slot[np.isin(pitch, list(notes))], minlength=16).astype(float)
    k, s, c = hist(KICK), hist(SNARE), hist(CRASH)
    norm = lambda h: h / max(1.0, h.sum())
    k, s, c = norm(k), norm(s), norm(c)

    def score(r):
        kr, sr, cr = np.roll(k, -r), np.roll(s, -r), np.roll(c, -r)
        return (sr[4] + sr[12] - sr[0] - sr[8]) + (kr[0] - kr[4] - kr[12]) + 2 * cr[0]

    return max(range(16), key=score)


def half_time(t: np.ndarray, pitch: np.ndarray, bpm: float, phase: float) -> bool:
    """The snare lands on one beat a bar, not two half a bar apart: a backbeat counted at double tempo."""
    six = 60 / bpm / 4
    slot = np.round((t[np.isin(pitch, list(SNARE))] - phase) / six).astype(int) % 16
    h = np.bincount(slot, minlength=16)
    x = int(np.argmax(h))
    return len(slot) >= 16 and h[x] >= 0.3 * len(slot) and h[(x + 8) % 16] < 0.3 * h[x]


def measure_lead(stem: Path, t: np.ndarray, pitch: np.ndarray) -> tuple[float, dict]:
    """Median gap (s) from hat and snare notes to the 10 % rise of their attack in the drum stem."""
    import librosa
    import scipy.signal as ss

    y, sr = librosa.load(str(stem), sr=44100, mono=True)
    gaps, per = [], {}
    for name, notes, lo, hi in (('hats', HATS, 6000, 15000), ('snare', SNARE, 150, 1500)):
        sos = ss.butter(4, [lo, hi], btype='band', fs=sr, output='sos')
        env = np.abs(ss.hilbert(ss.sosfiltfilt(sos, y)))
        env = np.convolve(env, np.ones(44) / 44, 'same')  # 1 ms
        mine = []
        for x in t[np.isin(pitch, list(notes))]:
            a, b = int((x - 0.05) * sr), int((x + 0.08) * sr)
            if a < int(0.03 * sr) or b > len(env):
                continue
            w = env[a:b]
            k = int(np.argmax(w))
            base = float(np.median(env[a - int(0.03 * sr):a]))
            if w[k] < 3 * base:  # buried in bleed; no clean attack to read
                continue
            th = base + 0.1 * (w[k] - base)
            j = k
            while j > 0 and w[j] > th:
                j -= 1
            mine.append((a + j) / sr - x)
        if mine:
            per[name] = {'lead': round(float(np.median(mine)), 4), 'hits': len(mine)}
            gaps += mine
    if len(gaps) < 20:
        return 0.0, per
    return float(np.clip(np.median(gaps), -0.03, 0.05)), per


def analyse(midi: Path, stem: Path, bpm_override, offset_override) -> dict:
    import librosa
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(str(midi))
    hits = sorted((n.start, n.pitch) for inst in pm.instruments for n in inst.notes if n.pitch in GM_DRUMS)
    if len(hits) < 64:
        raise SystemExit(f'{midi}: only {len(hits)} drum hits; nothing to fit a grid to')
    t = np.array([h[0] for h in hits])
    pitch = np.array([h[1] for h in hits])

    y, sr = librosa.load(str(stem), sr=22050, mono=True)
    seed = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=librosa.onset.onset_strength(y=y, sr=sr), sr=sr))[0])
    if bpm_override:
        bpm, fit = bpm_override, grid_fit(t, bpm_override)[0]
    else:
        bpm, fit = find_tempo(t, seed)
        if bpm / 2 >= MIN_BPM and half_time(t, pitch, bpm, grid_fit(t, bpm)[1]):
            bpm = bpm / 2 if bpm % 2 else bpm // 2
            fit = grid_fit(t, bpm)[0]
    six = 60 / bpm / 4
    bar = 16 * six
    _, phase = grid_fit(t, bpm)

    off = ((t - phase + six / 2) % six) - six / 2
    on_grid = float(np.mean(np.abs(off) < 0.03))
    thirds = []
    for k in range(3):
        lo, hi = t[0] + k * (t[-1] - t[0]) / 3, t[0] + (k + 1) * (t[-1] - t[0]) / 3
        m = (t >= lo) & (t <= hi)
        thirds.append(float(np.median(off[m])) if m.any() else 0.0)
    drift = max(thirds) - min(thirds)

    lead, lead_by = measure_lead(stem, t, pitch)
    if offset_override is not None:
        offset, slot = offset_override, None
    else:
        slot = downbeat_slot(t, pitch, bpm, phase)
        offset = (phase + slot * six + lead) % bar

    # Preview from the first bar the drums really play in (8+ hits).
    bars = np.floor((t + lead - offset) / bar).astype(int)
    busy = [b for b in sorted(set(bars.tolist())) if b >= 0 and (bars == b).sum() >= 8]
    preview = round(offset + busy[0] * bar, 1) if busy else None

    return {
        'bpm': bpm, 'offset': round(float(offset), 4), 'lead': round(lead, 4), 'leadBy': lead_by,
        'tempoSeed': round(seed, 2), 'fit': round(float(fit), 3), 'onGrid30ms': round(on_grid, 3),
        'driftMs': round(drift * 1000, 1), 'thirdsMs': [round(x * 1000, 1) for x in thirds],
        'downbeatSlot': slot, 'firstDrumBar': busy[0] + 1 if busy else None, 'preview': preview,
        'openHatShare': round(float(np.isin(pitch, [46]).sum() / max(1, np.isin(pitch, list(HATS)).sum())), 3),
        'hits': len(t), 'bpmGiven': bool(bpm_override), 'offsetGiven': offset_override is not None,
    }


# ---------------------------------------------------------------- pipeline


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('audio', help='the full mix (m4a, mp3, wav, flac, ...)')
    ap.add_argument('--id', help='song id (default: from the title)')
    ap.add_argument('--title')
    ap.add_argument('--artist')
    ap.add_argument('--album')
    ap.add_argument('--year', type=int)
    ap.add_argument('--genre')
    ap.add_argument('--accent', help='hex colour for the song card')
    ap.add_argument('--sections', metavar='JSON', help='[{"bar": N, "name": "..."}] for song.json (bar 1 = first downbeat)')
    ap.add_argument('--bpm', type=float, help='skip the tempo search')
    ap.add_argument('--offset', type=float, help='audio seconds of bar 1; skips the downbeat search')
    ap.add_argument('--transcriber', choices=('drum2midi', 'adtof'), default='drum2midi', help='drum2midi: hat states, crash vs ride, velocities (default). adtof: 5 classes, flat velocity, faster')
    hats = ap.add_mutually_exclusive_group()
    hats.add_argument('--fold-open-hats', action='store_true', help='write every open hat as closed (default: only when over a quarter of the hats came out open)')
    hats.add_argument('--keep-open-hats', action='store_true', help='keep open hats as transcribed')
    ap.add_argument('--quantize', type=int, default=16, metavar='N', help='snap hits to 1/N notes (0 = off; 12 or 24 for triplet feels)')
    ap.add_argument('--work', help='work folder (default audio/work/<id>)')
    ap.add_argument('--out', help='song folder (default audio/songs/<id>); the zip lands next to it')
    ap.add_argument('--drum2midi', default=str(REPO / 'tools' / 'drum2midi'), help='drum2midi checkout')
    ap.add_argument('--force', action='store_true', help='redo every step, even cached ones')
    a = ap.parse_args()

    src = Path(a.audio).resolve()
    if not src.exists():
        raise SystemExit(f'{src}: no such file')
    tg = tags(src)
    title = a.title or tg.get('title') or src.stem
    sid = a.id or slug(title) or 'song'
    year = a.year or (int(m.group()) if (m := re.match(r'\d{4}', tg.get('date', ''))) else None)
    work = Path(a.work or f'audio/work/{sid}').resolve()
    out = Path(a.out or f'audio/songs/{sid}').resolve()
    work.mkdir(parents=True, exist_ok=True)
    print(f'{title} → {sid}\n  work {work}\n  song {out}')

    # 1. stems
    stems = work / 'stems' / src.stem
    names = ('drums', 'bass', 'other', 'vocals')
    if a.force or not all(fresh(stems / f'{n}.wav', src) for n in names):
        print('1/5 stems (demucs-mlx htdemucs_ft)')
        run([VENV_BIN / 'demucs-mlx', '-n', 'htdemucs_ft', '-o', work / 'stems', src])
    else:
        print('1/5 stems: cached')
    drums = stems / 'drums.wav'

    # 2. drum-less mix
    no_drums = work / 'no-drums.m4a'
    if a.force or not fresh(no_drums, drums):
        print('2/5 drum-less mix')
        ins = sum((['-i', stems / f'{n}.wav'] for n in ('bass', 'other', 'vocals')), [])
        run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', 'amix=inputs=3:normalize=0', '-vn', '-c:a', 'aac', '-b:a', '192k', no_drums])
    else:
        print('2/5 drum-less mix: cached')
    with_drums = src
    if src.suffix.lower() not in ('.m4a', '.mp3', '.aac', '.ogg'):  # don't zip a 60 MB wav or flac; -vn drops embedded cover art
        with_drums = work / 'with-drums.m4a'
        if a.force or not fresh(with_drums, src):
            run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', '256k', with_drums])

    # 3. transcription
    midi = work / f'{a.transcriber}.mid'
    if a.force or not fresh(midi, drums):
        print(f'3/5 transcription ({a.transcriber})')
        if a.transcriber == 'drum2midi':
            script = Path(a.drum2midi) / 'drum2midi.py'
            if not script.exists():
                raise SystemExit(f'{script} missing: clone drum2midi into tools/ (README → Audio tooling) or pass --drum2midi')
            run([sys.executable, script, drums, '-o', midi])
        else:
            run([VENV_BIN / 'adtof', '--audio', drums, '--out', midi, '--device', 'cpu'])
    else:
        print('3/5 transcription: cached')

    # 4. grid
    print('4/5 grid')
    g = analyse(midi, drums, a.bpm, a.offset)
    (work / 'grid.json').write_text(json.dumps(g, indent=2))
    lead_by = ', '.join(f"{k} {v['lead'] * 1000:+.1f} ms ({v['hits']})" for k, v in g['leadBy'].items())
    print(f"  {g['bpm']} BPM{' (given)' if g['bpmGiven'] else ''} — librosa guessed {g['tempoSeed']}; "
          f"{g['onGrid30ms'] * 100:.0f} % of {g['hits']} hits within 30 ms of a 16th, fit {g['fit']}")
    print(f"  bar 1 at {g['offset']} s{' (given)' if g['offsetGiven'] else ''}; drums from bar {g['firstDrumBar']}; transcriber lead {g['lead'] * 1000:+.1f} ms ({lead_by})")
    if g['driftMs'] > DRIFT_WARN * 1000:
        print(f"  WARNING: hits drift {g['driftMs']} ms against the grid across the song (thirds {g['thirdsMs']} ms): the tempo moves, "
              'and a constant map will not fit. Chart it by hand or pass --quantize 0.')
    if g['fit'] < 0.6:
        print('  WARNING: the hits sit loosely on any 16th grid (fit < 0.6): swung, triplet or free time? Try --quantize 12 or --quantize 0, or give --bpm.')

    fold = a.fold_open_hats or (not a.keep_open_hats and g['openHatShare'] > OPEN_HAT_FOLD)
    if g['openHatShare'] > OPEN_HAT_FOLD and not a.keep_open_hats:
        print(f"  {g['openHatShare'] * 100:.0f} % of hats came out open: read as accents and written closed (--keep-open-hats keeps them)")

    # 5. song folder + zip
    print('5/5 song')
    cmd = [sys.executable, HERE / 'transcription-to-song.py', '--midi', midi, '--bpm', g['bpm'], '--offset', g['offset'], '--lead', g['lead'],
           '--audio', no_drums, '--audio-with-drums', with_drums, '--drums-stem', drums, '--id', sid, '--title', title,
           '--artist', a.artist or tg.get('artist') or 'Unknown Artist',
           '--charter', f"woodshed pipeline ({a.transcriber}{f', {a.quantize}th-quantized' if a.quantize else ''})", '--out', out]
    if a.quantize:
        cmd += ['--quantize', a.quantize]
    if fold:
        cmd += ['--fold-open-hats']
    for flag, v in (('--album', a.album or tg.get('album')), ('--year', year), ('--genre', a.genre or tg.get('genre')),
                    ('--accent', a.accent), ('--sections', a.sections), ('--preview-start', g['preview'])):
        if v is not None:
            cmd += [flag, v]
    run(cmd)
    meta = json.loads((out / 'song.json').read_text())
    print(f"\n{out}.zip — {meta['bpm']} BPM, offset {meta['offset']} s. Drag it onto the library, then check the offset by ear in Studio.")


if __name__ == '__main__':
    main()
