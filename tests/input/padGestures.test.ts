import { describe, expect, it } from 'vitest';
import { PadGestures, QUIET_MS, CONFIRM_MS } from '@/input/padGestures';

const act = (action: string) => ({ kind: 'act', action });
const arm = (action: string) => ({ kind: 'arm', action });

describe('PadGestures', () => {
  it('moves on single tom hits and keeps moving back to back', () => {
    const g = new PadGestures();
    expect(g.feed('tomHigh', 1000)).toEqual(act('prev'));
    expect(g.feed('tomMid', 1200)).toEqual(act('next'));
    expect(g.feed('tomMid', 1350)).toEqual(act('next'));
  });

  it('needs two floor-tom hits to select and two crash hits to go back', () => {
    const g = new PadGestures();
    expect(g.feed('tomLow', 1000)).toEqual(arm('select'));
    expect(g.feed('tomLow', 1300)).toEqual(act('select'));
    expect(g.feed('crash', 3000)).toEqual(arm('back'));
    expect(g.feed('crash', 3400)).toEqual(act('back'));
  });

  it('re-arms instead of confirming when the second hit is too late', () => {
    const g = new PadGestures();
    g.feed('tomLow', 1000);
    expect(g.feed('tomLow', 1000 + CONFIRM_MS + 50)).toEqual(arm('select'));
  });

  it('ignores a double trigger of one stroke', () => {
    const g = new PadGestures();
    g.feed('tomLow', 1000);
    expect(g.feed('tomLow', 1020)).toBeNull();
    expect(g.feed('tomLow', 1300)).toEqual(act('select'));
  });

  it('a different nav pad cancels a half-finished select', () => {
    const g = new PadGestures();
    g.feed('tomLow', 1000);
    expect(g.feed('crash', 1200)).toEqual(arm('back'));
    expect(g.feed('tomLow', 1400)).toEqual(arm('select'));
  });

  it('does nothing while the drummer is playing', () => {
    const g = new PadGestures();
    // a groove, then a fill around the toms ending on a crash
    let t = 1000;
    for (const v of ['kick', 'hihatClosed', 'snare', 'hihatClosed', 'tomHigh', 'tomMid', 'tomLow', 'tomLow', 'crash', 'crash'] as const) {
      expect(g.feed(v, t)).toBeNull();
      t += 150;
    }
    // after a pause the toms navigate again
    expect(g.feed('tomMid', t + QUIET_MS)).toEqual(act('next'));
  });

  it('any other pad ends navigation until the next pause', () => {
    const g = new PadGestures();
    expect(g.feed('tomMid', 1000)).toEqual(act('next'));
    expect(g.feed('snare', 1200)).toBeNull();
    expect(g.feed('tomMid', 1400)).toBeNull();
    expect(g.feed('tomMid', 1400 + QUIET_MS)).toEqual(act('next'));
  });
});
