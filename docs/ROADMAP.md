# Roadmap

Songs-first. Every phase ends with something playable on the TD-07.

## Phase 0 — prove the pipe (no code)

- [ ] USB-C → USB-B **2.0** cable. Plug in. Module stays in `USBDrv = GENERIC`.
- [ ] `npm run dev`, open in Chrome, allow MIDI, confirm the Roland V-Drums preset auto-loads and every pad shows in the Pad Setup monitor without "(ignored)".
- [ ] Settings → Run calibration with wired headphones. Note the offset.
- [ ] `brew install ffmpeg`; `pip install demucs-mlx` (and upstream `demucs` for `--two-stems`).
- [ ] Claim the 40 free Melodics lessons Roland bundles with the TD-07 (separate app, technique work on the side).

## Phase 1 — Labon Ko playable

- [ ] Drum stem + drumless mix from your own audio (`demucs-mlx -n htdemucs_ft`, `demucs --two-stems=drums`).
- [ ] Stem → MIDI (`drum2midi --from-song` or `adtof --audio drums.wav`). Cross-check against Songsterr tab 2680219 (108 BPM, 4/4, 153 bars).
- [ ] Song folder by hand: `song.json` + drumless mix + the MIDI as `expert.mid` (see docs/SONG-FORMAT.md), zip, drag onto the song list. Studio → open it, set the offset on the first downbeat, fix the chart by ear. Core groove: kick 1 · a-of-1 · &-of-4, snare 2 · 4, hats 8ths.
- [ ] Practice ladder: 60 % → 80 % → 100 %, loop the hook, then the 2:37 film-edit form end to end.

## Phase 2 — chart pipeline in the repo

- [ ] `scripts/song-from-audio.mjs`: audio in → song folder out (calls demucs-mlx / demucs / drum2midi, writes `song.json` with bpm + offset guess, zips it for drag-and-drop import).
- [ ] **IMPORT MIDI** button in the Studio chart editor (load a `.mid` into the current difficulty), so step 4 above stops needing a hand-made folder.
- [ ] Songsterr scaffold importer: part JSON → expert.mid (respect ToS; user supplies the URL).
- [ ] Section markers in `song.json` (intro / hook / verse / interlude) so practice loops can jump by section instead of A/B points.
- [ ] Hindi song ladder seeded from `docs/research.md` §4 (Kabhi Kabhi Aditi 95 → Tum Se Hi 130 → Yaaron 114 → Kya Mujhe Pyaar Hai 118 → Tu Hi Meri Shab Hai 119 → Khuda Jaane 79 → Maeri 83 → Aahatein 141 → Manja 106 in 3/4).

## Phase 3 — TD-07 specifics

- [ ] Read CC#4 in `src/input/midi.ts`: classify half-open hats, expose pedal position to the HUD; calibrate the ~90 closed ceiling per device.
- [ ] Double-kick stats: inter-onset spacing and evenness for consecutive note-36 hits (both beaters share one note).
- [ ] Session log to IndexedDB: per take, per section, per voice timing error and velocity spread (the data the coach reads).
- [ ] Roland Coach modes in-app: Time Check, Quiet Count, Auto Up/Down, Change Up — with history.

## Phase 4 — coach

- [ ] Claude API over the session log: weekly plan, "you rush the hook by 20 ms", simplified beginner variant of a chart, section-by-section practice order. Small spend; never on the timing-critical path.
- [ ] Generated drills as MIDI (rudiments, genre grooves) that load straight into practice mode.

## Phase 5 — collab video (drums + bass + lead guitar, instrumental)

- [ ] Reference file for the band: 2-bar count-in click + drumless mix at 108 BPM, 44.1 kHz / 24-bit WAV.
- [ ] Capture: `USBDrv = VENDOR` + Roland driver 1.0.2 → GarageBand audio + MIDI tracks; slate with a clap and a rimshot. Backing track stays out of the USB stream (clean stem).
- [ ] Edit in DaVinci Resolve (free): waveform auto-sync, 3-up grid. Upload unlisted first; expect a T-Series Content ID claim set to Monetize.

## Housekeeping

- [x] DRUMKILLER landing page and its Pages deploy removed; `.github/workflows/ci.yml` runs typecheck + tests + build. Hosting the app (GitHub Pages or elsewhere) is a later decision.
- [ ] `scripts/make-demo-song.mjs`, the bundled demo songs' artist field, `docs/SONG-FORMAT.md`'s title, and header comments in `src/types.ts`, `src/midi/index.ts`, `src/ui/styles.css` still say DRUMKILLER (harmless; attribution).
- Browser storage deliberately keeps upstream's names (IndexedDB `drumkiller`, localStorage `dk.*`) so a library built in DRUMKILLER on the same origin carries over. Rename only with a migration.
