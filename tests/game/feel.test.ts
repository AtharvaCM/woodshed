import { describe, expect, it } from 'vitest';
import { MIN_HITS, analyseFeel, leanOf, type FeelHit } from '@/game/feel';
import type { DrumVoice } from '@/types';

const BAR = 2; // seconds per bar
const starts = Array.from({ length: 21 }, (_, i) => i * BAR); // bars 1..20
const S16 = BAR / 16;
const PPQ16 = 120; // ticks per 16th

/** One hit on a 16th of a bar, with a timing error in ms. */
function hit(bar: number, slot: number, voice: DrumVoice, errMs: number, chartVelocity = 0.8, velocity?: number): FeelHit {
  return { voice, time: (bar - 1) * BAR + slot * S16, tick: ((bar - 1) * 16 + slot) * PPQ16, delta: errMs / 1000, chartVelocity, velocity };
}

/** A bar of the groove: 8th hats, kick on 1 and 3, snare on 2 and 4, each drum with its own lean. */
function groove(bar: number, lean: Partial<Record<DrumVoice, number>> = {}, jitter = 0): FeelHit[] {
  const j = (i: number) => (i % 2 ? jitter : -jitter);
  return [
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => hit(bar, s, 'hihatClosed', (lean.hihatClosed ?? 0) + j(i))),
    hit(bar, 0, 'kick', (lean.kick ?? 0) + j(1)),
    hit(bar, 8, 'kick', (lean.kick ?? 0) + j(2)),
    hit(bar, 4, 'snare', (lean.snare ?? 0) + j(3), 0.9, 0.85),
    hit(bar, 12, 'snare', (lean.snare ?? 0) + j(4), 0.9, 0.85),
  ];
}

describe('feel', () => {
  it('lean is the median and spread the interquartile range; too few hits say nothing', () => {
    expect(leanOf([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.5])).toEqual({ count: 8, lean: expect.closeTo(0.045, 6), spread: expect.closeTo(0.035, 6) });
    expect(leanOf(Array(MIN_HITS - 1).fill(0))).toBeNull();
  });

  it('reads each drum, and the kick against the hands on shared beats', () => {
    const hits = Array.from({ length: 8 }, (_, i) => groove(i + 1, { kick: 15, hihatClosed: -10, snare: -5 })).flat();
    const f = analyseFeel(hits, starts, [], 8);
    const byDrum = Object.fromEntries(f.byDrum.map((d) => [d.group, Math.round(d.lean * 1000)]));
    expect(byDrum).toEqual({ kick: 15, snare: -5, hats: -10 });
    expect(f.kickVsHands).toEqual({ count: 16, gap: expect.closeTo(0.025, 6) }); // kick 25 ms after the hats on 1 and 3
  });

  it('finds the section that rushes and the loosest four bars', () => {
    const hits = [
      ...Array.from({ length: 8 }, (_, i) => groove(i + 1, {}, 3)).flat(),
      ...Array.from({ length: 4 }, (_, i) => groove(i + 9, { kick: -20, hihatClosed: -20, snare: -20 }, 3)).flat(), // the hook rushes
      ...Array.from({ length: 4 }, (_, i) => groove(i + 13, {}, 3)).flat(),
      ...Array.from({ length: 4 }, (_, i) => groove(i + 17, {}, 25)).flat(), // and the outro gets loose
    ];
    const f = analyseFeel(hits, starts, [{ bar: 1, name: 'Verse' }, { bar: 9, name: 'Hook' }, { bar: 13, name: 'Verse 2' }, { bar: 17, name: 'Outro' }], 20);
    expect(f.bySection.map((s) => [s.name, s.first, s.last, Math.round(s.lean * 1000)])).toEqual([['Verse', 1, 8, 0], ['Hook', 9, 12, -20], ['Verse 2', 13, 16, 0], ['Outro', 17, 20, 0]]);
    expect(f.loosest).toMatchObject({ first: 17, last: 20 });
    expect(f.loosest!.spread).toBeGreaterThan(0.04);
  });

  it('compares played ghost notes with backbeats, only with pad velocities', () => {
    const ghosts = Array.from({ length: 6 }, (_, i) => hit(i + 1, 3, 'snare', 0, 0.12, 0.25));
    const backbeats = Array.from({ length: 6 }, (_, i) => hit(i + 1, 4, 'snare', 0, 0.92, 0.8));
    expect(analyseFeel([...ghosts, ...backbeats], starts, [], 8).dynamics).toEqual({ ghosts: 6, backbeats: 6, ghost: 0.25, backbeat: 0.8 });
    const keyboard = [...ghosts, ...backbeats].map((h) => ({ ...h, velocity: undefined }));
    expect(analyseFeel(keyboard, starts, [], 8).dynamics).toBeNull();
  });

  it('an empty take has no feel', () => {
    expect(analyseFeel([], starts, [], 8)).toEqual({ all: null, byDrum: [], kickVsHands: null, bySection: [], loosest: null, dynamics: null });
  });
});
