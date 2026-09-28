import { describe, expect, it } from 'vitest';
import { barAt, barSpan, barStarts, barStats, barAccuracy, weakestSpan } from '@/game/bars';

// 4/4 at 120 BPM: a bar every 2 s.
const beats = Array.from({ length: 40 }, (_, i) => ({ time: i * 0.5, bar: i % 4 === 0 }));
const starts = barStarts(beats);

describe('bars', () => {
  it('lists bar downbeats', () => {
    expect(starts.slice(0, 3)).toEqual([0, 2, 4]);
    expect(starts).toHaveLength(10);
  });

  it('finds the bar for a time, 0 during the count-in', () => {
    expect(barAt(-1, starts)).toBe(0);
    expect(barAt(0, starts)).toBe(1);
    expect(barAt(1.99, starts)).toBe(1);
    expect(barAt(2, starts)).toBe(2);
    expect(barAt(99, starts)).toBe(10);
  });

  it('spans bars from downbeat to the next downbeat', () => {
    expect(barSpan(2, 3, starts)).toEqual({ start: 2, end: 6 });
    expect(barSpan(10, 10, starts)).toEqual({ start: 18, end: 20 });
    expect(barSpan(0, 1, starts)).toEqual({ start: 0, end: 2 });
  });

  it('tallies judged notes per bar and ignores skipped ones', () => {
    const stats = barStats(
      [
        { time: 0.1, judgement: 'perfect' },
        { time: 0.6, judgement: 'miss' },
        { time: 2.1, judgement: 'good' },
        { time: 2.6 }, // skipped by a seek
      ],
      starts,
      3,
    );
    expect(stats.map((s) => [s.notes, s.missed])).toEqual([[2, 1], [1, 0], [0, 0]]);
    expect(barAccuracy(stats[0])).toBeCloseTo(0.5);
    expect(barAccuracy(stats[2])).toBeNaN();
  });

  it('finds the weakest stretch, starting on a bar with notes', () => {
    const notes = [
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ time: b * 2 + 0.1, judgement: 'perfect' as const })),
      { time: 10.1, judgement: 'miss' as const },
      { time: 12.1, judgement: 'miss' as const },
    ];
    const stats = barStats(notes, starts, 10);
    expect(weakestSpan(stats, 2)).toMatchObject({ first: 6, last: 7 });
    expect(weakestSpan(barStats([], starts, 10), 4)).toBeNull();
  });
});
