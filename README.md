# WOODSHED

A browser practice room for e-drummers. Plug a Roland TD-07 (or any USB-MIDI kit) into Chrome, pick a song, and play it on a Guitar-Hero-style highway that scores every hit. Slow the hard bars down, loop them, then take the full run. Build charts for songs nobody has charted, starting with Hindi/Bollywood tracks.

*Woodshed* is jazz slang for practising hard, alone, until it sits.

**Status:** day 0. Forked from [DRUMKILLER](https://github.com/sam1am/drumkiller) by sam1am (MIT), rebranded, with a Roland V-Drums preset added. Everything DRUMKILLER does still works; see [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next and [docs/research.md](docs/research.md) for the verified facts behind the plan.

```
npm install
npm run dev        # http://localhost:5173  (open in Chrome or Edge)
npm test           # unit tests
npm run typecheck
npm run build      # static build in dist/
```

Safari has no Web MIDI. Chrome 124+ asks for MIDI permission on first use; allow it.

## Connect a Roland TD-07

1. USB-C → **USB-B, USB 2.0** cable (the manual says USB 3.0 cables do not work). Not in the box.
2. Leave the module on its default `SETUP > SYSTEM > USBDrv = GENERIC`. That is class-compliant MIDI: no driver, and Chrome sees it the moment you plug in.
3. Open the app, click the MIDI pill on the title screen, allow access. The port name contains `TD-07`, so the **Roland V-Drums** preset loads automatically (kick 36, snare 38/40/37, toms 48/45/43, hats 42/22/44 closed and 46/26 open, ride 51/59/53, crashes 49/55/57/52).
4. **PAD SETUP** shows a MIDI monitor. Hit every pad once: each hit should light up a drum chip, and the monitor line should not say "(ignored)" (that means the hardware timestamp was rejected and arrival time is being used instead). Unbind note 44 (hi-hat pedal) there if foot-chicks cause overhits on songs that don't chart them.
5. **SETTINGS → Run calibration** once, wired headphones on. Bluetooth headphones add 40–300 ms and will wreck timing.

Only one program can own a MIDI port. Close Clone Hero, GarageBand or any other MIDI app before playing here, and vice versa.

Switch `USBDrv` to `VENDOR` and install Roland's driver only when you want the module's audio over USB (for recording). Flip back to `GENERIC` for practice.

## What it does today

- **Highway**: hi-hat, snare, kick, toms, ride lanes and a full-width crash bar. Four difficulties per song; easier charts derive automatically from the hardest one.
- **Scoring**: perfect/great/good windows (scaled by *Hit window size* in Settings), combo, stars, full-combo badge, local leaderboards.
- **Practice mode**: 50–125 % speed, A/B loop, seek, guide drums. Nothing is saved.
- **Studio**: turn any audio file into a song. Tap tempo, set the downbeat offset, then record a take on the kit with count-in and click, quantize it (1/4…1/32, triplets, strength, double-hit merge), and polish it in the piano-roll chart editor. Export as standard MIDI (GM drums, channel 10) or as a song-folder zip. There is no MIDI *import* button yet; a chart made elsewhere goes in as `expert.mid` inside a song folder (see below).
- **Song folders**: `song.json` + audio + one MIDI per difficulty + optional samples/artwork. Drag a zip onto the song list to import. Format: [docs/SONG-FORMAT.md](docs/SONG-FORMAT.md).
- **Pad Setup wizard**: per-device bindings, presets for Roland V-Drums, Yamaha FGDP, generic 4×4 pads and General MIDI, live MIDI monitor with timestamp health.
- **Performance video**: record webcam + highway + HUD in the browser (WebM). Handy for cover-video takes.
- **Keyboard fallback** so the app runs with no hardware: `Space`/`B` kick, `F`/`J` snare, `D` hat closed, `S` hat open, `G`/`H`/`K` toms high/mid/low, `L` ride, `A`/`;` crash.

## Getting a song in

Only DRUMKILLER's two synthesized demo songs are bundled. The intended pipeline for a real track with no existing chart:

1. Your own audio file of the song.
2. Stem separation on the Mac: `demucs-mlx` for the drum stem (seconds on Apple Silicon), upstream `demucs --two-stems=drums` for a drumless backing track.
3. Drum stem → MIDI with `drum2midi` or `ADTOF-pytorch`.
4. Make a song folder: `song.json` (title, bpm, offset, `audio`, `charts.expert`), the drumless mix, and the MIDI saved as `expert.mid`. Zip it and drag the zip onto the song list. Then **STUDIO → open it** and fix the chart by ear in the editor. Format: [docs/SONG-FORMAT.md](docs/SONG-FORMAT.md).

Details, tool versions and caveats: [docs/research.md](docs/research.md) §3. Automating steps 2–4 (and a MIDI import button in the Studio) is on the roadmap.

### Audio tooling (macOS, Apple Silicon)

Lives in a project-local Python 3.12 venv, kept out of git:

```
brew install ffmpeg uv
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python pip demucs-mlx demucs \
  "adtof-pytorch @ git+https://github.com/xavriley/ADTOF-pytorch"
git clone --depth 1 https://github.com/miraer/drum2midi.git tools/drum2midi
( cd tools/drum2midi && ../../.venv/bin/python setup_env.py --no-render )
```

Then:

```
.venv/bin/demucs-mlx -n htdemucs_ft -o out song.mp3          # drums/bass/other/vocals stems, seconds on M-series
.venv/bin/demucs --two-stems=drums -o out song.mp3             # drums.wav + no_drums.wav (the play-along mix)
.venv/bin/adtof --audio out/htdemucs_ft/song/drums.wav --out song.mid --device cpu   # 5-class MIDI
.venv/bin/python tools/drum2midi/drum2midi.py out/htdemucs_ft/song/drums.wav -o song.mid   # richer: hat states, crash vs ride, velocities
```

`tools/` and `.venv/` are gitignored. Model weights land in `~/.cache`.

## Project layout

```
src/types.ts      shared data contracts (chart, song.json, device config, settings)
src/midi/         SMF parser/writer, GM drum map + device presets (Roland V-Drums lives in gm.ts), chart<->MIDI, quantizer, difficulty derivation
src/audio/        AudioEngine, Transport, synthesized DrumKit, ChartPlayer, Metronome
src/song/         song folder/zip packaging, IndexedDB library
src/store/        scores, device configs, settings (localStorage)
src/input/        Web MIDI + keyboard → unified hit stream
src/game/         Judge (scoring), HighwayRenderer, GameSession, video recorder
src/ui/           screens: title, song select, game, results, pad wizard, studio, settings
docs/             SONG-FORMAT.md, ROADMAP.md, research.md
```

## Credits and license

Forked from **DRUMKILLER** by sam1am, MIT licensed. The original copyright notice is kept in [LICENSE](LICENSE); WOODSHED's changes are under the same license.
