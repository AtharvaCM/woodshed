import { describe, expect, it } from 'vitest';
import { BARS_PER_LINE, beatsIn, countLabel, gridRows, lineFirstBar } from '@/game/gridRenderer';
import type { DrumVoice } from '@/types';

const notes = (...voices: DrumVoice[]) => voices.map((voice) => ({ voice }));

describe('grid view', () => {
  it('draws only the rows a chart uses, in notation order', () => {
    expect(gridRows(notes('kick', 'hihatClosed', 'snare', 'crash')).map((r) => r.label)).toEqual(['CR', 'HH', 'SN', 'BD']);
    expect(gridRows(notes('hihatOpen', 'tomLow', 'hihatPedal', 'tomHigh')).map((r) => r.label)).toEqual(['HH', 'T1', 'FT', 'HF']);
  });

  it('gives an empty chart the basic hats, snare and kick rows', () => {
    expect(gridRows([]).map((r) => r.label)).toEqual(['HH', 'SN', 'BD']);
  });

  it('pages two bars a line, and the count-in shows the first line', () => {
    expect(BARS_PER_LINE).toBe(2);
    expect([0, 1, 2, 3, 4, 5, 60, 61].map(lineFirstBar)).toEqual([1, 1, 1, 3, 3, 5, 59, 61]);
  });

  it('counts 16ths as 1 e & a', () => {
    expect([0, 1, 2, 3].map((i) => countLabel(3, i))).toEqual(['3', 'e', '&', 'a']);
  });

  it('finds the beats of one bar, whatever the metre', () => {
    const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((time, i) => ({ time, bar: i % 3 === 0 }));
    expect(beatsIn(beats, 0, 1.5)).toEqual([0, 0.5, 1]); // a 3/4 bar
    expect(beatsIn(beats, 1.5, 3)).toEqual([1.5, 2, 2.5]);
  });
});
