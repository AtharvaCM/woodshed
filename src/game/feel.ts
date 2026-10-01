import type { DrumVoice, SongSection } from '@/types';
import { barAt } from './bars';

/**
 * Timing and feel of a take, the way a drum teacher reads it rather than a score: where you sit against the
 * beat and how steady you are (median and interquartile range of your timing error, so a few flubs don't
 * swamp it), per drum, per section, the loosest four bars, the kick against the hands on beats they share,
 * and how far your ghost notes sit below your backbeats. Pure: times in seconds, velocities 0..1.
 */

export interface FeelHit {
  voice: DrumVoice;
  /** Chart time of the note (s). */
  time: number;
  /** MIDI tick of the note: notes on the same tick were meant to land together. */
  tick: number;
  /** Signed timing error (s), hit − note: negative = ahead of the beat. */
  delta: number;
  /** Velocity the chart asks for (0..1). */
  chartVelocity: number;
  /** Velocity played (0..1); absent from the keyboard, which has no dynamics. */
  velocity?: number;
}

export type DrumGroup = 'kick' | 'snare' | 'hats' | 'toms' | 'cymbals';

export const DRUM_GROUPS: readonly DrumGroup[] = ['kick', 'snare', 'hats', 'toms', 'cymbals'];

export const GROUP_OF: Record<DrumVoice, DrumGroup> = {
  kick: 'kick',
  snare: 'snare',
  hihatClosed: 'hats',
  hihatOpen: 'hats',
  hihatPedal: 'hats',
  tomHigh: 'toms',
  tomMid: 'toms',
  tomLow: 'toms',
  ride: 'cymbals',
  crash: 'cymbals',
};

/** Where a set of hits sits: median timing error and the interquartile range around it (seconds). */
export interface Lean {
  count: number;
  /** Median signed error: negative = ahead (rushing), positive = behind (dragging). */
  lean: number;
  /** Interquartile range: how wide the middle half of the hits spreads. Smaller = steadier. */
  spread: number;
}

export interface Feel {
  all: Lean | null;
  byDrum: (Lean & { group: DrumGroup })[];
  /** Kick against the hands on beats they share: median of (kick error − hands' error). Positive = kick after. */
  kickVsHands: { count: number; gap: number } | null;
  bySection: (Lean & { name: string; first: number; last: number })[];
  /** The four bars with the widest spread. */
  loosest: (Lean & { first: number; last: number }) | null;
  /** Median played velocity of the snare's ghost notes and backbeats (as charted). */
  dynamics: { ghosts: number; backbeats: number; ghost: number; backbeat: number } | null;
}

/** Fewer hits than this say nothing about a lean or a spread. */
export const MIN_HITS = 8;
/** Fewer than this many ghost notes or backbeats say nothing about dynamics. */
export const MIN_DYNAMICS = 4;
/** Charted snare velocity below this is a ghost note; at or above BACKBEAT a backbeat. */
export const GHOST = 0.3;
export const BACKBEAT = 0.7;
const LOOSE_BARS = 4;

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const median = (xs: readonly number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

/** Median and interquartile range, or null below MIN_HITS. */
export function leanOf(deltas: readonly number[]): Lean | null {
  if (deltas.length < MIN_HITS) return null;
  const s = [...deltas].sort((a, b) => a - b);
  return { count: s.length, lean: quantile(s, 0.5), spread: quantile(s, 0.75) - quantile(s, 0.25) };
}

/**
 * @param starts   bar start times (chart s), bar n at starts[n − 1]
 * @param sections named sections (sorted by bar); bars past `lastBar` are ignored
 */
export function analyseFeel(hits: readonly FeelHit[], starts: readonly number[], sections: readonly SongSection[], lastBar: number): Feel {
  const all = leanOf(hits.map((h) => h.delta));

  const byDrum = DRUM_GROUPS.flatMap((group) => {
    const l = leanOf(hits.filter((h) => GROUP_OF[h.voice] === group).map((h) => h.delta));
    return l ? [{ group, ...l }] : [];
  });

  const byTick = new Map<number, FeelHit[]>();
  for (const h of hits) byTick.set(h.tick, [...(byTick.get(h.tick) ?? []), h]);
  const gaps: number[] = [];
  for (const chord of byTick.values()) {
    const kick = chord.find((h) => h.voice === 'kick');
    const hands = chord.filter((h) => ['snare', 'hats', 'cymbals'].includes(GROUP_OF[h.voice]) && h.voice !== 'hihatPedal');
    if (kick && hands.length) gaps.push(kick.delta - median(hands.map((h) => h.delta)));
  }
  const kickVsHands = gaps.length >= MIN_HITS ? { count: gaps.length, gap: median(gaps) } : null;

  const barOf = hits.map((h) => barAt(h.time, starts));
  const inBars = (first: number, last: number) => hits.filter((_, i) => barOf[i] >= first && barOf[i] <= last).map((h) => h.delta);

  const spans = sections.filter((s) => s.bar <= lastBar);
  const bySection = spans.flatMap((s, i) => {
    const last = Math.min(lastBar, (spans[i + 1]?.bar ?? lastBar + 1) - 1);
    const l = leanOf(inBars(s.bar, last));
    return l ? [{ name: s.name, first: s.bar, last, ...l }] : [];
  });

  // Widest spread wins; on a tie (within 1 ms) the window that scatters more on average, so four loose bars
  // beat three loose bars and a tight one. Only windows inside the bars actually played: a loop pass, or a
  // take ended early, must not name bars that were never reached.
  let loosest: Feel['loosest'] = null;
  let loosestScatter = 0;
  const played = barOf.filter((b) => b >= 1 && b <= lastBar);
  const fromBar = played.length ? Math.min(...played) : 1;
  const toBar = played.length ? Math.max(...played) : 0;
  for (let first = fromBar; first + LOOSE_BARS - 1 <= toBar; first++) {
    const deltas = inBars(first, first + LOOSE_BARS - 1);
    const l = leanOf(deltas);
    if (!l) continue;
    const scatter = deltas.reduce((sum, d) => sum + Math.abs(d - l.lean), 0) / deltas.length;
    const wider = !loosest || l.spread > loosest.spread + 0.001 || (Math.abs(l.spread - loosest.spread) <= 0.001 && scatter > loosestScatter + 1e-9);
    if (wider) {
      loosest = { first, last: first + LOOSE_BARS - 1, ...l };
      loosestScatter = scatter;
    }
  }

  const snares = hits.filter((h) => h.voice === 'snare' && h.velocity !== undefined);
  const ghostV = snares.filter((h) => h.chartVelocity < GHOST).map((h) => h.velocity!);
  const backV = snares.filter((h) => h.chartVelocity >= BACKBEAT).map((h) => h.velocity!);
  const dynamics = ghostV.length >= MIN_DYNAMICS && backV.length >= MIN_DYNAMICS ? { ghosts: ghostV.length, backbeats: backV.length, ghost: median(ghostV), backbeat: median(backV) } : null;

  return { all, byDrum, kickVsHands, bySection, loosest, dynamics };
}
