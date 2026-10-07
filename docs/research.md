# Drum coach research notes (verified 2026-09-27)

Goal: free, local, songs-first drum companion for a Roland TD-07 + double pedal on a Mac (M4, macOS 26). First song: Labon Ko (Pritam / KK). Collab video planned.

## 1. TD-07 → Mac

- Port is **USB-B**. Manual demands a **USB 2.0 Hi-Speed** cable; troubleshooting says USB 3.0 cables do not work. Buy USB-C → USB-B (2.0). No cable in box.
- `SETUP > SYSTEM > USBDrv`:
  - **GENERIC** (default) = class-compliant, MIDI only, **no driver**. Chrome Web MIDI sees it immediately.
  - **VENDOR** = MIDI + 2-ch USB audio (44.1 kHz). Needs Roland "TD-07 Driver Ver.1.0.2 for macOS Sonoma 14.x or later" (Apple silicon OK; Roland compat table lists macOS 26 Tahoe = Yes). Power-cycle after changing. Approve driver in System Settings > Privacy & Security.
  - USB audio stream = drums only. MIX IN / Bluetooth backing track is NOT captured. Good for clean stems.
- **Play-along rig that works**: Mac headphone jack → 3.5 mm TRS → TD-07 MIX IN, headphones on the module. Song and kit in one pair of ears, 16 ms output latency, calibration lands at ±3 ms. Keep `Play built-in kit on hit` off; the module makes the sound.
- Bluetooth: A2DP audio is one-way INTO the module (phone → headphones). Mac → TD-07 AUDIO over Bluetooth measured **280 ms output latency** in Chrome (2026-09-28); the app now draws the highway against the heard time (`AudioEngine.heardAudioTime`), so it stays playable, but wired MIX IN is still the right rig. BLE MIDI exists (`[Bluetooth] > BT MIDI ON`, pair via Audio MIDI Setup > MIDI Studio > Configure Bluetooth) but Roland warns of latency. Use USB for scoring.
- No 5-pin MIDI out. One app owns the MIDI port at a time (close Chrome tab before Clone Hero, etc.).
- Firmware: System Program 1.04 (Oct 2024). Update via USB mass storage (hold ENTER at power-on, copy TD07_UPA.BIN). Auto Off default now 20 min; disable for long sessions.
- Sources: Roland KB 38775938193307, 38776094110619, 360051628131; owner's manual; roland.com/global/support/by_product/td-07kv/updates_drivers/

### Default MIDI note map (Roland KB 38775647024155)
| Pad | Note |
|---|---|
| Kick | 36 |
| Snare head / rim / x-stick | 38 / 40 / 37 |
| Tom 1 / 2 / 3 | 48 / 45 / 43 |
| HH open bow / edge | 46 / 26 |
| HH closed bow / edge | 42 / 22 |
| HH pedal | 44 |
| Crash 1 bow / edge | 49 / 55 |
| Crash 2 bow / edge | 57 / 52 |
| Ride bow / edge / bell | 51 / 59 / 53 |

- Hi-hat pedal = CC#4, 0 open → ~90 closed (Roland pedals cap near 90, not 127). CC#4 sent just before hi-hat note-on. Classify open/closed from CC#4, not note number.
- Note-off sent automatically 0.1 s after hit (vel 64); ignore. Choke = poly aftertouch 127/0. Active sensing every 250 ms; ignore. Default channel 10 (TD-17 family doc); listen on all.
- Editable per kit: `KIT EDIT > MIDI NOTE`.
- No positional sensing. Toms on DMK/KV (PDX-6A) have no rim. Ride bell only on KVX (CY-13R) or 3-zone ride on CR2 with CR2Usage=RDB.
- Double pedal: both beaters = note 36. Score doubles by inter-onset time. Raise kick Sens, keep MaskTime low, beaters symmetric on pad. `KIT EDIT > INSTRUMENT > Fixed` (FIXED1-4) if second pedal displaces hi-hat pedal. Twin pedal officially supported on KD-10 (KV/KX/KVX); KD-2 (DMK) unconfirmed.
- Coach mode: Time Check, Quiet Count, Auto Up/Down, Change Up. 100-pt score, no history.
- Kit variants share the same module; only pads differ (DMK: KD-2 kick, CY-5 cymbals; KV: KD-10, CY-8; KX: PDX-12 snare, PDX-8 toms; KVX: VH-10 hi-hat, CY-12C, CY-13R ride).

