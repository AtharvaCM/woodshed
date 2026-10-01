import { describe, expect, it } from 'vitest';
import { practiceEntry } from '@/game/history';
import type { TrackedNote } from '@/game/scoring';

const BAR = 2;
const starts = Array.from({ length: 11 }, (_, i) => i * BAR); // bars 1..10
const note = (i: number, bar: number, slot: number, judgement: TrackedNote['judgement'], deltaMs = 0): TrackedNote => ({
  index: i, time: (bar - 1) * BAR + slot * (BAR / 16), tick: ((bar - 1) * 16 + slot) * 120, voice: 'hihatClosed', velocity: 0.8,
  state: judgement === 'miss' ? 'missed' : judgement ? 'hit' : 'pending', isolated: false, judgement, delta: judgement && judgement !== 'miss' ? deltaMs / 1000 : undefined,
});

describe('practiceEntry', () => {
  const base = { songId: 's', difficulty: 'expert' as const, kind: 'pass' as const, rate: 0.8, starts, lastBar: 10, velocityOf: () => undefined, date: 5 };

  it('scores only the judged notes inside its bars and names an exact section', () => {
    const notes = [
      note(0, 2, 0, 'perfect'), // before the bars
      ...Array.from({ length: 9 }, (_, i) => note(i + 1, 3 + Math.floor(i / 5), (i % 5) * 2, 'perfect', -10)),
      note(10, 4, 12, 'miss'),
      note(11, 4, 14, undefined), // skipped by a seek: not judged
      note(12, 5, 0, 'perfect'), // after the bars
    ];
    const e = practiceEntry({ ...base, bars: { first: 3, last: 4 }, notes, sections: [{ bar: 1, name: 'Intro' }, { bar: 3, name: 'Verse' }, { bar: 5, name: 'Hook' }] })!;
    expect(e).toMatchObject({ kind: 'pass', bars: { first: 3, last: 4 }, section: 'Verse', notes: 10, missed: 1, date: 5 });
    expect(e.accuracy).toBeCloseTo(0.9, 6);
    expect(e.all).toMatchObject({ count: 9, lean: expect.closeTo(-0.01, 6) });
  });

  it('bars that are not exactly one section have no section name; nothing judged, no entry', () => {
    const notes = Array.from({ length: 10 }, (_, i) => note(i, 3, i, 'great'));
    expect(practiceEntry({ ...base, bars: { first: 3, last: 3 }, notes, sections: [{ bar: 3, name: 'Verse' }, { bar: 5, name: 'Hook' }] })!.section).toBeUndefined();
    expect(practiceEntry({ ...base, bars: { first: 7, last: 8 }, notes, sections: [] })).toBeNull();
  });
});
