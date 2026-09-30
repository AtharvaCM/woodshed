/**
 * General MIDI percussion mapping and device presets.
 *
 * Maps GM drum note numbers (channel 10 by convention) to the game's
 * {@link DrumVoice}s, provides canonical export notes, human-readable GM names
 * for the device wizard, and factory presets for common pad controllers.
 */

import type { DrumVoice, PadBinding } from '@/types';
import { DRUM_VOICES } from '@/types';

// ─────────────────────────── Note → voice ───────────────────────────

/**
 * GM percussion note → game voice. Alternates (side stick, clap, china, splash,
 * ride bell, pedal hat …) are folded onto the closest game voice.
 */
const NOTE_TO_VOICE: ReadonlyMap<number, DrumVoice> = new Map<number, DrumVoice>([
  [35, 'kick'], // Acoustic Bass Drum
  [36, 'kick'], // Bass Drum 1
  [37, 'snare'], // Side Stick
  [38, 'snare'], // Acoustic Snare
  [39, 'snare'], // Hand Clap
  [40, 'snare'], // Electric Snare
  [41, 'tomLow'], // Low Floor Tom
  [43, 'tomLow'], // High Floor Tom
  [45, 'tomMid'], // Low Tom
  [47, 'tomMid'], // Low-Mid Tom
  [48, 'tomHigh'], // Hi-Mid Tom
  [50, 'tomHigh'], // High Tom
  [42, 'hihatClosed'], // Closed Hi-Hat
  [44, 'hihatClosed'], // Pedal Hi-Hat
  [46, 'hihatOpen'], // Open Hi-Hat
  // Roland V-Drums hi-hat edge zones — unassigned in GM, sent by the TD-07/17/27 at their factory map.
  [22, 'hihatClosed'], // Closed Hi-Hat edge (Roland)
  [26, 'hihatOpen'], // Open Hi-Hat edge (Roland)
  [51, 'ride'], // Ride Cymbal 1
  [53, 'ride'], // Ride Bell
  [59, 'ride'], // Ride Cymbal 2
  [49, 'crash'], // Crash Cymbal 1
  [52, 'crash'], // Chinese Cymbal
  [55, 'crash'], // Splash Cymbal
  [57, 'crash'], // Crash Cymbal 2
]);

/**
 * Resolve a GM percussion note number to a game voice.
 *
 * @param note MIDI note number (0..127).
 * @returns The voice, or `null` when the note is not a drum sound the game uses.
 */
export function voiceForNote(note: number): DrumVoice | null {
  return NOTE_TO_VOICE.get(note) ?? null;
}

// ─────────────────────────── Voice → note ───────────────────────────

/** Canonical GM note used when exporting each voice. */
export const CANONICAL_NOTE: Readonly<Record<DrumVoice, number>> = {
  kick: 36,
  snare: 38,
  tomLow: 43,
  tomMid: 47,
  tomHigh: 50,
  hihatClosed: 42,
  hihatOpen: 46,
  ride: 51,
  crash: 49,
};

/**
 * Canonical GM export note for a voice (kick 36, snare 38, tomLow 43, tomMid 47,
 * tomHigh 50, hihatClosed 42, hihatOpen 46, ride 51, crash 49).
 */
export function noteForVoice(voice: DrumVoice): number {
  return CANONICAL_NOTE[voice];
}

// ─────────────────────────── GM names ───────────────────────────

/** Standard General MIDI percussion names for notes 35–81, plus the Roland hi-hat edge notes (for the device wizard). */
export const GM_DRUM_NAMES: Record<number, string> = {
  22: 'Closed Hi-Hat Edge (Roland)',
  26: 'Open Hi-Hat Edge (Roland)',
  35: 'Acoustic Bass Drum',
  36: 'Bass Drum 1',
  37: 'Side Stick',
  38: 'Acoustic Snare',
  39: 'Hand Clap',
  40: 'Electric Snare',
  41: 'Low Floor Tom',
  42: 'Closed Hi-Hat',
  43: 'High Floor Tom',
  44: 'Pedal Hi-Hat',
  45: 'Low Tom',
  46: 'Open Hi-Hat',
  47: 'Low-Mid Tom',
  48: 'Hi-Mid Tom',
  49: 'Crash Cymbal 1',
  50: 'High Tom',
  51: 'Ride Cymbal 1',
  52: 'Chinese Cymbal',
  53: 'Ride Bell',
  54: 'Tambourine',
  55: 'Splash Cymbal',
  56: 'Cowbell',
  57: 'Crash Cymbal 2',
  58: 'Vibraslap',
  59: 'Ride Cymbal 2',
  60: 'Hi Bongo',
  61: 'Low Bongo',
  62: 'Mute Hi Conga',
  63: 'Open Hi Conga',
  64: 'Low Conga',
  65: 'High Timbale',
  66: 'Low Timbale',
  67: 'High Agogo',
  68: 'Low Agogo',
  69: 'Cabasa',
  70: 'Maracas',
  71: 'Short Whistle',
  72: 'Long Whistle',
  73: 'Short Guiro',
  74: 'Long Guiro',
  75: 'Claves',
  76: 'Hi Wood Block',
  77: 'Low Wood Block',
  78: 'Mute Cuica',
  79: 'Open Cuica',
  80: 'Mute Triangle',
  81: 'Open Triangle',
};