### 1a. Pad test on the actual TD-07KV (2026-09-27, Chrome + Web MIDI, GENERIC mode)

Port name `TD-07`, channel 10, every hit stamped by CoreMIDI (skew 0 to -1 ms, no fallbacks). Observed notes:

| Stroke | Note(s) seen | Note |
|---|---|---|
| Snare head | 38 | |
| Snare rim, hard | 40 | rimshot |
| Snare rim, light | 40 (not 37) | cross-stick never sent → module `SETUP > PAD > XStickSens` is OFF or threshold too low; both map to snare anyway |
| Hat bow, pedal down | 42 | |
| Hat bow, pedal up | 46 | |
| Hat edge, pedal up | 26 | Roland edge note; needs the 26 → open-hat entry in gm.ts |
| Foot chick | 44 | velocity 16–87. Its own voice (`hihatPedal`) since 2026-09-30 |
| Crash edge | 55 **and** 49, 50 ms apart | one stroke sent edge + bow; both map to crash, but the second reads as an overhit in game. Dropped since 2026-09-30 by the input hub's 60 ms per-voice retrigger filter (`src/input/retrigger.ts`; 40 ms would miss this pair) |
| Kick, either beater | 36 | one stroke occasionally followed by a low-velocity (v18–32) ghost 40–60 ms later = beater bounce. The retrigger filter drops it; on the module, raise `SETUP > PAD > KICK > MaskTime` |
| Double kick, 8 hits | 36 ×8 at ~270 ms spacing | evenness data usable straight from timestamps |

Toms 48/45/43, ride bow 51, ride edge 59, crash bow 49 confirmed earlier in the same session. Ride bell 53 never fires on the KV's CY-8 (expected).

## 2. Browser stack

- Web MIDI: Chrome 43+/Edge 79+/Firefox 108+. **Safari: none, any version.** Chrome 124+ shows a permission prompt for all MIDI access. Secure context only (HTTPS or localhost).
- Chromium on macOS stamps `event.timeStamp` from CoreMIDI hardware time → use it, never `performance.now()` in handler. Bridge to audio clock: `o = ctx.getOutputTimestamp(); hitAudio = o.contextTime + (e.timeStamp - o.performanceTime)/1000`.
- Metronome/playback: lookahead scheduler on AudioContext (25 ms timer / 100 ms window) or Tone.js 15 Transport. `latencyHint: 'interactive'`. Wired headphones only (Bluetooth adds 40-300 ms).
- Libs: webmidi 3.3.1 (Apache-2), VexFlow 5.0.0 (MIT; `addClef('percussion')`, keys like `g/5/x2`, two voices hands up / feet down, Articulation `ah` for open hat), @tonejs/midi 2.0.28, spessasynth_lib 4.3 (AudioWorklet SoundFont synth), smplr 1.0 (DrumMachine sampler), alphaTab 1.8.4 (Guitar Pro drum tabs + sync to MP3/YouTube).
- **Fork candidate: `sam1am/drumkiller`** (MIT, TypeScript/Vite, pushed 2026-09-13, live at sam1am.github.io/drumkiller). Has: Guitar-Hero highway, song folders (song.json + audio + one GM MIDI per difficulty), auto-derived easier charts, Studio (tap-tempo, record from kit + quantize 1/4-1/32 incl. triplets/swing, piano-roll editor, MIDI export), practice mode 50-125 % with A/B loop, latency calibration + AUTO-FIX OFFSET, pad-setup wizard, in-browser video (player cam + highway, MediaRecorder WebM; reorder mime list to prefer MP4 in `src/game/videoRecorder.ts`). Hit windows: easy ±50/90/140 ms × `hitWindowScale` 1.5 default. Modules: src/audio, src/input/midi.ts, src/midi, src/game, src/store. 1-star single-author: own the code after fork.
- Other refs: `audiouniversityonline-sketch/rhythm-trainer` (per-limb consistency grading, NO license, ask before copying), `montulli/GrooveScribe` (GPL-2, notation authoring + MIDI export), `Codewriter90x/HitTheKit` (Unity, MPL-2), YARG (LGPL-3, macOS Universal, e-kit MIDI, Clone Hero chart ecosystem), Clone Hero v1.1.0.6142 (macOS dmg, built-in MIDI mapper, Apple-silicon-native status undocumented).
- Scoring windows used by proven apps: Score Drummer Perfect ≤20 ms / Good ≤50 ms; eDrumTrainer 100 % at <10 ms → 0 % at >60 ms.

