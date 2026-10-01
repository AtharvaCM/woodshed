import { describe, expect, it } from 'vitest';
import { CLEAN_SPREAD, LADDER_FLOOR, ladderStep } from '@/game/ladder';

describe('tempo ladder', () => {
  it('a clean pass steps up 5 %, to full speed at most', () => {
    expect(ladderStep(0.8, { notes: 100, missed: 3, spread: 0.015 })).toMatchObject({ rate: 0.85, move: 'up' });
    expect(ladderStep(0.95, { notes: 100, missed: 0, spread: 0.01 })).toMatchObject({ rate: 1, move: 'up' });
    expect(ladderStep(1, { notes: 100, missed: 0, spread: 0.01 })).toMatchObject({ rate: 1, move: 'top' });
  });

  it('hitting everything while scattered is not clean', () => {
    const step = ladderStep(0.8, { notes: 100, missed: 0, spread: CLEAN_SPREAD + 0.005 });
    expect(step).toMatchObject({ rate: 0.8, move: 'hold' });
    expect(step.why).toContain('spread 25 ms');
  });

  it('a pass that falls apart steps down, never below the floor', () => {
    expect(ladderStep(0.8, { notes: 100, missed: 25, spread: 0.03 })).toMatchObject({ rate: 0.75, move: 'down' });
    expect(ladderStep(LADDER_FLOOR, { notes: 100, missed: 50, spread: 0.03 })).toMatchObject({ rate: LADDER_FLOOR, move: 'hold' });
  });

  it('too few notes hold', () => {
    expect(ladderStep(0.8, { notes: 5, missed: 0, spread: null })).toMatchObject({ rate: 0.8, move: 'hold' });
  });
});
