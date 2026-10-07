#!/usr/bin/env python
"""Turn a drum transcription MIDI (absolute audio seconds) into a WOODSHED song folder + zip.

Chart tick 0 is placed at `--offset` seconds of audio (the song's first downbeat), and a constant
tempo map at `--bpm` is written so bar lines in the editor land on the music. Notes before the
offset are dropped. GM drum notes only; anything else is ignored. Pedal hi-hat (44) is written as closed
hi-hat (42) unless --keep-pedal-hats: in WOODSHED 44 is the drummer's left foot, and transcribers use it for
quiet hand hats (drum2midi put 190 in Labon Ko, most filling gaps in the 16th hat run). Two notes that land on
the same drum at the same instant after folding and snapping are merged (the louder one stays). --sections takes a JSON file of
[{ "bar": 1, "name": "Intro" }, …] (bar 1 = chart tick 0) and writes it into song.json.

Toms that land on a kick are dropped unless --keep-kick-toms: transcribers read a kick's resonance as a tom
(drum2midi put 170 of Labon Ko's 189 toms on the kick's own 16ths; the drum stem there is a kick, sub-bass
60 % against 13 % under the real fills). With --drums-stem the stem decides each one: a tom whose share of
90–250 Hz against 40–90 Hz, read from 30 to 130 ms after the hit (past the beater's click, which is broadband),
is at least TOM_SHARE stays (no lone kick in Labon Ko reached 0.48; real fill toms sit around 0.92). Without it, a tom on a kick stays only inside a run of toms (another tom within two 16ths).

--lead adds a constant to every note before anything else: transcribers stamp a hit a few ms before its audible
attack (drum2midi/ADTOF on Labon Ko: hats and snare 4–5 ms). scripts/song-from-audio.py measures it from the stem.

  .venv/bin/python scripts/transcription-to-song.py \
      --midi audio/labon-ko-adtof.mid --bpm 108 --offset 0.511 \
      --audio audio/labon-ko-no-drums.m4a --audio-with-drums "audio/02 Labon Ko.m4a" \
      --id labon-ko --title "Labon Ko" --artist "Pritam & KK" --album "Bhool Bhulaiyaa" --year 2007 \
      --out audio/songs/labon-ko
"""
import argparse, json, os, shutil, zipfile
import pretty_midi

GM_KEEP = {35, 36, 37, 38, 40, 41, 43, 45, 47, 48, 50, 42, 44, 46, 51, 53, 59, 49, 52, 55, 57}

ap = argparse.ArgumentParser()
ap.add_argument('--midi', required=True)
ap.add_argument('--bpm', type=float, required=True)
ap.add_argument('--offset', type=float, required=True, help='audio seconds at chart tick 0 (first downbeat)')
ap.add_argument('--lead', type=float, default=0.0, help='seconds added to every transcribed note: how far the transcriber stamps hits before their attack')
ap.add_argument('--audio', required=True, help='drum-less mix')
ap.add_argument('--audio-with-drums')
ap.add_argument('--id', required=True)
ap.add_argument('--title', required=True)
ap.add_argument('--artist', default='Unknown Artist')
ap.add_argument('--album')
ap.add_argument('--year', type=int)
ap.add_argument('--charter', default='woodshed pipeline')
ap.add_argument('--genre')
ap.add_argument('--preview-start', type=float)
ap.add_argument('--accent')
ap.add_argument('--quantize', type=int, default=0, metavar='N', help='snap note starts to the nearest 1/N note of the constant grid (16 = sixteenths). Transcribed onsets jitter 20-40 ms; the difficulty deriver only keeps notes within ~1/32 beat of the grid, so unquantized charts collapse on easy/medium')
ap.add_argument('--max-snap', type=float, default=0.06, help='seconds; notes further than this from a grid line are left where they are')
ap.add_argument('--fold-open-hats', action='store_true', help='write open hi-hat (46) as closed (42); transcribers often call every accented 16th "open"')
ap.add_argument('--keep-pedal-hats', action='store_true', help='keep pedal hi-hat (44) as a foot part instead of writing it as closed hat (42); only for a transcription you trust to tell the foot from quiet hand hats')
ap.add_argument('--sections', metavar='JSON', help='file with [{"bar": N, "name": "..."}]: named sections for song.json (bar 1 = chart tick 0)')
ap.add_argument('--keep-kick-toms', action='store_true', help='keep toms that land on a kick (by default they are dropped as the kick read twice)')
ap.add_argument('--drums-stem', metavar='WAV', help='drum stem aligned with --audio; lets the audio decide which toms on a kick are real')
ap.add_argument('--out', required=True)
a = ap.parse_args()

src = pretty_midi.PrettyMIDI(a.midi)
notes = sorted((n for inst in src.instruments for n in inst.notes if n.pitch in GM_KEEP), key=lambda n: n.start)
for n in notes:
    n.start += a.lead
dropped = sum(1 for n in notes if n.start < a.offset)

out = pretty_midi.PrettyMIDI(initial_tempo=a.bpm, resolution=480)
drums = pretty_midi.Instrument(program=0, is_drum=True, name='WOODSHED')
beat = 60 / a.bpm
snapped = 0
snap_err = []
folded = {46: 0, 44: 0}
written = {}  # (pitch, start rounded to 0.1 ms) -> Note, to merge notes that land on the same drum at the same instant
for n in notes:
    t = n.start - a.offset
    if t < 0:
        continue
    if a.quantize:
        step = beat * 4 / a.quantize
        g = round(t / step) * step
        if abs(g - t) <= a.max_snap:
            snap_err.append(g - t)
            t = g
            snapped += 1
    pitch = n.pitch
    if (pitch == 46 and a.fold_open_hats) or (pitch == 44 and not a.keep_pedal_hats):
        folded[pitch] += 1
        pitch = 42
    vel = max(1, min(127, int(n.velocity)))
    key = (pitch, round(t, 4))
    if key in written:
        written[key].velocity = max(written[key].velocity, vel)
        continue
    written[key] = pretty_midi.Note(velocity=vel, pitch=pitch, start=t, end=t + beat / 8)
    drums.notes.append(written[key])