## 3. Song → chart pipeline (all free, local)

- Stem separation: `pip install demucs-mlx` → `demucs-mlx -n htdemucs_ft song.wav` (native MLX; M4 Max does 3:15 track in 2.7 s). No `--two-stems` flag → sum bass+other+vocals for drumless, or upstream `pip install demucs` (adefossez fork; archived upstream) → `demucs --two-stems=drums song.mp3` → `no_drums.wav`. Needs ffmpeg (`brew install ffmpeg`). Cymbal bleed is the main artifact.
- Drum-kit sub-separation: python-audio-separator model `MDX23C-DrumSep-aufr33-jarredou` (kick/snare/toms/hh/ride/crash) runs on MPS.
- Transcription (drum stem → MIDI): `xavriley/ADTOF-pytorch` (torch+librosa+pretty_midi; `adtof --audio drums.wav --out x.mid --device cpu`; 5 classes, F≈88.5) or `mykolad/drum2midi` (ADTOF + kit separation + crash/ride/hat heuristics → GM MIDI; Py 3.10-3.13, ffmpeg, MPS implied not documented; `--from-song` runs Demucs first on a full mix, `--no-separate` skips kit separation ~3x faster, CPU-only full run ~15x slower than realtime). Omnizart and Magenta: dead on Apple silicon. Recipe repo: `trak3r/rudiment` (Demucs → ADTOF → MusicXML → MuseScore 4).
- Audio → Clone Hero chart directly: `opria123/octave` (macOS dmg wrapping STRUM; CUDA→MPS→CPU fallback, ~1.5 GB runtime, chart editor; MPS path untested). MIDI → .chart: MIDItoCH-Chart web app.
- Cloud tools not worth it: Moises free caps at 5 min (Labon Ko is 5:41) and ~5 files/month; LALAL free = preview only; BandLab Splitter 2 splits/day.
- Charts for Hindi songs: **Chorus Encore = 0 Bollywood charts** (95k total). Songsterr has broad Hindi drum coverage but mostly AI-generated (`/api/meta/{id}/revisions` → `aiGenerated`). Part data is machine-readable gzip JSON at `dqsljvtekg760.cloudfront.net/{songId}/{revisionId}/{hash}/{partId}.json` (check ToS). Free tier stops playback after 10 bars; Plus ₹119/mo for loop/speed/export.
- MuseScore Studio 4 (`brew install --cask musescore`) for hand-fixing notation.

## 4. Labon Ko (Pritam, KK, Bhool Bhulaiyaa 2007, T-Series)

