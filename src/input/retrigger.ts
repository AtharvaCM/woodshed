import type { DrumVoice } from '@/types';

/**
 * A second MIDI hit on the same drum sooner than this after the last accepted one is the pad or the beater, not
 * a new stroke: on the TD-07 a crash edge stroke sends 55 and 49 about 50 ms apart, and a kick beater bounce
 * arrives 40–60 ms after the stroke (docs/research.md §1a). Real doubles are slower: a 32nd at 108 BPM is 69 ms.
 */
export const RETRIGGER_MS = 60;

/**
 * Drops a pad's double triggers, per drum voice. Measured from the last accepted hit, so a fast roll thins
 * out instead of vanishing after its first stroke. Pure logic (times in ms) so it can be tested.
 */
export class RetriggerFilter {
  private last = new Map<DrumVoice, number>();

  /** True for a new stroke; false when the same stroke has triggered again. */
  accept(voice: DrumVoice, at: number): boolean {
    const prev = this.last.get(voice);
    if (prev !== undefined && Math.abs(at - prev) < RETRIGGER_MS) return false;
    this.last.set(voice, at);
    return true;
  }
}
