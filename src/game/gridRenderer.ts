import type { DrumVoice, Judgement } from '@/types';
import { barAt, barStarts } from './bars';
import { JUDGE_COLORS, VOICE_COLORS, type BeatMark, type PaintFrame, type PlayRenderer, type RenderState } from './renderer';
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

/** Bars on screen at once: the line you are on and what comes next. */
export const BARS_SHOWN = 4;
/** A bar narrower than this (px at scale 1) gets a line to itself: 16ths closer than ~18 px blur together. */
const MIN_BAR_W = 300;
/** Rows thinner than this (px at scale 1) blur together: show fewer lines instead. */
const MIN_ROW_H = 22;
const LABEL_W = 34;
const HEADER_H = 40;
/** Space between one line and the next. */
const LINE_GAP = 18;
const MAX_ROW_H = 38;
/** Lines after the first are drawn fainter: readable, but clearly not where you are. */
const NEXT_LINE_ALPHA = 0.55;
const CYMBALS = new Set<DrumVoice>(['crash', 'ride', 'hihatClosed', 'hihatOpen', 'hihatPedal']);
const MISS = '#ff3b3b';
const ROW_FLASH_MS = 180;
/** On screen, the space the DOM HUD keeps for itself (combo and score above, song info and practice bar below). */
const SCREEN_TOP = 118;
const SCREEN_BOTTOM = 128;
const SCREEN_SIDE = 36;

export interface GridLayout {
  barsPerLine: number;
  lines: number;
  lineH: number;
}

/**
 * Two bars a line where a bar gets at least MIN_BAR_W, else one; as many lines as fit `rows` rows of at least
 * MIN_ROW_H, up to BARS_SHOWN bars. A wide window gets two lines of two bars, a narrow one lines of one bar.
 */
export function gridLayout(f: PaintFrame, rows: number): GridLayout {
  const usable = f.width - f.side * 2 - LABEL_W * f.scale;
  const barsPerLine = usable >= 2 * MIN_BAR_W * f.scale ? 2 : 1;
  const areaH = Math.max(1, f.height - f.top - f.bottom);
  const minLineH = (HEADER_H + LINE_GAP + rows * MIN_ROW_H) * f.scale;
  const lines = Math.max(1, Math.min(BARS_SHOWN / barsPerLine, Math.floor(areaH / minLineH)));
  return { barsPerLine, lines, lineH: areaH / lines };
}

/** First bar of the line that shows `bar` (1-based). The count-in (bar 0) shows the first line. */
export function lineFirstBar(bar: number, barsPerLine: number): number {
  const b = Math.max(1, bar);
  return b - ((b - 1) % barsPerLine);
}

/** Counting syllable for the `i`-th 16th of a beat: the beat number, then e, &, a. */
export function countLabel(beat: number, i: number): string {
  return i === 0 ? String(beat) : ['e', '&', 'a'][i - 1];
}

