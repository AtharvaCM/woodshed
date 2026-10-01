# Roadmap

Songs-first. Every phase ends with something playable on the TD-07.

## Phase 0 — prove the pipe (no code)

- [x] USB-C → USB-B **2.0** cable. Plug in. Module stays in `USBDrv = GENERIC`. (2026-09-27: enumerates as `Roland TD-07`, vendor 0x0582. Module must be powered on to appear.)
- [x] `npm run dev`, open in Chrome, allow MIDI, confirm the Roland V-Drums preset auto-loads and every pad shows in the Pad Setup monitor without "(ignored)". (2026-09-27: port name `TD-07`, preset auto-loaded, every zone verified, skew ≤ 1 ms, 0 fallbacks. Findings in docs/research.md §1a.)
- [x] Settings → Run calibration. (2026-09-27: first two runs were on a JBL PartyBox over Bluetooth, Chrome reported 248 ms output latency, hits 43–58 ms late. Switched to MacBook speakers: output latency 24 ms, hits 15–40 ms *early*, offset +40 ms. Then Mac → TD-07 AUDIO over Bluetooth: 288 ms. Finally **3.5 mm from the Mac headphone jack into MIX IN**: output latency 16 ms, calibration −3 ms over 12/12 hits, input offset +3 ms. That is the rig.)
- [x] `brew install ffmpeg`; `pip install demucs-mlx` (and upstream `demucs` for `--two-stems`). (2026-09-27: ffmpeg 9.0.2, Python 3.12 venv at `.venv` via uv with demucs-mlx 1.4.14, demucs 4.1.0, ADTOF-pytorch, and drum2midi cloned to `tools/drum2midi` with its setup script run. See README → Audio tooling.)
- [ ] Claim the 40 free Melodics lessons Roland bundles with the TD-07 (separate app, technique work on the side).

## Phase 1 — Labon Ko playable