- **108 BPM, 4/4, straight 8th/16th feel**, key A (minor), 5:41 album / **2:37 film edit** (YouTube XG8XskoJz1I). The "12/8 at 72" reading was refuted: Songsterr's 72 is a page default; its actual part data is 108 BPM, 4/4, 153 bars, zero tuplets.
- Core groove (16th grid): kick on 1, "a" of 1, "&" of 4; snare 2 and 4; closed hat 8ths. Standard syncopated pop-rock (tresillo-ish kick). No double bass. Guitar strum D-UUD-UUD-DU = same 3+3+2.
- Form: Intro (guitar riff) → Hook "Labon ko labon pe" (Am-G-F ×2) → Verse 1 (Am-G-F-G) → Pre-hook → Lift "Tod do khud ko tum" (E-F) → "Baahon mein meri" (G-F) → tag → Hook → flute interlude → Verse 2 → Pre-hook → Lift → tag → Hook/outro.
- Difficulty: beginner → early-intermediate. Real challenges: syncopated kick placement, 5:41 of steady time, verse/hook dynamics, short fills into hooks. Songsterr rates drums 3/5.
- Songsterr tabs: 2680219 (AI, 108 BPM, drum track), 3658553 (AI, dense: 1,867 hits), 4917473 "Labon Ko (Solo)" by DEBRAJ DEY (human, Editor).
- E-kit covers: Subhodeep K Chowdhury on Roland V-Drums (cKViIpuqj3k), Drumbwoyy on Alesis Nitro (Safp4DAeKRM; Reaper + free MT Power Drum Kit 2, self-mixed). Others: d5bh-8zmgXw, 3EQAgx5401M, BNf7dhosWb4, tSymPh-jpeQ. Cajon tutorial in Hindi: 8awxzDk6JOI.
- Rock-cover arrangement refs: Project Rubaab (eL5jwMUAbbc, 5:08), The Raga Projekt (tAHBXqgCMZY, 4:14), Abhishek Music Academy (CCzdSsPEz5o), Khudgharz KK medley "Kya Mujhe Pyar Hai × Tu Hi Meri Shab Hai × Labon Ko" (xrM4afyLXxQ, 61M views). KK died 31 May 2022; 2026 covers are framed as tributes.
- Practice ladder: (1) kick/snare/hat groove at 60 BPM; (2) 80 → 108 with click; (3) crash on section downbeats + one 6-note fill into hooks; (4) full 2:37 edit; (5) full 5:41.

### 4a. Measured from the actual recording (2026-09-28, purchased album version, 341.08 s)

