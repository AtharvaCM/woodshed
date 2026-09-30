import { describe, expect, it } from 'vitest';
import type { Chart, ChartNote, DrumVoice, TimeSignatureEvent } from '@/types';
import { barStartTicks, buildSongMap, proposeSections } from '@/midi/songMap';

const ppq = 480;
const BAR = ppq * 4;
const S16 = ppq / 4;
type Bar = [DrumVoice, number][]; // [voice, 16th slot]

const hats: Bar = [0, 2, 4, 6, 8, 10, 12, 14].map((s) => ['hihatClosed', s]);
const A: Bar = [...hats, ['kick', 0], ['snare', 4], ['kick', 8], ['snare', 12]];
const B: Bar = [0, 4, 8, 12].map((s): [DrumVoice, number] => ['ride', s]).concat([['kick', 0], ['kick', 6], ['snare', 4], ['snare', 12]]);
const FILL: Bar = [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s < 8 ? 'tomHigh' : 'tomLow', s]);
const REST: Bar = [];
const crash = (bar: Bar): Bar => [...bar, ['crash', 0]];

function chartOf(bars: Bar[], timeSignatures: TimeSignatureEvent[] = [{ tick: 0, numerator: 4, denominator: 4 }]): Chart {
  const notes: ChartNote[] = [];
  bars.forEach((bar, b) => bar.forEach(([voice, slot]) => notes.push({ tick: b * BAR + slot * S16, time: (b * BAR + slot * S16) / ppq / 2, voice, velocity: 0.8 })));
  notes.sort((x, y) => x.tick - y.tick);
  return { ppq, tempoMap: [{ tick: 0, time: 0, bpm: 120 }], timeSignatures, notes, duration: (bars.length * BAR) / ppq / 2 };
}

const repeat = (bar: Bar, n: number): Bar[] => Array.from({ length: n }, () => bar);
const sections = (bars: Bar[]) => proposeSections(buildSongMap(chartOf(bars))).map((s) => `${s.name}@${s.bar}`);

describe('song map', () => {
  it('clusters bars into patterns and leaves one-offs unassigned', () => {
    const map = buildSongMap(chartOf([...repeat(A, 4), FILL, ...repeat(B, 3), crash(A)]));
    expect(map.patterns.map((p) => [p.id, p.bars])).toEqual([['A', [1, 2, 3, 4, 9]], ['B', [6, 7, 8]]]);
    expect(map.bars[4].pattern).toBeNull(); // the fill
    expect(map.bars.map((b) => b.crashOnOne)).toEqual([false, false, false, false, false, false, false, false, true]);
  });

  it('a groove bar with a note added and one dropped still plays the groove', () => {
    const noisy: Bar = [...A.filter(([v, s]) => !(v === 'hihatClosed' && s === 6)), ['tomMid', 3]];
    const map = buildSongMap(chartOf([...repeat(A, 3), noisy]));
    expect(map.bars[3].pattern).toBe('A');
  });

  it('a note a little before the downbeat counts on the next bar\'s one', () => {
    const chart = chartOf(repeat(A, 2));
    chart.notes.push({ tick: BAR - 20, time: 0, voice: 'crash', velocity: 1 });
    chart.notes.sort((x, y) => x.tick - y.tick);
    expect(buildSongMap(chart).bars[1].crashOnOne).toBe(true);
  });

  it('bars follow time-signature changes', () => {
    const chart = chartOf(repeat(A, 3), [{ tick: 0, numerator: 4, denominator: 4 }, { tick: BAR, numerator: 3, denominator: 4 }]);
    expect(barStartTicks(chart, BAR * 2).slice(0, 4)).toEqual([0, BAR, BAR + ppq * 3, BAR + ppq * 6]);
  });
});

describe('proposed sections', () => {
  it('tacet stretches are Intro and Break; the drums coming in or stopping starts a section', () => {
    expect(sections([...repeat(REST, 2), ...repeat(A, 8), REST, ...repeat(A, 8)])).toEqual(['Intro@1', 'A1@3', 'Break@11', 'A2@12']);
  });

  it('a new groove starts a section, and the fill before it stays with the old one', () => {
    expect(sections([...repeat(A, 7), FILL, ...repeat(B, 8)])).toEqual(['A1@1', 'B1@9']);
  });

  it('a fill every four bars does not chop a section; one after eight bars ends it', () => {
    const phrase = [...repeat(A, 3), FILL];
    expect(sections([...phrase, ...phrase, ...phrase, ...phrase])).toEqual(['A1@1', 'A2@9']);
  });

  it('a crash on the one starts a section once the current one has eight bars', () => {
    expect(sections([crash(A), ...repeat(A, 3), crash(A), ...repeat(A, 3), crash(A), ...repeat(A, 7)])).toEqual(['A1@1', 'A2@9']);
  });

  it('a pattern that only ever comes as a single bar is a fill, not a groove', () => {
    const phrase = [...repeat(A, 7), B];
    expect(sections([...phrase, ...phrase, ...phrase])).toEqual(['A1@1', 'A2@9', 'A3@17']);
  });

  it('a short stretch joins the section before it', () => {
    expect(sections([...repeat(A, 8), ...repeat(B, 2), ...repeat(A, 8)])).toEqual(['A1@1', 'A2@11']);
  });

  it('an empty chart has no sections', () => {
    expect(proposeSections(buildSongMap(chartOf([])))).toEqual([]);
  });
});
