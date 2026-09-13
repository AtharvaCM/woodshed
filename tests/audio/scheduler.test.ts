import { describe, expect, it } from 'vitest';
import { createWindowState, nextWindow, resetWindow } from '@/audio/scheduler';

describe('nextWindow', () => {
  it('returns nothing while stopped', () => {
    const s = createWindowState();
    expect(nextWindow(s, false, 0, 0, 0)).toBeNull();
    expect(nextWindow(s, false, 0, 0, 0)).toBeNull();
  });

  it('starts at the segment start on the first playing tick, then advances contiguously', () => {
    const s = createWindowState();
    const w1 = nextWindow(s, true, 1, 0, 0.12)!;
    expect(w1).toEqual({ from: 0, to: 0.12, reset: true });
    const w2 = nextWindow(s, true, 1, 0, 0.145)!;
    expect(w2).toEqual({ from: 0.12, to: 0.145, reset: false });
    // Horizon not advanced (timer jitter) → nothing.
    expect(nextWindow(s, true, 1, 0, 0.145)).toBeNull();
  });

  it('resets on generation change (seek / rate change) and after pause', () => {
    const s = createWindowState();
    nextWindow(s, true, 1, 0, 0.1);
    nextWindow(s, true, 1, 0, 0.2);
    // Seek backwards to 0.05 (generation bump).
    const w = nextWindow(s, true, 2, 0.05, 0.16)!;
    expect(w.reset).toBe(true);
    expect(w.from).toBe(0.05);
    expect(w.to).toBe(0.16);
    // Pause: one reset notification, then silence.
    expect(nextWindow(s, false, 3, 0, 0)).toEqual({ from: 0, to: 0, reset: true });
    expect(nextWindow(s, false, 3, 0, 0)).toBeNull();
    // Resume from the paused position — window restarts there.
    const r = nextWindow(s, true, 4, 0.1, 0.21)!;
    expect(r).toEqual({ from: 0.1, to: 0.21, reset: true });
  });

  it('a reset within the same segment rescans from the current position, not the segment start', () => {
    // Recording: the take started at 0, we are 2 s in, and a hit was just inserted (notes replaced).
    const s = createWindowState();
    nextWindow(s, true, 1, 0, 0.1, 0);
    nextWindow(s, true, 1, 0, 2.1, 2.0);
    resetWindow(s);
    const w = nextWindow(s, true, 1, 0, 2.13, 2.03)!;
    expect(w.reset).toBe(true);
    expect(w.from).toBe(2.03); // NOT 0 — everything recorded so far must not fire again
    expect(w.to).toBe(2.13);
    // …and after the reset the window keeps advancing contiguously.
    expect(nextWindow(s, true, 1, 0, 2.16, 2.06)).toEqual({ from: 2.13, to: 2.16, reset: false });
  });

  it('a reset during a count-in (position still before the segment start) waits for the segment start', () => {
    const s = createWindowState();
    nextWindow(s, true, 1, 4, 3.1, 3.0); // playing towards a start at 4 s
    resetWindow(s);
    const w = nextWindow(s, true, 1, 4, 3.6, 3.5)!;
    expect(w.reset).toBe(true);
    expect(w.from).toBe(4);
  });

  it('a fresh state or a generation change still starts at the segment start', () => {
    const fresh = createWindowState();
    expect(nextWindow(fresh, true, 7, 1.5, 1.7, 1.6)!.from).toBe(1.5);
    resetWindow(fresh);
    expect(nextWindow(fresh, true, 8, 0.5, 0.7, 0.6)!.from).toBe(0.5);
  });

  it('supports negative (pre-roll) positions', () => {
    const s = createWindowState();
    const w = nextWindow(s, true, 1, -2, -1.9)!;
    expect(w.from).toBe(-2);
    expect(w.to).toBe(-1.9);
  });
});