- **Tempo 108.000 BPM exactly**; hi-hat 16ths sit on a constant grid to within ±9 ms across all 143 drum bars. (librosa's beat tracker said 107.67; that was a wrap-around artefact of fitting to an 8th grid.)
- **Song bar 1 downbeat at 0.511 s** (silence; guitar riff enters as a pickup at 2.49 s). **Drums enter at bar 9 = 18.289 s** with a crash.
- **Hats are 16ths**, not 8ths (≈16 per bar, ~1,987 in the song). Songsterr's 8th-note hat was wrong.
- **Kick pattern** (16th slots, 0 = beat 1): 0, 3, 6, 7, 10, 14 → beat 1, "a" of 1, "&" and "a" of 2, "&" of 3, "&" of 4. **Snare** on 2 and 4 (slots 4, 12) with a frequent ghost on the "a" of 1 (slot 3).
- Bass loops Am → G → F → F (4-bar cycle from bar 10). Drums drop out completely for two bars at song bars 21–22 and thin to kick-only at bars 77–80 (interlude).
- **Form, bar by bar** (2026-09-30, from the stems: bass root and chord per half bar, vocal-stem level per bar). The E major chord only ever appears as the first bar of a 6-bar E–Dm–G–G–F–G cycle, which marks the three lifts; verses 2 and 3 are the only Am–F–Dm–G cycles; bars 105–112 are the only bars with no bass.

  | Bars | Section | Evidence |
  |---|---|---|
  | 1–8 | Intro | guitar riff (1–5), then a sung line (6–8); no bass, no drums |
  | 9–22 | Hook 1 | bass and drums in at 9; Am–G–F–F ×3, bar 22 drums tacet |
  | 23–30 | Verse 1 | Am–G–F–F ×2, lead vocal |
  | 31–38 | Pre-hook 1 | Am–G–F–F ×2, crash on 31 |
  | 39–44 | Lift 1 | E–Dm–G–G–F–G |
  | 45–52 | Hook 2 | Am–G–F–G, Am–G–F–F; crash every 4 bars, loudest vocal |
  | 53–60 | Riff | hook chords, no lead vocal until 57 |
  | 61–70 | Interlude | Am vamp with no vocal (61–64), then F–G… under the flute |
  | 71–78 | Verse 2 | Am–F–Dm–G ×2 |
  | 79–86 | Pre-hook 2 | Am–G–F–G ×2, crashes on 79 and 83 |
  | 87–92 | Lift 2 | E–Dm–G–G–F–G |
  | 93–104 | Hook 3 | Am–G–F–G, then Am–G–F–F ×2 |
  | 105–112 | Breakdown | no bass, Am drone under the vocal |
  | 113–117 | Turnaround | Am–G–F–F–F, quieter vocal |
  | 118–125 | Verse 3 | Am–F–Dm–G ×2 |
  | 126–133 | Pre-hook 3 | Am–G–F–G ×2, crashes on 126 and 130 |
  | 134–139 | Lift 3 | E–Dm–G–G–F–G |
  | 140–152 | Hook 4 | Am–G–F–G, then Am–G–F–F ×2 to the end |

  Names are structural (from harmony, vocals and drums), not from the lyrics; rename by ear in Studio if a lyric line reads better. Kept in `audio/labon-ko-sections.json` and written into song.json with `transcription-to-song.py --sections`.
- **Toms on the kick were the kick read twice** (2026-09-30). 170 of drum2midi's 189 tom notes shared a 16th with a kick (63 on beat 1, 64 on the "a" of 1 — the groove's own kicks). In the drum stem those moments are kicks: 90–250 Hz against 40–90 Hz share median 0.38 (lone kicks 0.26, max 0.57; toms in real fills 0.85), only one above 0.6. `transcription-to-song.py` now drops a tom on a kick unless the stem says tom (`--drums-stem`; share ≥ 0.6). (2026-10-07: with notes on the attack instead of 29 ms after it, the share is read 30–130 ms after the hit, past the beater's broadband click: lone kicks max 0.48, fill toms median 0.92, 169 of 170 dropped.) Labon Ko: 168 dropped, 2 kept, 3,326 notes. The 21 toms left are the fills into bar 31 (Pre-hook 1), the interlude (64), into the breakdown (104–105) and the ending (151). Groove bars went from 3.0 to 1.8 stray notes each.
- Noise still in the chart, in groove bars: ghost-level snares (velocity 15, drum2midi's floor) on slots 0, 1, 6 and 15 around the kicks; kicks nudged to slot 13 or 15 where the groove has 14, and quiet kicks (v27) on the backbeat at 12; about two hats a bar missing from the 16th run. Real ghost snares also sit on kicks here (slot 3), so these need the stem per note, not a symbolic rule.
- ADTOF alone gives 5 classes, flat velocity 100, 8 crashes, no open hats, no ride. drum2midi adds those; pending.
- ~~ADTOF onsets lead the real transients by 14–32 ms~~ — **wrong, corrected 2026-10-07.** That figure came from librosa onset-strength peaks, which are spectral-flux frames and peak after the attack. Read on the drum stem's band envelope (where each hit first reaches 10 % of its peak), ADTOF and drum2midi stamp hats 3.6 ms and snare 5.4 ms before the attack (kick 8 ms, but a 40–120 Hz envelope rises late by nature). The grid fit puts bar 1 at 0.506 s from the hits, so 0.510 s with the lead: the 0.539 offset in the library is about 29 ms late, which shows a player who is dead on the record as rushing by that much. Not yet confirmed by ear. Stems from demucs-mlx are sample-aligned with the original (lag 0.2 ms).
- Pipeline timing on the M4 (base): demucs-mlx htdemucs_ft 6 min for 5:41 (much slower than the M4 Max benchmark); adtof 13 s; song folder + zip instant.

### Next Hindi songs (SongBPM-verified unless marked ~)
Kabhi Kabhi Aditi 95 · Tum Se Hi 130 · Yaaron 114 · Aankhon Mein Teri ~118 · Kya Mujhe Pyaar Hai 118 · Rock On!! 113 / Tum Ho Toh 112 · Tu Hi Meri Shab Hai 119 (A minor, same key) · Khuda Jaane 79 (dynamics) · Maeri 83 · Aahatein 141 · But It Rained ~130 · Bandeh 135 · Saadda Haq 97 · Manja 106 in 3/4 (first non-4/4).

## 5. Existing options (reuse, don't rebuild)

- Melodics: native app, TD-07 recognised over USB; **40 free V-Drums lessons** (Roland deal) + 5 min/day free. No Hindi songs. Paid $10.99-14.99/mo.
- EarDrum (Mac, $29.99 lifetime): imports MIDI + Clone Hero charts, USB/BLE MIDI, early/late feedback. Closest to the plan; study it.
- Score Drummer (free core: .mid/.gp import, Perfect ≤20 ms), Drumr (40 rudiments free), Drum Coach (AI, $14.99/mo), Beatlii.
- Drumeo $30/mo or $279/yr; free YouTube + drumlessons.com. Only Indian content: Sarah Thawer "Exploring Indian Grooves".
- Torrins (India): 19 Bollywood drum song lessons, ₹1,199/mo; free YouTube lessons by Darshan Doshi. Tarun Donny (YouTube): "Top 5 Easiest Hindi Songs on Drums", Saiyaara lesson. APD: "5 Common Drum Beats used in Bollywood songs". Jai Row Kavi channel.
- Gap = Hindi charts + adaptive coaching. Not hit-timing UI.

## 6. Collab video

- Capture: VENDOR mode + driver → GarageBand: audio track (input TD-07 1-2) + software-instrument track (MIDI) in one pass. Local Ctrl ON to monitor module sound (no computer latency). Backing track via USB playback or phone → MIX IN/Bluetooth; it stays out of the recording.
- Single 3.5 mm OUTPUT/PHONES jack: either headphones or line-out, not both.
- VST option: MT Power Drum Kit 2 (free, AU, has "Roland TD-07" preset, LIMIT CLOSED = 90) or Steven Slate SSD 5.5 Free. Local Ctrl OFF, buffer 64-128 samples.
- Sync: slate each take (say take number, clap, one rimshot). DaVinci Resolve 21.1 free: Auto Sync Audio > Waveform; grid layout via Inspector Transform; mute camera audio. iMovie only for 2-up.
- Collab recipe: share one reference file (song + 2-bar count-in click), 44.1 kHz/24-bit WAV, wired in-ears, swap stems via Drive.
- Copyright: upload Unlisted first, check Studio > Copyright. Expect T-Series Content ID claim → Monetize (video stays up). Do not dispute. Instagram: live performance Reels permitted; Bollywood audio may still get muted later.
- Budget: $0 beyond a USB 2.0 cable (~$5-10). Audio interface (~$150) only if VST latency or backing-track capture becomes a problem.

## 7. Mac state (scouted 2026-09-27)
Apple M4 · macOS 26 · Chrome ✓ · GarageBand ✓ · Python 3.14 · node 26 · pnpm · brew · pipx · **no ffmpeg, no uv** · TD-07 not yet on USB.
