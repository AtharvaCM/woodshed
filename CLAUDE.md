# WOODSHED — notes for contributors

Browser practice room for e-drummers, Roland TD-07KV first. Forked from DRUMKILLER (sam1am, MIT) on 2026-09-27; upstream remote is `upstream`. Vite + TypeScript, no UI framework, Canvas 2D highway, Web MIDI + Web Audio.

## Project context

- Owner's kit: Roland **TD-07KV** (KD-10 kick, PDX-8 snare, PDX-6A single-zone toms, CY-5 hi-hat + control pedal, two CY-8 bow/edge cymbals, no ride bell) with a TAMA Iron Cobra 200 double pedal. Both beaters send note 36.
- Module facts that shape code: GENERIC USB mode = class-compliant MIDI, no driver; hi-hat open/closed is chosen by the module (46 vs 42) from pedal CC#4, which caps near 90 when closed; edge zones send 22/26; the pedal chick sends 44, which is the `hihatPedal` voice (left foot, judged only when a chart has a foot part — transcribers' 44s are folded into 42 by the pipeline); note-offs arrive 0.1 s after every hit at velocity 64; no positional sensing. Full table: `docs/research.md` §1.
- Direction: songs-first. First target song is "Labon Ko" (Pritam/KK): 108 BPM, 4/4, straight feel (not 12/8), A minor, 5:41 album / 2:37 film edit. Hindi songs have no Clone Hero / YARG charts (Chorus Encore: zero) and only AI-generated Songsterr tabs, so charts are generated locally (demucs-mlx → drum2midi/ADTOF → song folder → Studio; `scripts/song-from-audio.py` runs it all, measuring tempo, first downbeat and the transcriber lead itself) — see `docs/ROADMAP.md`.
- Judging (`Judge.hit` in `src/game/scoring.ts`): a stroke belongs to the nearest note on its lane; if that note is already played the stroke is a double (overhit), never a claim on the next note — the good window is wider than a 16th, so claiming shifted whole runs. Mapped MIDI hits pass a 60 ms per-voice retrigger filter (`src/input/retrigger.ts`); the raw stream (wizard, pad monitor) is unfiltered.
- Play views (`PlayRenderer` in `src/game/renderer.ts`): `GridRenderer` (drum-tab lines, default, chosen for the kit on 2026-09-30) and `HighwayRenderer` (inherited). `GameSession.setView` swaps them mid-take; `Settings.playView` remembers the choice. Rows follow drum notation order, only rows the chart uses.
- Sections: `src/midi/songMap.ts` clusters a chart's bars into patterns and proposes sections; `song.json` `sections` (`SongSection[]`, bar 1 = chart tick 0) wins when present (`songSections` in `src/ui/game.ts`).
- Chrome/Edge only (Safari has no Web MIDI). Dev server on localhost is a secure context, fine for `requestMIDIAccess`.
- Audio tooling: `.venv` is a uv-managed Python 3.12 venv (demucs-mlx, demucs, adtof-pytorch); `tools/drum2midi` is an ignored clone with its own editable ADTOF checkout. Always call `.venv/bin/<tool>`; there is no `python` on PATH. Commands in README → Audio tooling.
- Personal repo under `~/technowizard`: any `gh` write must use the AtharvaCM account (see global CLAUDE.md).

## Inherited from DRUMKILLER (still accurate)

- `npm run dev` / `npm test` / `npm run typecheck` / `npm run build` / `npm run e2e` (headless Chrome smoke test against a running dev server) / `npm run demo-song` (regenerates the two bundled demo songs; uses ffmpeg for AAC if present).
- `src/types.ts` is the shared contract — change it deliberately; every module depends on it.
- Time model: `chartTime = transport.position − song.offset`. Input hits are timestamped with `performance.now()` (Web MIDI hardware stamps when sane, see `src/input/midi.ts`) and mapped to the audio clock via `AudioEngine.perfToAudioTime` (uses `getOutputTimestamp`, so no extra output-latency compensation on that path — see `inputLatencyCompensation`).
- Charts are standard MIDI (GM drum notes, channel 10). `deriveDifficulty` is filter-only: easy ⊆ medium ⊆ hard ⊆ expert.
- Device presets live in `src/midi/gm.ts` (`DEVICE_PRESETS`, most specific first; `findPreset` matches the port name). Every preset note must resolve through `voiceForNote` — the gm test enforces it — so a non-GM note (like Roland's 22/26) needs an entry in `NOTE_TO_VOICE` first.
- Song folder format is documented in `docs/SONG-FORMAT.md`; `public/songs/index.json` lists bundled folders.
- Performance video: `src/game/videoRecorder.ts` composites highway canvas + webcam + HUD into an offscreen 16:9 canvas each frame and records it with `MediaRecorder` together with `AudioEngine.captureNode`. `VideoRecorder.finish(card)` appends a results card. The e2e test exercises it with Chrome's fake camera.
- Studio (`src/ui/studio.ts`): SONG and CHART tabs over one in-memory working copy. Recording happens inside the chart editor (`src/ui/chartEditor.ts`). A song may carry a second mix with drums (`meta.audioWithDrums`).
- `window.dk` (App), `window.dkSession` (active GameSession) and `window.dkEditor` (open chart editor) are exposed for debugging and the e2e test.
