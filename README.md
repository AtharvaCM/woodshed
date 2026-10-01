# WOODSHED

A browser practice room for e-drummers. Plug a Roland TD-07 (or any USB-MIDI kit) into Chrome, pick a song, and play it from drum-tab lines (or a Guitar-Hero-style highway) that score every hit. Slow the hard bars down, loop them, then take the full run. Build charts for songs nobody has charted, starting with Hindi/Bollywood tracks.

*Woodshed* is jazz slang for practising hard, alone, until it sits.

**Play it:** <https://atharvacm.github.io/woodshed/> (Chrome or Edge). GitHub Pages redeploys it from `main` on every push.

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

- **Grid view** (default): the chart as drum-tab lines, two bars a line (one on a narrow window) with the next line underneath and a playhead sweeping across. Every drum has a fixed row in notation order and every 16th a fixed column, so a groove looks the same each time round; notes are sized by velocity (ghosts hollow, accents ringed) and your strokes show as ticks where they landed.
- **Highway**: hi-hat, snare, kick, toms, ride lanes and a full-width crash bar. Settings → View & controls, or the VIEW button in practice, switches between the two. Four difficulties per song; easier charts derive automatically from the hardest one.
- **Scoring**: perfect/great/good windows (scaled by *Hit window size* in Settings), combo, stars, full-combo badge, local leaderboards.
- **Practice mode**: 50–125 % speed (presets on the song screen), bar counter, loop 1/2/4/8 bars from the current bar, jump bar by bar or section by section, loop a whole section, guide drums on/off mid-take. Keys: `↑`/`↓` speed, `←`/`→` bar, `Shift+←`/`Shift+→` section, `1` `2` `4` `8` loop, `0` no loop. Nothing is saved.
- **Sections**: named song parts (`song.json` `sections`), edited on the Studio SONG tab. Songs without them get sections detected from the chart: bars clustered into grooves, split where the drums come in or stop, the groove changes, or a fill or crash lands after eight bars.
- **Where it slipped**: the results screen colours every bar by accuracy and picks your weakest 4-bar stretch; `P` (or the button) drops you straight into practice looping those bars.
- **Practice history and tempo ladder**: every pass round a practice loop and every finished take is saved in the browser (timing, spread, hits, speed); the HUD shows the last pass, and the results screen charts your spread over recent takes and passes. LADDER ON steps the speed up 5 % after a clean pass (95 % hit, spread ≤ 20 ms) and down 5 % after one that misses more than 20 %, between 50 % and full speed.
- **Quiet Count** (practice, after Roland's coach mode): QUIET 4·2 / 4·4 / 8·8 plays that many bars with the song, then that many without, over and over (bars counted as played, so it runs on across loop wraps). In the quiet bars the song and guide drums drop out on the bar line, the grid hides its playhead and every verdict, and the highway hides its notes. Afterwards: where you sat alone against with the song, your spread, and where you had drifted to by the last quiet bar.
- **Timing & feel**: where you sit against the beat (median, ahead or behind) and how steady you are (spread of the middle half of your hits), per drum and per section with rushing/dragging flagged, the kick against your hands on beats they share, the loosest 4 bars (one click to practise them), and your ghost notes against your backbeats from the pad velocities.
- **Title screen**: kit / pad map / calibration status with a fix-it button each, and "pick up where you left off" back into your last song. Browser Back/Forward move between screens.
- **Studio**: turn any audio file into a song. Tap tempo, set the downbeat offset, then record a take on the kit with count-in and click, quantize it (1/4…1/32, triplets, strength, double-hit merge), and polish it in the piano-roll chart editor. Export as standard MIDI (GM drums, channel 10) or as a song-folder zip. There is no MIDI *import* button yet; a chart made elsewhere goes in as `expert.mid` inside a song folder (see below).
- **Song folders**: `song.json` + audio + one MIDI per difficulty + optional samples/artwork. Drag a zip onto the song list to import. Format: [docs/SONG-FORMAT.md](docs/SONG-FORMAT.md).
- **Pad Setup wizard**: per-device bindings, presets for Roland V-Drums, Yamaha FGDP, generic 4×4 pads and General MIDI, live MIDI monitor with timestamp health.
- **Performance video**: record webcam + grid or highway + HUD in the browser (WebM). Handy for cover-video takes.
- **Menus from the kit**: high tom ▲, mid tom ▼, floor tom twice = select, crash twice = back, on the title, song list, pause menu and results. Only after a short pause in playing, so grooves and fills never move the menu. Toggle in Settings → Lanes & Controls.
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

Adding your drums to someone's collab clip: `scripts/collab-stack.py` stacks the clip's player panels and your camera into one 1080-wide portrait video with a fresh mix. It works from a kit folder (`sync.json`, the band's audio with its guide drums removed by demucs, and those guide drums alone). Your TD-07 take and camera are synced automatically; see the script's header for the recording workflow. `scripts/drum-take.swift` records the take itself: it plays the reference, stamps the kit's CoreMIDI hits against it (Roland edge zones folded onto GM notes, since GarageBand ignores 22/26), and renders the MIDI with macOS's built-in GM drums, so no driver or DAW is needed.

## Project layout

```
src/types.ts      shared data contracts (chart, song.json, device config, settings)
src/midi/         SMF parser/writer, GM drum map + device presets (Roland V-Drums lives in gm.ts), chart<->MIDI, quantizer, difficulty derivation
src/audio/        AudioEngine, Transport, synthesized DrumKit, ChartPlayer, Metronome
src/song/         song folder/zip packaging, IndexedDB library
src/store/        scores, device configs, settings (localStorage)
src/input/        Web MIDI + keyboard → unified hit stream
src/game/         Judge (scoring), GridRenderer + HighwayRenderer, GameSession, video recorder
src/ui/           screens: title, song select, game, results, pad wizard, studio, settings
docs/             SONG-FORMAT.md, ROADMAP.md, research.md
```

## Credits and license

Forked from **DRUMKILLER** by sam1am, MIT licensed. The original copyright notice is kept in [LICENSE](LICENSE); WOODSHED's changes are under the same license.
