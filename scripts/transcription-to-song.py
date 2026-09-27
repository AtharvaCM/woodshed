#!/usr/bin/env python
"""Turn a drum transcription MIDI (absolute audio seconds) into a WOODSHED song folder + zip.

Chart tick 0 is placed at `--offset` seconds of audio (the song's first downbeat), and a constant
tempo map at `--bpm` is written so bar lines in the editor land on the music. Notes before the
offset are dropped. GM drum notes only; anything else is ignored.

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
ap.add_argument('--fold-open-hats', action='store_true', help='write open hi-hat (46) as closed (42); transcribers often call every accented 16th "open"')
ap.add_argument('--out', required=True)
a = ap.parse_args()

src = pretty_midi.PrettyMIDI(a.midi)
notes = sorted((n for inst in src.instruments for n in inst.notes if n.pitch in GM_KEEP), key=lambda n: n.start)
dropped = sum(1 for n in notes if n.start < a.offset)

out = pretty_midi.PrettyMIDI(initial_tempo=a.bpm, resolution=480)
drums = pretty_midi.Instrument(program=0, is_drum=True, name='WOODSHED')
beat = 60 / a.bpm
for n in notes:
    t = n.start - a.offset
    if t < 0:
        continue
    pitch = 42 if (a.fold_open_hats and n.pitch == 46) else n.pitch
    drums.notes.append(pretty_midi.Note(velocity=max(1, min(127, int(n.velocity))), pitch=pitch, start=t, end=t + beat / 8))
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
    pass
if a.preview_start is not None:
    meta['preview'] = {'start': a.preview_start, 'length': 20}
with open(os.path.join(a.out, 'song.json'), 'w') as f:
    json.dump(meta, f, indent=2, ensure_ascii=False)

zip_path = a.out.rstrip('/') + '.zip'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(a.out)):
        z.write(os.path.join(a.out, f), f)
print(f"{len(drums.notes)} notes written ({dropped} before offset dropped); folder {a.out}; zip {zip_path}")
print(json.dumps(meta, indent=2, ensure_ascii=False))