TOMS, KICKS = {41, 43, 45, 47, 48, 50}, {35, 36}
TOM_SHARE = 0.6


def tom_share(y, sr, t):
    """Share of 90–250 Hz (tom body) against 40–90 Hz (kick) in the drum stem, 30 to 130 ms after t."""
    import numpy as np
    a, z = max(0, int((t + 0.03) * sr)), int((t + 0.13) * sr)
    seg = y[a:z]
    if len(seg) < 64:
        return 0.0
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    tom, sub = spec[(f >= 90) & (f < 250)].sum(), spec[(f >= 40) & (f < 90)].sum()
    return float(tom / (tom + sub + 1e-12))


kick_toms = kept_toms = 0
if not a.keep_kick_toms:
    stem = None
    if a.drums_stem:
        import librosa
        stem = librosa.load(a.drums_stem, sr=22050, mono=True)
    kicks = [n.start for n in drums.notes if n.pitch in KICKS]
    toms = [n for n in drums.notes if n.pitch in TOMS]
    on_kick = lambda n: any(abs(k - n.start) <= 0.03 for k in kicks)
    in_run = lambda n: any(o is not n and abs(o.start - n.start) <= beat / 2 + 0.01 for o in toms)
    drop = set()
    for n in toms:
        if not on_kick(n):
            continue
        kick_toms += 1
        real = tom_share(stem[0], stem[1], n.start + a.offset) >= TOM_SHARE if stem else in_run(n)
        if real:
            kept_toms += 1
        else:
            drop.add(id(n))
    drums.notes = [n for n in drums.notes if id(n) not in drop]
out.instruments.append(drums)
out.time_signature_changes.append(pretty_midi.TimeSignature(4, 4, 0))

os.makedirs(a.out, exist_ok=True)
for f in os.listdir(a.out):
    p = os.path.join(a.out, f)
    os.remove(p) if os.path.isfile(p) else shutil.rmtree(p)
out.write(os.path.join(a.out, 'expert.mid'))
audio_name = 'audio' + os.path.splitext(a.audio)[1].lower()
shutil.copy(a.audio, os.path.join(a.out, audio_name))
meta = {
    'format': 1, 'id': a.id, 'title': a.title, 'artist': a.artist,
    'bpm': a.bpm, 'offset': round(a.offset, 4), 'audio': audio_name,
    'charts': {'expert': 'expert.mid'}, 'charter': a.charter,
}
for k in ('album', 'year', 'genre', 'accent'):
    v = getattr(a, k)
    if v is not None:
        meta[k] = v
if a.audio_with_drums:
    wd = 'audio-drums' + os.path.splitext(a.audio_with_drums)[1].lower()
    shutil.copy(a.audio_with_drums, os.path.join(a.out, wd))
    meta['audioWithDrums'] = wd
try:
    import soundfile  # noqa: F401
    import librosa
    meta['length'] = round(float(librosa.get_duration(path=a.audio)), 2)
except Exception:
    try:  # libsndfile cannot open m4a/aac; ffprobe can
        import subprocess
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.audio], capture_output=True, text=True, check=True)
        meta['length'] = round(float(probe.stdout.strip()), 2)
    except Exception:
        pass
if a.preview_start is not None:
    meta['preview'] = {'start': a.preview_start, 'length': 20}
if a.sections:
    by_bar = {}
    for i, s in enumerate(json.load(open(a.sections))):
        bar, name = s.get('bar'), str(s.get('name', '')).strip()
        if not isinstance(bar, int) or bar < 1 or not name:
            raise SystemExit(f'{a.sections}[{i}]: need a whole "bar" >= 1 and a "name"')
        by_bar.setdefault(bar, name)
    meta['sections'] = [{'bar': b, 'name': by_bar[b]} for b in sorted(by_bar)]
with open(os.path.join(a.out, 'song.json'), 'w') as f:
    json.dump(meta, f, indent=2, ensure_ascii=False)

zip_path = a.out.rstrip('/') + '.zip'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(a.out)):
        z.write(os.path.join(a.out, f), f)
print(f"{len(drums.notes)} notes written ({dropped} before offset dropped); folder {a.out}; zip {zip_path}")
print(f"folded into closed hat (42): {folded[46]} open (46), {folded[44]} pedal (44); same-drum duplicates merged: {len(notes) - dropped - len(written)}")
if not a.keep_kick_toms:
    print(f"toms on a kick: {kick_toms}, dropped {kick_toms - kept_toms}, kept {kept_toms} ({'tom-like in the drum stem' if a.drums_stem else 'inside a tom run'})")
if a.quantize:
    import statistics
    print(f"quantized to 1/{a.quantize}: {snapped} snapped, mean shift {statistics.mean(snap_err)*1000:+.1f} ms, max |shift| {max(abs(x) for x in snap_err)*1000:.1f} ms, {len(notes)-dropped-snapped} left unsnapped (> {a.max_snap*1000:.0f} ms off grid)")
print(json.dumps(meta, indent=2, ensure_ascii=False))
