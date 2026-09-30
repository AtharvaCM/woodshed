import type { DrumVoice, Judgement } from '@/types';
import { barAt, barStarts } from './bars';
import { JUDGE_COLORS, VOICE_COLORS, type BeatMark, type PlayRenderer, type RenderState } from './renderer';
import type { TrackedNote } from './scoring';

/**
 * The grid view: the chart as drum-tab lines, two bars a line, with the next line underneath and a playhead
 * sweeping across. Every drum has a fixed row (notation order: cymbals up, kick down, hat foot under the
 * staff) and every beat a fixed column, so a groove looks the same every time it comes round — the mental
 * model a drummer reads from, where the highway makes you re-read a scrolling tape. Chosen over the highway
 * on the TD-07 in a prototype of four views (2026-09-30).
 */

export interface GridRow {
  label: string;
  voices: readonly DrumVoice[];
}

/** Top to bottom, in drum-notation order. Only rows the chart uses are drawn. */
export const GRID_ROWS: readonly GridRow[] = [
  { label: 'CR', voices: ['crash'] },
  { label: 'RD', voices: ['ride'] },
  { label: 'HH', voices: ['hihatClosed', 'hihatOpen'] },
  { label: 'T1', voices: ['tomHigh'] },
  { label: 'SN', voices: ['snare'] },
  { label: 'T2', voices: ['tomMid'] },
  { label: 'FT', voices: ['tomLow'] },
  { label: 'BD', voices: ['kick'] },
  { label: 'HF', voices: ['hihatPedal'] },
];

/** The rows a chart needs, in order. A chart with no notes still gets hats, snare and kick. */
export function gridRows(notes: readonly { voice: DrumVoice }[]): GridRow[] {
  const used = new Set(notes.map((n) => n.voice));
  const rows = GRID_ROWS.filter((r) => r.voices.some((v) => used.has(v)));
  return rows.length ? rows : GRID_ROWS.filter((r) => ['HH', 'SN', 'BD'].includes(r.label));
}

/** Bars per line. */
export const BARS_PER_LINE = 2;

/** First bar of the line that shows `bar` (1-based). The count-in (bar 0) shows the first line. */
export function lineFirstBar(bar: number): number {
  const b = Math.max(1, bar);
  return b - ((b - 1) % BARS_PER_LINE);
}

/** Counting syllable for the `i`-th 16th of a beat: the beat number, then e, &, a. */
export function countLabel(beat: number, i: number): string {
  return i === 0 ? String(beat) : ['e', '&', 'a'][i - 1];
}

/** Beat times inside [start, end): the columns of one bar. */
export function beatsIn(beats: readonly BeatMark[], start: number, end: number): number[] {
  return beats.filter((b) => b.time >= start - 1e-6 && b.time < end - 1e-6).map((b) => b.time);
}

/** Space the HUD (combo and score above, song info and the practice bar below) keeps for itself. */
const TOP = 118;
const BOTTOM = 128;
const SIDE = 36;
const LABEL_W = 34;
const HEADER_H = 40;
const MAX_ROW_H = 38;
/** The next line is drawn fainter: readable, but clearly not where you are. */
const NEXT_LINE_ALPHA = 0.55;
const CYMBALS = new Set<DrumVoice>(['crash', 'ride', 'hihatClosed', 'hihatOpen', 'hihatPedal']);
const MISS = '#ff3b3b';
const ROW_FLASH_MS = 180;
const MONO = (px: number, weight = 600) => `${weight} ${px}px "JetBrains Mono", monospace`;

interface Stroke {
  voice: DrumVoice;
  time: number;
  judgement: Judgement | 'over';
}

