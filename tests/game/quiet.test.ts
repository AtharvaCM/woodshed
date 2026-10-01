import { describe, expect, it } from 'vitest';
import { QuietCount, isQuietIndex } from '@/game/quiet';

const cycle = { on: 4, off: 2 };

/** Play `bars` bars, each with 10 hits at `errMs(bar)` (±1 ms jitter). */
function play(q: QuietCount, bars: number, errMs: (i: number) => number, onChange?: (c: 'quiet' | 'loud', i: number) => void) {
  for (let n = 0; n < bars; n++) {
    const c = q.next();
    if (c && onChange) onChange(c, q.bar);
    for (let k = 0; k < 10; k++) q.record(q.bar, (errMs(q.bar) + (k % 2 ? 1 : -1)) / 1000);
  }
}

describe('Quiet Count', () => {
  it('cycles loud and quiet bars as played', () => {
    expect(Array.from({ length: 12 }, (_, i) => isQuietIndex(i, cycle))).toEqual([false, false, false, false, true, true, false, false, false, false, true, true]);
    expect(isQuietIndex(-1, cycle)).toBe(false);
  });

  it('reports the quiet stretch against the loud bars before it, and where it ended', () => {
    const q = new QuietCount(cycle);
    const changes: [string, number][] = [];
    // with the song: on time; alone: 10 ms ahead, then 30 ms ahead in the last quiet bar
    play(q, 7, (i) => (i === 4 ? -10 : i === 5 ? -30 : 0), (c, i) => changes.push([c, i]));
    expect(changes).toEqual([['quiet', 4], ['loud', 6]]);
    const r = q.report(6)!;
    expect(r).toMatchObject({ bars: 2, notes: 20, missed: 0 });
    expect(Math.round(r.loud!.lean * 1000)).toBe(0);
    expect(Math.round(r.quiet!.lean * 1000)).toBe(-20);
    expect(Math.round(r.lastBar!.lean * 1000)).toBe(-30);
  });

  it('counts misses in the quiet bars, late ones included', () => {
    const q = new QuietCount(cycle);
    play(q, 6, () => 0);
    q.next(); // first loud bar
    q.record(5, null); // the last quiet note, judged missed after the bar line
    expect(q.report(6)).toMatchObject({ notes: 21, missed: 1 });
  });

  it('a jump restarts the cycle loud', () => {
    const q = new QuietCount(cycle);
    play(q, 5, () => 0);
    expect(q.quiet).toBe(true);
    q.restart();
    q.next();
    expect([q.bar, q.quiet]).toEqual([0, false]);
    expect(q.report(6)).toBeNull();
  });

  it('only a real quiet-to-loud bar has a report', () => {
    const q = new QuietCount(cycle);
    play(q, 8, () => 0);
    expect(q.report(5)).toBeNull(); // bar 5 is quiet
    expect(q.report(3)).toBeNull(); // nothing quiet before it
  });
});
