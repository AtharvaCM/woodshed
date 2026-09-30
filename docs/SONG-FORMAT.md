# DRUMKILLER song format

A DRUMKILLER song is just a **folder**. Drop a `song.json`, an audio file and a MIDI chart in it, zip it, and it can be played, shared and imported by anyone. No database, no build step.

```
thunder-road/
├── song.json          ← metadata (required)
├── audio.mp3          ← the drum-less mix (required)
├── audio-drums.mp3    ← optional: the same mix WITH drums (studio reference)
├── expert.mid         ← chart(s): one MIDI file per difficulty (at least one)
├── hard.mid
├── artwork.png        ← optional cover art
└── samples/           ← optional custom drum sounds
    ├── kick.wav
    └── snare.wav
```

File names are up to you — `song.json` points at everything by relative path. Only `song.json` itself has a fixed name.

## song.json

Every field, what it means, and its default when omitted:

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `format` | `1` | no | `1` | Format version. Always `1` for now. |
| `id` | string | no | slug of `title + artist` | Stable identifier used for high scores and the library. Lower-case letters, digits and dashes (anything else is converted). Keep it unchanged once people have scores on the song. |
| `title` | string | **yes** | — | Song title. |
| `artist` | string | no | `"Unknown Artist"` | Artist name. |
| `album` | string | no | — | Album name. |
| `year` | integer | no | — | Release year. |
| `charter` | string | no | — | Who made the chart. |
| `genre` | string | no | — | Free-text genre. |
| `bpm` | number > 0 | **yes** | — | Nominal tempo. Used as the fallback tempo when the chart has no tempo map, as the recorder grid, and for display. |
| `offset` | number | no | `0` | Seconds of audio before chart tick 0. See [Offset](#offset). May be negative. |
| `length` | number > 0 | no | — | Song length in seconds, for display before the audio is decoded. |
| `audio` | path | **yes** | — | The drum-less mix — what the game plays. `mp3`, `wav`, `flac`, `aac`, `m4a` or `ogg` (whatever the browser can decode). |
| `audioWithDrums` | path | no | — | The same mix **with** the drums in it. Never played in the game; the studio's chart editor can switch to it while you program or record, so you can hear the part you are charting. Must start at the same instant as `audio` (same `offset`). |
| `charts` | object | no | `{}` | Map of difficulty → MIDI path. Keys: `easy`, `medium`, `hard`, `expert`. |
| `samples` | object | no | — | Map of drum voice → audio path for custom drum sounds. See [Custom samples](#custom-samples). |
| `sampleGain` | number ≥ 0 | no | `1` | Linear gain applied to this song's drum samples. |
| `artwork` | path | no | — | Cover image: `png`, `jpg`, `webp`, `gif` or `svg`. Square works best. |
| `preview` | `{ start, length }` | no | — | Seconds into the audio to play on the song-select screen. `start` ≥ 0, `length` > 0. |
| `accent` | CSS color | no | — | Theme accent for this song, e.g. `"#ff5a1f"` or `"hsl(20 90% 55%)"`. |
| `sections` | `[{ bar, name }]` | no | detected from the chart | Named parts of the song. See [Sections](#sections). |

Paths are relative to the folder root, use forward slashes, and may not contain `..`. A leading `./` is fine.

### Minimal complete example

```json
{
  "format": 1,
  "id": "thunder-road-the-test-band",
  "title": "Thunder Road",
  "artist": "The Test Band",
  "album": "Live at the Garage",
  "year": 2024,
  "charter": "sam",
  "genre": "Rock",
  "bpm": 128,
  "offset": 0.25,
  "length": 214,
  "audio": "audio.mp3",
  "audioWithDrums": "audio-drums.mp3",
  "charts": {
    "hard": "hard.mid",
    "expert": "expert.mid"
  },
  "samples": {
    "kick": "samples/kick.wav",
    "snare": "samples/snare.wav"
  },
  "sampleGain": 1,
  "artwork": "artwork.png",
  "preview": { "start": 42, "length": 20 },
  "accent": "#ff5a1f",
  "sections": [
    { "bar": 1, "name": "Intro" },
    { "bar": 9, "name": "Verse 1" },
    { "bar": 25, "name": "Hook" }
  ]
}
```

The truly minimal version is just four keys:

```json
{ "title": "Thunder Road", "artist": "The Test Band", "bpm": 128, "audio": "audio.mp3", "charts": { "expert": "expert.mid" } }
```

## Charts (MIDI)

A chart is a standard MIDI file (format 0 or 1). The game reads **note-on events** and maps them to drum voices by note number, following General MIDI drums. Any channel works; channel 10 is conventional. Note-on velocity (1–127) becomes the note's velocity for accents and visuals.

| Voice | GM note numbers |
|---|---|
| Kick | 35, 36 |
| Snare | 37 (side stick), 38, 40 |
| Low tom | 41, 43 |
| Mid tom | 45, 47 |
| High tom | 48, 50 |
| Hi-hat (closed) | 42 (22: Roland edge) |
| Hi-hat (open) | 46 (26: Roland edge) |
| Hi-hat pedal (foot) | 44 |
| Ride | 51, 53 (bell), 59 |
| Crash | 49, 52 (china), 55 (splash), 57 |

44 is the left foot, not a quiet hand hat: a chart with 44s asks for foot chicks, drawn at the left edge of the hi-hat lane and judged only in charts that have them (never on easy or medium). Drum transcribers often write quiet hand hats as 44; `scripts/transcription-to-song.py` folds them into 42.

Notes on other numbers are ignored, so you can leave percussion you don't want charted in the file. Tempo changes and time signatures in the MIDI file are honoured; if the file has no tempo events, `bpm` from `song.json` is used.

Chart time zero is the first tick of the MIDI file. Your DAW exports normally start at bar 1, so a song whose first hit is on beat 1 of bar 3 simply has silence for two bars in the MIDI — that is fine.

### Difficulties

You only need one chart. The game derives the missing difficulties from the **hardest** one you provide: `expert` → `hard` → `medium` → `easy`, progressively thinning ghost notes, hi-hat subdivisions and fills. Ship hand-made charts for whichever difficulties you care about and let the rest be derived; a hand-made chart always wins over a derived one. Difficulties **above** your hardest chart are not offered to players (a song with only `hard.mid` is playable on easy, medium and hard). A MIDI file with no drum notes in it counts as no chart at all.

Recommended naming is `<difficulty>.mid` at the folder root, but any path in `charts` works.

## Offset

The chart and the audio are two separate timelines. `offset` glues them together:

```
audioTime = chartTime + offset
```

* Your audio has 0.25 s of silence before the first beat, and the MIDI starts right on that beat → `"offset": 0.25`.
* The MIDI has a bar of count-in that isn't in the audio → the offset is negative by the length of that bar (at 120 BPM in 4/4, `"offset": -2`).
* Both start at exactly the same instant → `0` (the default).

If notes consistently feel early, increase `offset`; if they feel late, decrease it. Players also have a personal input-offset setting, so aim to get the song itself right rather than compensating for your own latency.

## Custom samples

By default the game plays its built-in kit when you hit a pad. To make a song sound like the record, put the original drum sounds in the folder and list them in `samples`. Any voice you leave out falls back to the built-in kit.

```json
"samples": {
  "kick": "samples/kick.wav",
  "snare": "samples/snare.wav",
  "tomHigh": "samples/tom-hi.wav",
  "tomMid": "samples/tom-mid.wav",
  "tomLow": "samples/tom-lo.wav",
  "hihatClosed": "samples/hh-closed.wav",
  "hihatOpen": "samples/hh-open.wav",
  "ride": "samples/ride.wav",
  "crash": "samples/crash.wav"
}
```

Voice keys are exactly: `kick`, `snare`, `tomHigh`, `tomMid`, `tomLow`, `hihatClosed`, `hihatOpen`, `hihatPedal`, `ride`, `crash`. Samples can be `wav`, `mp3`, `flac`, `aac`, `m4a` or `ogg`; short, trimmed, mono or stereo. Use `sampleGain` to balance the samples against the mix (`0.7` = quieter, `1.4` = louder).

## Sections

`sections` names the parts of the song: each entry starts at `bar` (1-based; bar 1 begins at chart tick 0, as the game counts bars) and runs until the next entry. `bar` is a whole number ≥ 1 and `name` a non-empty string; entries are sorted by bar on load, and a second entry for the same bar is dropped. Practice mode jumps between sections (`Shift+←` / `Shift+→`) and loops the one you are in, the bar counter shows the section name, and the grid view labels the bar where each section starts.

A song without `sections` still gets them: the game folds the hardest chart into bars on a 16th grid, groups bars that play (nearly) the same pattern, and starts a section where the drums come in or stop, where the groove changes, and on the bar after a fill or on a crash on the one once a section has run 8 bars. Those are named after their groove (`A1`, `A2`, `B1`…, plus `Intro` / `Break` for tacet stretches). In the Studio, SONG → Sections → AUTO-DETECT FROM CHART copies them into the song so you can rename them (Verse, Hook…) and save.

## Artwork, preview and accent

* **Artwork** shows in the song list and during play. Square, 512–1024 px is plenty.
* **Preview** picks the snippet that plays when the song is highlighted in the list — usually the chorus. Without it the game previews from the start.
* **Accent** tints the highway and UI for that song. Pick something that reads well on a dark background.

## Zipping and sharing

Zip the folder (right-click → *Compress* on macOS, *Send to → Compressed folder* on Windows). It doesn't matter whether the zip contains the files at its root or nested inside one top-level folder — the game looks for `song.json` and treats its folder as the root. `__MACOSX` and `.DS_Store` litter is ignored.

To play a shared song, **drag the zip onto the game** or use **Import** on the song-select screen (you can also pick the unzipped folder). Imported songs are stored in the browser and appear in the list alongside the bundled ones; an imported song with the same `id` as a bundled one replaces it in the list. Songs you make in the in-game recorder export in exactly this format, so you can share them straight away.

## Checklist

- [ ] `song.json` has `title`, `bpm` and `audio`
- [ ] every path in `song.json` exists in the folder
- [ ] the audio is a drum-less mix (or as close as you can get); a second mix with drums is optional (`audioWithDrums`)
- [ ] at least one chart, ideally `expert`
- [ ] `offset` checked by playing the song once
- [ ] `id` is set and you won't change it later