/**
 * Human-readable label for a note: GM name when known, otherwise `Note N`.
 */
export function gmDrumName(note: number): string {
  return GM_DRUM_NAMES[note] ?? `Note ${note}`;
}

// ─────────────────────────── Device presets ───────────────────────────

/** A factory binding set for a known family of MIDI controllers. */
export interface DevicePreset {
  /** Stable id (`roland-td`, `fgdp`, `mpc`, `gm`). */
  id: string;
  /** Display name. */
  name: string;
  /** Tested against the MIDI input port name. */
  match: RegExp;
  /** Pad bindings for every voice (may be empty arrays for unbound voices). */
  bindings: Record<DrumVoice, PadBinding[]>;
}

/**
 * Build a full `Record<DrumVoice, PadBinding[]>` from a partial note map.
 *
 * @param notes   Voice → note numbers.
 * @param channel MIDI channel for every binding (-1 = any channel).
 */
export function makeBindings(
  notes: Partial<Record<DrumVoice, number[]>>,
  channel = -1,
): Record<DrumVoice, PadBinding[]> {
  const out = {} as Record<DrumVoice, PadBinding[]>;
  for (const voice of DRUM_VOICES) {
    out[voice] = (notes[voice] ?? []).map((note) => ({ note, channel }));
  }
  return out;
}

/**
 * Roland V-Drums modules (TD-07 / TD-17 / TD-27 …) at their factory MIDI note map
 * (Roland KB "TD-07KV: Default MIDI Note Map"). The module chooses the open or closed
 * hi-hat note itself from the pedal position (CC#4), so the open/closed split works
 * without reading controllers. The pedal "chick" (44) counts as a closed hat: struck with a
 * hand hat, the retrigger filter drops one of the two; elsewhere it is an overhit, so unbind it
 * in Pad Setup if foot-chicks get in the way. Tom rims 50/47 exist on TD-17/27 kits and
 * on the TD-07KX/KVX; the DMK/KV toms are single-zone. The ride bell (53) needs a 3-zone
 * ride (KVX). Tom 3 rim (58) is left out because GM calls 58 Vibraslap.
 */
export const ROLAND_TD_PRESET: DevicePreset = {
  id: 'roland-td',
  name: 'Roland V-Drums (TD-07 / TD-17 / TD-27)',
  match: /Roland|\bTD-?\d{1,2}[A-Z]?\b/i, // TD-07, TD-17, TD-27, TD-50X …
  bindings: makeBindings({
    kick: [36],
    snare: [38, 40, 37], // head, rim, cross-stick
    tomHigh: [48, 50], // tom 1 head, rim
    tomMid: [45, 47], // tom 2 head, rim
    tomLow: [43], // tom 3 head
    hihatClosed: [42, 22, 44], // bow, edge, pedal
    hihatOpen: [46, 26], // bow, edge
    ride: [51, 59, 53], // bow, edge, bell
    crash: [49, 55, 57, 52], // crash 1 bow/edge, crash 2 bow/edge
  }),
};

/** Generic General MIDI preset (all GM alternates, any channel). */
export const GM_PRESET: DevicePreset = {
  id: 'gm',
  name: 'General MIDI drums',
  match: /GM|General MIDI/i,
  bindings: makeBindings({
    kick: [36, 35],
    snare: [38, 40, 37, 39],
    tomHigh: [50, 48],
    tomMid: [47, 45],
    tomLow: [43, 41],
    hihatClosed: [42, 44],
    hihatOpen: [46],
    ride: [51, 59, 53],
    crash: [49, 57, 52, 55],
  }),
};

/** Yamaha FGDP-30 / FGDP-50 finger drum pads (default kit sends GM notes). */
export const FGDP_PRESET: DevicePreset = {
  id: 'fgdp',
  name: 'Yamaha FGDP-30 / FGDP-50',
  match: /FGDP/i,
  bindings: makeBindings({
    kick: [36],
    snare: [38],
    tomHigh: [48, 50],
    tomMid: [45, 47],
    tomLow: [41, 43],
    hihatClosed: [42, 44],
    hihatOpen: [46],
    ride: [51, 53],
    crash: [49, 57],
  }),
};

/** Generic 4x4 pad controllers (Akai MPD/MPK/MPC, Launchpad, Maschine, Push) — chromatic pads from 36. */
export const MPC_PRESET: DevicePreset = {
  id: 'mpc',
  name: 'Generic 4x4 pads (MPC / MPD / Launchpad / Maschine / Push)',
  match: /MPD|MPK|MPC|Launchpad|Maschine|Push/i,
  bindings: makeBindings({
    kick: [36],
    snare: [38, 37],
    tomHigh: [48],
    tomMid: [45],
    tomLow: [41],
    hihatClosed: [42],
    hihatOpen: [46],
    ride: [51],
    crash: [49],
  }),
};

/** All factory presets, most specific first. {@link findPreset} falls back to `gm`. */
export const DEVICE_PRESETS: readonly DevicePreset[] = [ROLAND_TD_PRESET, FGDP_PRESET, MPC_PRESET, GM_PRESET];

/**
 * Pick the preset whose `match` pattern matches a MIDI port name.
 * Falls back to the General MIDI preset when nothing matches.
 */
export function findPreset(portName: string): DevicePreset {
  for (const preset of DEVICE_PRESETS) {
    if (preset.match.test(portName)) return preset;
  }
  return GM_PRESET;
}