/** Beat times inside [start, end): the columns of one bar. */
export function beatsIn(beats: readonly BeatMark[], start: number, end: number): number[] {
  return beats.filter((b) => b.time >= start - 1e-6 && b.time < end - 1e-6).map((b) => b.time);
}

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
  /** The state of the last {@link draw}, for {@link paintTo}. */
  private last: RenderState | null = null;

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
    this.last = state;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paint(this.ctx, { width: this.w, height: this.h, top: SCREEN_TOP, bottom: SCREEN_BOTTOM, side: SCREEN_SIDE, scale: 1 });
  }

  /** Lay the last drawn frame out afresh for another surface (the performance video's game column). */
  paintTo(ctx: CanvasRenderingContext2D, frame: PaintFrame): boolean {
    if (!this.last) return false;
    this.paint(ctx, frame);
    return true;
  }

  private paint(ctx: CanvasRenderingContext2D, f: PaintFrame): void {
    ctx.fillStyle = '#07070b';
    ctx.fillRect(0, 0, f.width, f.height);
    const state = this.last;
    if (!state || !this.starts.length) return;
    const layout = gridLayout(f, this.rows.length);
    const first = lineFirstBar(barAt(state.time, this.starts), layout.barsPerLine);
    for (let k = 0; k < layout.lines; k++) {
      const bars: number[] = [];
      for (let i = 0; i < layout.barsPerLine; i++) {
        const bar = first + k * layout.barsPerLine + i;
        if (bar < this.starts.length) bars.push(bar); // the last start only closes the final bar
      }
      if (bars.length) this.drawLine(ctx, f, layout, state, f.top + k * layout.lineH, layout.lineH - LINE_GAP * f.scale, bars, k === 0 ? 1 : NEXT_LINE_ALPHA);
    }
  }

  private drawLine(ctx: CanvasRenderingContext2D, f: PaintFrame, layout: GridLayout, state: RenderState, y0: number, height: number, bars: number[], alpha: number): void {
    const { rows } = this;
    const k = f.scale;
    const mono = (px: number, weight = 600) => `${weight} ${px * k}px "JetBrains Mono", monospace`;
    const labelW = LABEL_W * k;
    const barW = (f.width - f.side * 2 - labelW) / layout.barsPerLine;
    const headerH = HEADER_H * k;
    const rowH = Math.min(MAX_ROW_H * k, (height - headerH) / rows.length);
    const top = y0 + headerH;
    const bottom = top + rowH * rows.length;
    const rowY = (r: number) => top + rowH * (r + 0.5);
    const rowOf = (voice: DrumVoice) => rows.findIndex((r) => r.voices.includes(voice));
    const now = performance.now();
    ctx.globalAlpha = alpha;
    rows.forEach((r, i) => {
      const lit = alpha === 1 && r.voices.some((v) => now - (this.pulses.get(v) ?? -Infinity) < ROW_FLASH_MS);
      text(ctx, r.label, f.side, rowY(i), mono(11, lit ? 800 : 600), lit ? VOICE_COLORS[r.voices[0]] : 'rgba(255,255,255,.55)');
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.lineWidth = k;
      line(ctx, f.side + labelW, rowY(i), f.side + labelW + barW * bars.length, rowY(i));
    });
    bars.forEach((bar, bi) => {
      const bx = f.side + labelW + bi * barW;
      const start = this.starts[bar - 1];
      const end = this.starts[bar];
      const xAt = (t: number) => bx + ((t - start) / (end - start)) * barW;
      text(ctx, `BAR ${bar}`, bx, y0 + 2 * k, mono(11, 700), 'rgba(255,255,255,.7)', 'left', 'top');
      // columns: bar line, beats, and the three 16ths between beats, with the count above
      const beats = beatsIn(state.beats, start, end);
      beats.forEach((bt, b) => {
        const next = beats[b + 1] ?? end;
        for (let i = 0; i < 4; i++) {
          const x = xAt(bt + ((next - bt) * i) / 4);
          ctx.strokeStyle = i ? 'rgba(255,255,255,.06)' : b ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.45)';
          ctx.lineWidth = (b === 0 && i === 0 ? 2 : 1) * k;
          line(ctx, x, top, x, bottom);
          text(ctx, countLabel(b + 1, i), x, top - 9 * k, mono(i ? 10 : 12, i ? 400 : 700), i ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.8)', 'center');
        }
      });
      // notes, where they fall in time (a humanised note sits a little off its column, as played)
      for (let i = lowerBound(state.notes, start - 1e-6); i < state.notes.length && state.notes[i].time < end - 1e-6; i++) {
        const n = state.notes[i];
        const r = rowOf(n.voice);
        if (r < 0) continue;
        const color = n.state === 'hit' && n.judgement ? JUDGE_COLORS[n.judgement] : n.state === 'missed' ? MISS : VOICE_COLORS[n.voice];
        glyph(ctx, n.voice, xAt(n.time), rowY(r), rowH, k, n.velocity, color, alpha * (n.state === 'missed' ? 0.6 : 1));
      }
      ctx.globalAlpha = alpha;
      // your strokes: a tick where the stick actually landed, in the judgement's colour
      ctx.lineWidth = 2 * k;
      for (const s of this.strokes) {
        if (s.time < start || s.time >= end) continue;
        const r = rowOf(s.voice);
        if (r < 0) continue;
        ctx.strokeStyle = s.judgement === 'over' ? MISS : JUDGE_COLORS[s.judgement];
        line(ctx, xAt(s.time), top + rowH * r + 2 * k, xAt(s.time), top + rowH * (r + 1) - 2 * k);
      }
      if (alpha === 1 && state.time >= start && state.time < end) {
        const x = xAt(state.time);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * k;
        line(ctx, x, top - 18 * k, x, bottom + 4 * k);
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
function glyph(ctx: CanvasRenderingContext2D, voice: DrumVoice, x: number, y: number, rowH: number, k: number, velocity: number, color: string, alpha: number): void {
  const ghost = velocity < 0.3;
  const accent = velocity > 0.85;
  const r = Math.min(14 * k, rowH * (ghost ? 0.16 : 0.2 + 0.12 * Math.min(1, velocity)));
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = (ghost ? 1.2 : accent ? 3 : 2) * k;
  if (CYMBALS.has(voice)) {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
    if (voice === 'hihatOpen') {
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.arc(x, y - r - 5 * k, 3.5 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (ghost) ctx.stroke();
    else ctx.fill();
    if (accent && !ghost) {
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.arc(x, y, r + 3 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
