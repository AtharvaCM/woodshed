import { describe, expect, it } from 'vitest';
import { BARS_SHOWN, beatsIn, countLabel, gridLayout, gridRows, lineFirstBar } from '@/game/gridRenderer';
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

  it('pages by lines, and the count-in shows the first line', () => {
    expect([0, 1, 2, 3, 4, 5, 60, 61].map((b) => lineFirstBar(b, 2))).toEqual([1, 1, 1, 3, 3, 5, 59, 61]);
    expect([0, 1, 2, 7].map((b) => lineFirstBar(b, 1))).toEqual([1, 1, 2, 7]);
  });

  it('lays out for the surface: two bars a line when there is room, one otherwise', () => {
    const screen = { width: 1440, height: 900, top: 118, bottom: 128, side: 36, scale: 1 };
    const rows = 8; // Labon Ko: CR RD HH T1 SN T2 FT BD
    expect(gridLayout(screen, rows)).toMatchObject({ barsPerLine: 2, lines: 2 });
    // the performance video's game column at 720p and 1080p (the camera takes the left 30 %)
    expect(gridLayout({ width: 896, height: 720, top: 104, bottom: 64, side: 24, scale: 1 }, rows)).toMatchObject({ barsPerLine: 2, lines: 2 });
    expect(gridLayout({ width: 1344, height: 1080, top: 156, bottom: 96, side: 36, scale: 1.5 }, rows)).toMatchObject({ barsPerLine: 2, lines: 2 });
    // a narrow window: one bar a line; as many lines as keep the rows readable
    const narrow = { width: 416, height: 863, top: 118, bottom: 128, side: 36, scale: 1 };
    expect(gridLayout(narrow, 3)).toMatchObject({ barsPerLine: 1, lines: BARS_SHOWN });
    expect(gridLayout(narrow, rows)).toMatchObject({ barsPerLine: 1, lines: 2 });
    // a short window: one line rather than squashed rows
    expect(gridLayout({ ...screen, height: 500 }, rows).lines).toBe(1);
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
