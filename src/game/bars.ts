import type { Judgement } from '@/types';
import type { BeatMark } from './renderer';
import { JUDGEMENT_FACTOR } from './scoring';

/**
 * Bar arithmetic for the practice tools and the results screen. Bars are 1-based like a score:
 * bar n starts at `starts[n - 1]` (chart seconds). Chart tick 0 is bar 1's downbeat.
 */

/** Start time (chart seconds) of every bar, from the session's beat marks. */
export function barStarts(beats: readonly BeatMark[]): number[] {
  return beats.filter((b) => b.bar).map((b) => b.time);
}

/** 1-based bar containing `time`; 0 before bar 1 (the count-in). */
export function barAt(time: number, starts: readonly number[]): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= time + 1e-6) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found + 1;
}

/** Chart-second span of bars `first`..`last` inclusive (the end is the next bar's downbeat). */
export function barSpan(first: number, last: number, starts: readonly number[]): { start: number; end: number } {
  const a = Math.max(1, Math.min(first, starts.length));
  const b = Math.max(a, Math.min(last, starts.length));
  const start = starts[a - 1];
  const barLen = starts.length > 1 ? starts[Math.min(b, starts.length - 1)] - starts[Math.min(b, starts.length - 1) - 1] : 2;
  const end = starts[b] ?? starts[b - 1] + barLen;
  return { start, end };
}

/** What the results screen needs from each judged note. `judgement` is unset for notes skipped by a seek. */
export interface BarNote {
  time: number;
  judgement?: Judgement;
}

export interface BarStat {
  bar: number;
  /** Notes judged in this bar (hit or missed; skipped notes don't count). */
  notes: number;
  missed: number;
  /** Sum of judgement factors (perfect 1 … miss 0). accuracy = points / notes. */
  points: number;
}

/** Per-bar tally for bars 1..lastBar. Bars with no judged notes have notes = 0. */
export function barStats(notes: readonly BarNote[], starts: readonly number[], lastBar: number): BarStat[] {
  const out: BarStat[] = [];
  for (let bar = 1; bar <= lastBar; bar++) out.push({ bar, notes: 0, missed: 0, points: 0 });
  for (const n of notes) {
    if (!n.judgement) continue;
    const bar = barAt(n.time, starts);
    const s = out[bar - 1];
    if (!s) continue;
    s.notes++;
    if (n.judgement === 'miss') s.missed++;
    s.points += JUDGEMENT_FACTOR[n.judgement];
  }
  return out;
}

export function barAccuracy(s: BarStat): number {
  return s.notes ? s.points / s.notes : NaN;
}

/**
 * The `length`-bar stretch with the lowest accuracy (earliest on a tie), or null when nothing was judged.
 * Only spans that start on a bar with notes are considered, so a loop never begins in silence.
 */
export function weakestSpan(stats: readonly BarStat[], length = 4): { first: number; last: number; accuracy: number } | null {
  let best: { first: number; last: number; accuracy: number } | null = null;
  for (let i = 0; i < stats.length; i++) {
    if (!stats[i].notes) continue;
    let notes = 0;
    let points = 0;
    const end = Math.min(stats.length, i + length);
    for (let j = i; j < end; j++) {
      notes += stats[j].notes;
      points += stats[j].points;
    }
    const accuracy = points / notes;
    if (!best || accuracy < best.accuracy - 1e-9) best = { first: stats[i].bar, last: stats[end - 1].bar, accuracy };
  }
  return best;
}
