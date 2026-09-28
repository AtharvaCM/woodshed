import type { DrumVoice } from '@/types';

/**
 * Menu navigation from the kit, Rock Band style: high tom = previous, mid tom = next,
 * floor tom twice = select, crash twice = back. Pure logic (times in ms) so it can be tested.
 *
 * The pads are also the instrument, so a gesture only counts when it is clearly not playing:
 * - Navigation starts after a pause of QUIET_MS with no hits at all. Any other pad (snare, kick,
 *   hats, ride) means the drummer is playing and switches navigation off until the next pause,
 *   so a groove or a fill around the toms never moves the menu.
 * - Once navigating, tom and crash hits keep working back to back (scrolling a list quickly).
 * - Select and back need a second hit on the same pad MIN_GAP_MS..CONFIRM_MS after the first.
 *   Closer than MIN_GAP_MS is one stroke double-triggering the pad and is ignored.
 */
export type PadAction = 'prev' | 'next' | 'select' | 'back';

export const PAD_NAV_VOICES: Partial<Record<DrumVoice, PadAction>> = {
  tomHigh: 'prev',
  tomMid: 'next',
  tomLow: 'select',
  crash: 'back',
};

export const QUIET_MS = 600;
export const MIN_GAP_MS = 60;
export const CONFIRM_MS = 700;

export type PadGesture =
  | { kind: 'act'; action: PadAction }
  /** First of the two hits select/back need: show "hit it again" feedback. */
  | { kind: 'arm'; action: 'select' | 'back' };

export class PadGestures {
  private lastHitAt = -Infinity;
  private navigating = false;
  private armed: { action: 'select' | 'back'; at: number } | null = null;

  /** Feed every mapped pad hit (any voice); returns what, if anything, it means for the menu. */
  feed(voice: DrumVoice, at: number): PadGesture | null {
    const quiet = at - this.lastHitAt >= QUIET_MS;
    const sinceLast = at - this.lastHitAt;
    this.lastHitAt = at;
    const action = PAD_NAV_VOICES[voice];
    if (!action) {
      this.navigating = false;
      this.armed = null;
      return null;
    }
    if (!quiet && !this.navigating) return null;
    this.navigating = true;
    if (action === 'prev' || action === 'next') {
      this.armed = null;
      return { kind: 'act', action };
    }
    if (this.armed?.action === action) {
      const gap = at - this.armed.at;
      if (gap < MIN_GAP_MS) {
        this.lastHitAt = at - sinceLast; // a double trigger is not a new stroke
        return null;
      }
      if (gap <= CONFIRM_MS) {
        this.armed = null;
        return { kind: 'act', action };
      }
    }
    this.armed = { action, at };
    return { kind: 'arm', action };
  }

  /** Forget any half-finished gesture (e.g. after the screen changed). */
  reset(): void {
    this.armed = null;
  }
}