- [x] Drum stem + drumless mix from your own audio. (2026-09-28: purchased iTunes AAC → `demucs-mlx -n htdemucs_ft` took 6 min on the M4 for 5:41; drumless mix = ffmpeg `amix` of bass+other+vocals, no second demucs run needed.)
- [x] Stem → MIDI. (2026-09-28: `adtof` on the stem, 13 s, 3,061 notes; drum2midi needed `pip install audioread` on macOS. Grid verified from the hats: exactly 108.000 BPM, flat to ±9 ms over 143 bars; song bar 1 at 0.511 s, drums enter at bar 9 = 18.289 s. See docs/research.md §4a.)
- [x] Song folder: `scripts/transcription-to-song.py` builds folder + zip from a transcription MIDI (tempo map pinned, chart tick 0 on the song's first downbeat). Imported into the library 2026-09-28. Next: play it, fix the chart by ear in the editor.
- [ ] Practice ladder: 60 % → 80 % → 100 %, loop the hook, then the 2:37 film-edit form end to end.

## Phase 2 — chart pipeline in the repo

- [ ] `scripts/song-from-audio.mjs`: audio in → song folder out (calls demucs-mlx / demucs / drum2midi, writes `song.json` with bpm + offset guess, zips it for drag-and-drop import).
- [ ] **IMPORT MIDI** button in the Studio chart editor (load a `.mid` into the current difficulty), so step 4 above stops needing a hand-made folder.
- [ ] Songsterr scaffold importer: part JSON → expert.mid (respect ToS; user supplies the URL).
- [x] Song map (`src/midi/songMap.ts`): bars on a 16th grid, clustered into patterns (leader clustering, then merging within Jaccard 0.3; three repeats make a pattern). Labon Ko: one groove across 114 of 152 bars, two interludes (71–73, 106–112), 18 one-offs. Groove bars still differ by ~5 notes, mostly toms on the kick's slots — a chart-noise finder for later. Done 2026-09-30.
- [x] Section markers in `song.json` (`sections: [{ bar, name }]`). Proposed from the song map (drums in/out, groove change, fill or crash-on-one after 8 bars): 15 sections for Labon Ko. Practice jumps (Shift+←/→) and loops by section; the bar counter and the grid show the names; Studio SONG tab edits them with AUTO-DETECT. Songs without saved sections get the detected ones. Done 2026-09-30. Labon Ko named from its stems (18 sections: hooks, verses, pre-hooks, three lifts, riff, interlude, breakdown; research §4a) via `transcription-to-song.py --sections`.
- [x] Chart cleanup, step 1: toms on a kick are the kick read twice; `transcription-to-song.py` drops them unless the drum stem (`--drums-stem`) says tom. Labon Ko: 168 of 170 dropped, the 21 toms left are all fills into sections (research §4a). Done 2026-09-30.
- [ ] Chart cleanup, next: ghost-level snares and quiet kicks sitting on other drums' hits, kicks a 16th off the groove's slot, hats missing from 16th runs (research §4a). Each needs the stem per note; real ghost snares also land on kicks.
- [ ] Hindi song ladder seeded from `docs/research.md` §4 (Kabhi Kabhi Aditi 95 → Tum Se Hi 130 → Yaaron 114 → Kya Mujhe Pyaar Hai 118 → Tu Hi Meri Shab Hai 119 → Khuda Jaane 79 → Maeri 83 → Aahatein 141 → Manja 106 in 3/4).

## Phase 3 — TD-07 specifics

- [x] Play screen for a kit: a prototype pitted the highway against a grid, a song map + groove card, and a memory view (grooves hidden, changes shown) on Labon Ko. The grid won — fixed lines, a fixed place for every hit, so the mental model is easy. `GridRenderer` is now the default view; the highway stays one setting (or the practice VIEW button) away. Done 2026-09-30. The grid lays itself out per surface: two bars a line where a bar gets 300 px, else one, and as many lines as keep rows ≥ 22 px (up to four bars in view); the performance video paints it straight into its game column at the video's scale instead of shrinking the screen canvas.

- [x] Highway, miss detection and playhead follow the *heard* audio time (output latency removed via `getOutputTimestamp`), not the raw audio clock. Needed the moment the Mac's audio went to the TD-07 over Bluetooth (280 ms). Done 2026-09-28.
- [x] Stray strokes no longer wreck a run. The judge used to hand an extra stroke (pedal chick, beater bounce, crash edge + bow) the next pending note; the good window (±165 ms at ×1.5) is wider than a 16th at 108 BPM (139 ms), so one chick in a 16th hat run turned the rest into "good, 136 ms early" (100 % → 59 %). Now a stroke belongs to the nearest note on its lane and a double is an overhit, and mapped MIDI hits pass a 60 ms per-voice retrigger filter. Done 2026-09-30.
- [x] Hi-hat pedal (44) is its own voice, `hihatPedal`: the left foot, drawn as a chevron at the hi-hat lane's left edge, judged as its own lane and only in charts that have a foot part (dropped on medium/easy). Pad maps saved earlier move 44 off the closed hat. drum2midi writes 44 for quiet hand hats (190 in Labon Ko, most filling gaps in the 16th run), so `transcription-to-song.py` now folds 44 into 42 unless `--keep-pedal-hats`; Labon Ko regenerated (identical chart otherwise; old zip kept as `audio/songs/labon-ko.before-pedal-fold.zip`). Done 2026-09-30.
- [ ] Read CC#4 in `src/input/midi.ts`: classify half-open hats, expose pedal position to the HUD; calibrate the ~90 closed ceiling per device.
- [ ] Double-kick stats: inter-onset spacing and evenness for consecutive note-36 hits (both beaters share one note).
- [x] Timing & feel on the results screen (`src/game/feel.ts`): median lean and interquartile spread overall, per drum and per section (rushing/dragging ±10 ms against the take), kick against the hands on shared beats, the loosest 4 bars, ghost vs backbeat velocity. Done 2026-10-01.
- [x] Practice log (`src/store/practiceLog.ts`, localStorage, newest 3,000 entries): every loop pass and finished take with its bars, section, speed, hits, lean, spread, kick-vs-hands and ghost ratio. HUD shows the last pass; results chart spread over recent takes and passes. Done 2026-10-01.
- [x] Tempo ladder (Roland's Auto Up/Down): +5 % after a clean pass (≥ 95 % hit, spread ≤ 20 ms), −5 % after > 20 % missed, 50–100 %. Done 2026-10-01.
- [ ] Progress over days: chart a song's spread per day (and per section) from the practice log; feed it to the coach.
- [x] Roland coach modes, part: Quiet Count (`src/game/quiet.ts`; QUIET 4·2 / 4·4 / 8·8 in practice) and Auto Up/Down (the tempo ladder). Done 2026-10-01.
- [ ] Roland coach modes, rest: Time Check (a click-only mode with a running early/late meter), Change Up (switching subdivisions every few bars).

## Phase 4 — coach

- [ ] Claude API over the session log: weekly plan, "you rush the hook by 20 ms", simplified beginner variant of a chart, section-by-section practice order. Small spend; never on the timing-critical path.
- [ ] Generated drills as MIDI (rudiments, genre grooves) that load straight into practice mode.

## Phase 5 — collab video (drums + bass + lead guitar, instrumental)

- [ ] Reference file for the band: 2-bar count-in click + drumless mix at 108 BPM, 44.1 kHz / 24-bit WAV.
- [ ] 2026-09-28: the band went first — a 76 s guitar + bass clip over a quiet guide-drum track, sitting at album 70.82 s (bars 33–66, no drift, their timing within ±7 ms of the album grid). Kit in `audio/collab/labon-ko-bars33-66/` (practice song zip, 2-bar count-in reference WAV, band without guide drums); `scripts/collab-stack.py` builds the 3-up from the TD-07 take + camera. Next: record the drums.
- [ ] Capture: `USBDrv = VENDOR` + Roland driver 1.0.2 → GarageBand audio + MIDI tracks; slate with a clap and a rimshot. Backing track stays out of the USB stream (clean stem).
- [ ] Edit in DaVinci Resolve (free): waveform auto-sync, 3-up grid. Upload unlisted first; expect a T-Series Content ID claim set to Monetize.

## Performance (done 2026-09-28)

- [x] Lag on expert charts traced to Canvas 2D `shadowBlur`: every hit ripple, hit ghost, note glyph, receptor flash and the sunburst outline rasterised a blurred layer per frame on a 3008×1606 canvas. Measured on the M4 with the tab visible, expert chart, 25 s: old build mean 17.6 ms / p95 50 ms / 21 % of frames over 33 ms → after caching static layers and replacing every live blur with pre-rendered halo sprites: mean 8.33 ms / p99 9.3 ms / 0 frames over 12 ms (locked 120 Hz). JS draw time was never the problem (0.5 ms).
- [ ] Optional: the three sunburst gradient fills and the 140-star field are the largest remaining per-frame fills (measured ~1 ms); fine at 120 Hz, revisit only on weaker machines.

## Housekeeping

- [x] DRUMKILLER landing page and its Pages deploy removed; `.github/workflows/ci.yml` runs typecheck + tests + build. Hosting the app (GitHub Pages or elsewhere) is a later decision.
- [ ] `scripts/make-demo-song.mjs`, the bundled demo songs' artist field, `docs/SONG-FORMAT.md`'s title, and header comments in `src/types.ts`, `src/midi/index.ts`, `src/ui/styles.css` still say DRUMKILLER (harmless; attribution).
- Browser storage deliberately keeps upstream's names (IndexedDB `drumkiller`, localStorage `dk.*`) so a library built in DRUMKILLER on the same origin carries over. Rename only with a migration.
