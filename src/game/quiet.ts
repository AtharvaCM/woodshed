import { leanOf, type Lean } from './feel';

/**
 * Quiet Count (after Roland's coach mode): the song plays for `on` bars, then drops out for `off` bars while
 * you keep going, over and over. What it measures is time kept alone: where your hits sat in the quiet bars
 * against the bars with the song, and where you had drifted to by the last quiet bar.
 *
 * Bars are counted as played, not by number, so a cycle runs on across loop wraps: on a four-bar loop, 4·4
 * makes every second pass quiet. A jump (a seek, a bar or section skip) starts the cycle again, loud.
 */
export interface QuietCycle {
  /** Bars with the song. */
  on: number;
  /** Bars without it. */
  off: number;
}

export const QUIET_CYCLES: readonly QuietCycle[] = [
  { on: 4, off: 2 },
  { on: 4, off: 4 },
  { on: 8, off: 8 },
];

export const quietLabel = (c: QuietCycle) => `${c.on}·${c.off}`;

/** Played bar `index` (0 = first bar of the cycle) falls in a quiet stretch. */
export const isQuietIndex = (index: number, c: QuietCycle) => index >= 0 && index % (c.on + c.off) >= c.on;

export interface QuietReport {
  /** Quiet bars in the stretch. */
  bars: number;
  /** Hits in the quiet bars, the last quiet bar alone, and the loud bars just before (null below MIN_HITS). */
  quiet: Lean | null;
  lastBar: Lean | null;
  loud: Lean | null;
  /** Notes judged in the quiet bars and how many were missed. */
  notes: number;
  missed: number;
}

interface Bucket {
  deltas: number[];
  missed: number;
}

/** How many played bars of judged notes to keep: enough for the longest cycle's loud and quiet stretches. */
const KEEP_BARS = 40;

export class QuietCount {
  private index = -1;
  private buckets = new Map<number, Bucket>();

  constructor(readonly cycle: QuietCycle) {}

  /** Played bar index; -1 before the first bar. */
  get bar(): number {
    return this.index;
  }

  get quiet(): boolean {
    return isQuietIndex(this.index, this.cycle);
  }

  /** Quiet state of the played bar `ahead` bars from now. */
  quietAt(ahead: number): boolean {
    return isQuietIndex(this.index + ahead, this.cycle);
  }

  /** On into the next played bar (normal progress or a loop wrap). Returns the change of state, if any. */
  next(): 'quiet' | 'loud' | null {
    const was = this.quiet;
    this.index++;
    for (const k of this.buckets.keys()) if (k < this.index - KEEP_BARS) this.buckets.delete(k);
    return was === this.quiet ? null : this.quiet ? 'quiet' : 'loud';
  }

  /** A jump: the cycle starts again (loud) with the next bar. */
  restart(): void {
    this.index = -1;
    this.buckets.clear();
  }

  /** A judged note from played bar `index` (this bar, or the one before when judged late); `delta` null = missed. */
  record(index: number, delta: number | null): void {
    if (index < 0) return;
    const b = this.buckets.get(index) ?? { deltas: [], missed: 0 };
    if (delta === null) b.missed++;
    else b.deltas.push(delta);
    this.buckets.set(index, b);
  }

  /** The quiet stretch that ended just before played bar `firstLoud`, against the loud bars before it; null when nothing was judged in it. */
  report(firstLoud: number): QuietReport | null {
    const { on, off } = this.cycle;
    const q0 = firstLoud - off;
    if (q0 < 0 || !isQuietIndex(q0, this.cycle) || isQuietIndex(firstLoud, this.cycle)) return null;
    const collect = (from: number, to: number) => {
      const deltas: number[] = [];
      let missed = 0;
      for (let i = from; i <= to; i++) {
        const b = this.buckets.get(i);
        if (b) deltas.push(...b.deltas), (missed += b.missed);
      }
      return { deltas, missed };
    };
    const quiet = collect(q0, firstLoud - 1);
    if (!quiet.deltas.length && !quiet.missed) return null; // nothing was played in it (or a jump wiped it)
    const loud = collect(Math.max(0, q0 - on), q0 - 1);
    return {
      bars: off,
      quiet: leanOf(quiet.deltas),
      lastBar: leanOf(collect(firstLoud - 1, firstLoud - 1).deltas),
      loud: leanOf(loud.deltas),
      notes: quiet.deltas.length + quiet.missed,
      missed: quiet.missed,
    };
  }
}
