import type { Difficulty, SongSection } from '@/types';
import type { PracticeEntry } from '@/store/practiceLog';
import { analyseFeel, type FeelHit } from './feel';
import { JUDGEMENT_FACTOR, type TrackedNote } from './scoring';

export interface EntryInput {
  songId: string;
  difficulty: Difficulty;
  kind: PracticeEntry['kind'];
  rate: number;
  bars: { first: number; last: number };
  /** The judge's notes; only those inside `bars` that were actually judged count. */
  notes: readonly TrackedNote[];
  starts: readonly number[];
  sections: readonly SongSection[];
  lastBar: number;
  /** Pad velocity (0..1) of the stroke that hit note `index`, when it came from a MIDI pad. */
  velocityOf: (index: number) => number | undefined;
  date?: number;
}

/**
 * One history entry for a take or a loop pass: the judged notes inside its bars, scored and read for timing
 * and feel. Notes skipped by a seek are not judged and do not count. Null when nothing was judged.
 */
export function practiceEntry(i: EntryInput): PracticeEntry | null {
  const start = i.starts[i.bars.first - 1] ?? 0;
  const end = i.starts[i.bars.last] ?? Infinity;
  const judged = i.notes.filter((n) => n.judgement && n.time >= start - 1e-6 && n.time < end - 1e-6);
  if (!judged.length) return null;
  const missed = judged.filter((n) => n.judgement === 'miss').length;
  const accuracy = judged.reduce((sum, n) => sum + JUDGEMENT_FACTOR[n.judgement!], 0) / judged.length;
  const hits: FeelHit[] = judged
    .filter((n) => n.judgement !== 'miss' && n.delta !== undefined)
    .map((n) => ({ voice: n.voice, time: n.time, tick: n.tick, delta: n.delta!, chartVelocity: n.velocity, velocity: i.velocityOf(n.index) }));
  const feel = analyseFeel(hits, i.starts, i.sections, i.lastBar);
  const k = i.sections.findIndex((s) => s.bar === i.bars.first);
  const sectionLast = k >= 0 ? Math.min(i.lastBar, (i.sections[k + 1]?.bar ?? i.lastBar + 1) - 1) : -1;
  return {
    songId: i.songId,
    difficulty: i.difficulty,
    date: i.date ?? Date.now(),
    kind: i.kind,
    rate: i.rate,
    bars: { ...i.bars },
    ...(k >= 0 && sectionLast === i.bars.last ? { section: i.sections[k].name } : {}),
    notes: judged.length,
    missed,
    accuracy,
    all: feel.all,
    kickVsHands: feel.kickVsHands?.gap ?? null,
    ghostRatio: feel.dynamics ? feel.dynamics.ghost / Math.max(1e-6, feel.dynamics.backbeat) : null,
  };
}
