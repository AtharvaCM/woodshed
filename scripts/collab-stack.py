#!/usr/bin/env python
"""Add your drums to a collab clip: stack the clip's player panels plus your camera into one
portrait video (1080 wide, one 1080x640 row per player) with a fresh mix.

  .venv/bin/python scripts/collab-stack.py --kit audio/collab/labon-ko-bars33-66 \
      --drums-audio td07-take.wav --drums-video camera.mov

The kit folder holds sync.json plus the band's audio with its guide drums removed and the guide
drums alone (built from the clip with demucs). sync.json:
  clip         the collab video (path)
  band         kit-relative WAV: the band without drums (goes in the mix)
  guide_drums  kit-relative WAV: the drums the band played to (used only for syncing)
  panels       [{name, crop: [w, h, x, y]}] rows to cut from the clip, top to bottom

--drums-audio  the kit's own audio (e.g. TD-07 over USB), recorded while playing along to the kit's
               reference WAV and exported from the start of that reference. The clip then begins
               sync.json's reference_band_start_s into it; onset matching against the guide drums
               only fine-tunes that by up to ±0.25 s. (A free search can't be trusted: a groove
               repeats every bar, so matches one or two bars off score almost as well.)
--drums-video  your camera, synced against --drums-audio through the camera's microphone (pad
               thumps, speaker bleed). Slate it: a loud rimshot or crash before the count-in gives
               the match something that doesn't repeat.
Force either offset (seconds into that file at clip time 0) when a sync is reported as weak or ambiguous.
"""
import argparse, json, os, subprocess, tempfile
import numpy as np, librosa, soundfile as sf

SR = 22050
HOP = 128
ROW_W, ROW_H = 1080, 640

ap = argparse.ArgumentParser()
ap.add_argument('--kit', required=True)
ap.add_argument('--drums-audio', required=True)
ap.add_argument('--drums-video', required=True)
ap.add_argument('--out')
ap.add_argument('--drums-audio-offset', type=float)
ap.add_argument('--drums-video-offset', type=float)
ap.add_argument('--drums-gain-db', type=float, default=0.0, help='drums level relative to the band before loudness normalisation')
a = ap.parse_args()

kit = json.load(open(os.path.join(a.kit, 'sync.json')))
out = a.out or os.path.join(a.kit, 'collab-stacked.mp4')
clip = kit['clip']
clip_len = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip]))


def onset_env(path: str) -> np.ndarray:
    y = librosa.load(path, sr=SR, mono=True)[0]
    e = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    return (e - e.mean()) / (e.std() + 1e-9)


def find_start(ref: np.ndarray, sig: np.ndarray, label: str, around: float | None = None, span: float = 0.25) -> float:
    """Seconds into `sig` at which `ref` begins (negative: `sig` starts late). With `around`, only
    lags within ±span of it are considered."""
    n = len(ref) + len(sig)
    c = np.fft.irfft(np.fft.rfft(sig, n) * np.conj(np.fft.rfft(ref, n)), n)
    c = np.r_[c[n - len(ref) + 1:], c[:len(sig)]]  # lags -(len(ref)-1) .. len(sig)-1
    lags = (np.arange(len(c)) - (len(ref) - 1)) * HOP / SR
    typical = np.median(np.abs(c)) + 1e-9
    ok = np.abs(lags - around) <= span if around is not None else np.ones(len(c), bool)
    j = int(np.argmax(np.where(ok, c, -np.inf)))
    lag = float(lags[j])
    strength = c[j] / typical
    note = '' if strength > 8 else ' - WEAK, check it or force the offset'
    if around is None:
        rival = np.max(np.where(np.abs(lags - lag) > 0.3, c, -np.inf))
        if rival > 0.85 * c[j]:
            note += f' - AMBIGUOUS: {lags[int(np.argmax(np.where(np.abs(lags - lag) > 0.3, c, -np.inf)))]:+.3f} s matches almost as well'
    else:
        note += f' ({(lag - around) * 1000:+.0f} ms from expected)'
    print(f'{label}: clip time 0 is {lag:+.3f} s into the file (match {strength:.0f}x typical){note}')
    return lag


drums_start = a.drums_audio_offset
if drums_start is None:
    drums_start = find_start(onset_env(os.path.join(a.kit, kit['guide_drums'])), onset_env(a.drums_audio), 'drums audio', around=kit['reference_band_start_s'])

with tempfile.TemporaryDirectory() as tmp:
    # Drums cut to clip time 0 .. clip end (silence where the take doesn't cover it).
    y, sr = sf.read(a.drums_audio, always_2d=True)
    n = int(round(clip_len * sr))
    start = int(round(drums_start * sr))
    aligned = np.zeros((n, y.shape[1]))
    src, dst = max(0, start), max(0, -start)
    k = max(0, min(n - dst, len(y) - src))
    aligned[dst:dst + k] = y[src:src + k]
    drums_wav = os.path.join(tmp, 'drums.wav')
    sf.write(drums_wav, aligned, sr, subtype='PCM_24')

    video_start = a.drums_video_offset
    if video_start is None:
        cam_wav = os.path.join(tmp, 'cam.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.drums_video, '-vn', '-ac', '1', '-ar', str(SR), cam_wav], check=True)
        video_start = find_start(onset_env(drums_wav), onset_env(cam_wav), 'camera')

    rows = []
    fc = ''
    for i, p in enumerate(kit['panels']):
        w, h, x, y0 = p['crop']
        fc += f'[0:v]crop={w}:{h}:{x}:{y0},scale={ROW_W}:{ROW_H}:force_original_aspect_ratio=increase,crop={ROW_W}:{ROW_H},setsar=1[p{i}];'
        rows.append(f'[p{i}]')
    cam = f'[1:v]trim=start={max(0.0, video_start):.4f},setpts=PTS-STARTPTS,scale={ROW_W}:{ROW_H}:force_original_aspect_ratio=increase,crop={ROW_W}:{ROW_H},setsar=1'
    if video_start < 0:
        cam += f',tpad=start_duration={-video_start:.4f}:color=black'
    fc += cam + '[cam];'
    rows.append('[cam]')
    fc += f'{"".join(rows)}vstack=inputs={len(rows)},fps=30,format=yuv420p[v];'
    fc += '[2:a]aformat=channel_layouts=stereo[band];'
    fc += f'[3:a]aformat=channel_layouts=stereo,volume={a.drums_gain_db}dB[dr];'
    fc += '[band][dr]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1:LRA=11[a]'
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i', clip, '-i', a.drums_video, '-i', os.path.join(a.kit, kit['band']), '-i', drums_wav,
         '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-t', f'{clip_len:.3f}',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', out],
        check=True,
    )
print(f'wrote {out} ({clip_len:.1f} s, {ROW_W}x{ROW_H * len(rows)})')