export class GridRenderer implements PlayRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private renderScale = 2;
  private strokes: Stroke[] = [];
  /** performance.now() of the last hit per voice: the row label lights up so you see the pad land. */
  private pulses = new Map<DrumVoice, number>();
  private rowsFor: readonly TrackedNote[] | null = null;
  private rows: GridRow[] = [];
  private startsFor: readonly BeatMark[] | null = null;
  private starts: number[] = [];
  private lastTime = -Infinity;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(this.renderScale, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.floor(rect.width));
    this.h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
  }

  setRenderScale(scale: number): void {
    const s = Math.max(1, Math.min(2, scale));
    if (s === this.renderScale) return;
    this.renderScale = s;
    this.resize();
  }

  // The grid has no motion effects, lanes or visualiser.
  setReducedMotion(): void {}
  setLaneOrder(): void {}
  setAnalyser(): void {}
  hitFlash(): void {}
  hitGhost(): void {}
  streakBurst(): void {}

  drumPulse(voice: DrumVoice): void {
    this.pulses.set(voice, performance.now());
  }

  stroke(voice: DrumVoice, time: number, judgement: Judgement | 'over'): void {
    this.strokes.push({ voice, time, judgement });
  }

  draw(state: RenderState): void {
    const { ctx, w, h } = this;
    // A jump back (practice loop, resume run-up, seek) replays those bars: drop the strokes from the last pass.
    if (state.time < this.lastTime - 0.25) this.strokes = this.strokes.filter((s) => s.time < state.time);
    this.lastTime = state.time;
    if (state.notes !== this.rowsFor) {
      this.rowsFor = state.notes;
      this.rows = gridRows(state.notes);
    }
    if (state.beats !== this.startsFor) {
      this.startsFor = state.beats;
      this.starts = barStarts(state.beats);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07070b';
    ctx.fillRect(0, 0, w, h);
    if (!this.starts.length) return;
    const first = lineFirstBar(barAt(state.time, this.starts));
    const lineH = (h - TOP - BOTTOM) / 2;
    for (let k = 0; k < 2; k++) {
      const bars: number[] = [];
      for (let i = 0; i < BARS_PER_LINE; i++) {
        const bar = first + k * BARS_PER_LINE + i;
        if (bar < this.starts.length) bars.push(bar); // the last start only closes the final bar
      }
      if (bars.length) this.drawLine(state, TOP + k * lineH, lineH - 18, bars, k === 0 ? 1 : NEXT_LINE_ALPHA);
    }
  }

  private drawLine(state: RenderState, y0: number, height: number, bars: number[], alpha: number): void {
    const { ctx, rows } = this;
    const width = this.w - SIDE * 2;
    const barW = (width - LABEL_W) / BARS_PER_LINE;
    const rowH = Math.min(MAX_ROW_H, (height - HEADER_H) / rows.length);
    const top = y0 + HEADER_H;
    const bottom = top + rowH * rows.length;
    const rowY = (r: number) => top + rowH * (r + 0.5);
    const rowOf = (voice: DrumVoice) => rows.findIndex((r) => r.voices.includes(voice));
    const now = performance.now();
    ctx.globalAlpha = alpha;
    rows.forEach((r, i) => {
      const lit = alpha === 1 && r.voices.some((v) => now - (this.pulses.get(v) ?? -Infinity) < ROW_FLASH_MS);
      text(ctx, r.label, SIDE, rowY(i), MONO(11, lit ? 800 : 600), lit ? VOICE_COLORS[r.voices[0]] : 'rgba(255,255,255,.55)');
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.lineWidth = 1;
      line(ctx, SIDE + LABEL_W, rowY(i), SIDE + LABEL_W + barW * bars.length, rowY(i));
    });
    bars.forEach((bar, bi) => {
      const bx = SIDE + LABEL_W + bi * barW;
      const start = this.starts[bar - 1];
      const end = this.starts[bar];
      const xAt = (t: number) => bx + ((t - start) / (end - start)) * barW;
      text(ctx, `BAR ${bar}`, bx, y0 + 2, MONO(11, 700), 'rgba(255,255,255,.7)', 'left', 'top');
      // columns: bar line, beats, and the three 16ths between beats, with the count above
      const beats = beatsIn(state.beats, start, end);
      beats.forEach((bt, b) => {
        const next = beats[b + 1] ?? end;
        for (let i = 0; i < 4; i++) {
          const x = xAt(bt + ((next - bt) * i) / 4);
          ctx.strokeStyle = i ? 'rgba(255,255,255,.06)' : b ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.45)';
          ctx.lineWidth = b === 0 && i === 0 ? 2 : 1;
          line(ctx, x, top, x, bottom);
          text(ctx, countLabel(b + 1, i), x, top - 9, MONO(i ? 10 : 12, i ? 400 : 700), i ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.8)', 'center');
        }
      });
      // notes, where they fall in time (a humanised note sits a little off its column, as played)
      for (let i = lowerBound(state.notes, start - 1e-6); i < state.notes.length && state.notes[i].time < end - 1e-6; i++) {
        const n = state.notes[i];
        const r = rowOf(n.voice);
        if (r < 0) continue;
        const color = n.state === 'hit' && n.judgement ? JUDGE_COLORS[n.judgement] : n.state === 'missed' ? MISS : VOICE_COLORS[n.voice];
        glyph(ctx, n.voice, xAt(n.time), rowY(r), rowH, n.velocity, color, alpha * (n.state === 'missed' ? 0.6 : 1));
      }
      ctx.globalAlpha = alpha;
      // your strokes: a tick where the stick actually landed, in the judgement's colour
      ctx.lineWidth = 2;
      for (const s of this.strokes) {
        if (s.time < start || s.time >= end) continue;
        const r = rowOf(s.voice);
        if (r < 0) continue;
        ctx.strokeStyle = s.judgement === 'over' ? MISS : JUDGE_COLORS[s.judgement];
        line(ctx, xAt(s.time), top + rowH * r + 2, xAt(s.time), top + rowH * (r + 1) - 2);
      }
      if (alpha === 1 && state.time >= start && state.time < end) {
        const x = xAt(state.time);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        line(ctx, x, top - 18, x, bottom + 4);
      }
    });
    ctx.globalAlpha = 1;
  }
}

/** First index with `notes[i].time >= t` (notes are sorted by time). */
function lowerBound(notes: readonly TrackedNote[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left', base: CanvasTextBaseline = 'middle'): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(s, x, y);
}

/**
 * A note: an x for cymbals and hats (circled above when open), a disc for drums. Louder notes are bigger; a
 * ghost note (velocity < 0.3) is a small hollow ring, an accent (> 0.85) gets a second ring.
 */
function glyph(ctx: CanvasRenderingContext2D, voice: DrumVoice, x: number, y: number, rowH: number, velocity: number, color: string, alpha: number): void {
  const ghost = velocity < 0.3;
  const accent = velocity > 0.85;
  const r = Math.min(14, rowH * (ghost ? 0.16 : 0.2 + 0.12 * Math.min(1, velocity)));
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = ghost ? 1.2 : accent ? 3 : 2;
  if (CYMBALS.has(voice)) {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
    if (voice === 'hihatOpen') {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y - r - 5, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (ghost) ctx.stroke();
    else ctx.fill();
    if (accent && !ghost) {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
