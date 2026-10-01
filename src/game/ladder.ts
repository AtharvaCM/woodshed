/**
 * Tempo ladder (Roland's "Auto Up/Down"): after each pass round a practice loop, a clean pass moves the speed
 * up a step, a pass that falls apart moves it down, anything else holds. Clean means nearly every note hit AND
 * the middle half of the hits inside CLEAN_SPREAD — hitting everything while scattered is not ready for faster.
 */
export const LADDER_STEP = 0.05;
export const LADDER_TOP = 1;
export const LADDER_FLOOR = 0.5;
/** A clean pass hits at least this share of its notes… */
export const CLEAN_HIT = 0.95;
/** …with a spread (interquartile range) of at most this many seconds. */
export const CLEAN_SPREAD = 0.02;
/** A pass that misses more than this share steps down. */
export const STRUGGLE_MISS = 0.2;
/** Fewer judged notes than this say nothing about a pass. */
export const LADDER_MIN_NOTES = 8;

export interface PassResult {
  notes: number;
  missed: number;
  /** Interquartile range of the pass's timing (s), or null with too few hits. */
  spread: number | null;
}

export type LadderMove = 'up' | 'down' | 'hold' | 'top';

const snap = (r: number) => Math.round(r * 20) / 20;
const pct = (r: number) => `${Math.round(r * 100)}%`;
const ms = (s: number) => `${Math.round(s * 1000)} ms`;

export function ladderStep(rate: number, pass: PassResult): { rate: number; move: LadderMove; why: string } {
  if (pass.notes < LADDER_MIN_NOTES) return { rate, move: 'hold', why: 'Too few notes in that pass to judge it' };
  const hit = 1 - pass.missed / pass.notes;
  const clean = hit >= CLEAN_HIT && pass.spread !== null && pass.spread <= CLEAN_SPREAD;
  const got = `${pct(hit)} hit${pass.spread !== null ? `, spread ${ms(pass.spread)}` : ''}`;
  if (clean && rate >= LADDER_TOP - 1e-9) return { rate, move: 'top', why: `Clean at full speed (${got})` };
  if (clean) {
    const next = Math.min(LADDER_TOP, snap(rate + LADDER_STEP));
    return { rate: next, move: 'up', why: `Clean pass (${got}): ${pct(rate)} → ${pct(next)}` };
  }
  if (pass.missed / pass.notes > STRUGGLE_MISS && rate > LADDER_FLOOR + 1e-9) {
    const next = Math.max(LADDER_FLOOR, snap(rate - LADDER_STEP));
    return { rate: next, move: 'down', why: `Missed ${pct(pass.missed / pass.notes)}: ${pct(rate)} → ${pct(next)}` };
  }
  return { rate, move: 'hold', why: `Holding at ${pct(rate)}: needs ${pct(CLEAN_HIT)} hit and spread ≤ ${ms(CLEAN_SPREAD)} (${got})` };
}
