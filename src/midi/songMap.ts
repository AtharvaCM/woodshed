/**
 * Song map: folds a chart into bars on a 16th grid, clusters bars that play (nearly) the same pattern, and
 * proposes section markers from where the drums change. Songs are a few grooves repeated with fills between
 * them; transcribed charts add noise, so "the same pattern" means close, not identical.
 */

import type { Chart, DrumVoice, SongSection } from '@/types';
import { normaliseTimeSignatures } from './chart';

/** `voice@slot`: one 16th-grid cell of a bar. */
export type Cell = string;

export const cell = (voice: DrumVoice, slot: number): Cell => `${voice}@${slot}`;

export interface MapBar {
  /** 1-based, as the game counts bars (bar 1 starts at chart tick 0). */
  bar: number;
  startTick: number;
  /** Cells played in this bar, with the loudest velocity (0..1) per cell. */
  cells: Map<Cell, number>;
  /** Pattern id ('A', 'B', …), or null for a bar that repeats nothing (fill, break, transcription noise). */
  pattern: string | null;
  /** A crash on the downbeat: how drummers mark the top of a section. */
  crashOnOne: boolean;
}

export interface Pattern {
  /** 'A', 'B', … in order of first appearance. */
  id: string;
  bars: number[];
  /** Cells present in at least half of the pattern's bars. */
  cells: Set<Cell>;
}

export interface SongMap {
  bars: MapBar[];
  patterns: Pattern[];
}

/** Bars this close or closer (Jaccard distance on cells) play the same pattern. */
export const SAME_PATTERN = 0.3;
/** A pattern needs this many bars; fewer and those bars are one-offs. */
export const MIN_REPEATS = 3;

/** Start tick of every bar from 1 until one past the bar holding `lastTick` (the extra one closes the last bar). */
export function barStartTicks(chart: Chart, lastTick: number): number[] {
  const sigs = normaliseTimeSignatures(chart.timeSignatures);
  const out: number[] = [];
  let tick = 0;
  for (let guard = 0; guard < 100000; guard++) {
    out.push(tick);
    if (tick > lastTick) break;
    let sig = sigs[0];
    for (const s of sigs) if (s.tick <= tick) sig = s;
    tick += (chart.ppq * 4 * sig.numerator) / sig.denominator;
  }
  return out;
}

function distance(a: Iterable<Cell>, aSize: number, b: Set<Cell>): number {
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  const union = aSize + b.size - inter;
  return union ? 1 - inter / union : 0;
}

export function buildSongMap(chart: Chart): SongMap {
  const lastTick = chart.notes.reduce((m, n) => Math.max(m, n.tick), 0);
  const starts = barStartTicks(chart, lastTick);
  const sixteenth = chart.ppq / 4;
  const bars: MapBar[] = starts.slice(0, -1).map((startTick, i) => ({ bar: i + 1, startTick, cells: new Map(), pattern: null, crashOnOne: false }));
  let b = 0;
  for (const n of chart.notes) {
    // a note up to half a 16th early belongs to the next bar's downbeat (humanised or unquantised charts)
    const t = n.tick + sixteenth / 2;
    while (b + 1 < bars.length && starts[b + 1] <= t) b++;
    while (b > 0 && starts[b] > t) b--;
    const bar = bars[b];
    if (!bar) continue;
    const slots = Math.round((starts[b + 1] - starts[b]) / sixteenth);
    const slot = Math.min(slots - 1, Math.max(0, Math.round((n.tick - bar.startTick) / sixteenth)));
    const k = cell(n.voice, slot);
    bar.cells.set(k, Math.max(bar.cells.get(k) ?? 0, n.velocity));
    if (n.voice === 'crash' && slot === 0) bar.crashOnOne = true;
  }

  // Leader clustering, then merge near-twin clusters (transcription noise drifts each consensus a little),
  // then settle every bar on its nearest surviving pattern.
  let clusters: { cells: Set<Cell>; members: MapBar[] }[] = [];
  const nearest = (bar: MapBar): [number, number] => {
    let best = -1;
    let bestD = Infinity;
    clusters.forEach((c, i) => {
      const d = distance(bar.cells.keys(), bar.cells.size, c.cells);
      if (d < bestD) (bestD = d), (best = i);
    });
    return [best, bestD];
  };
  const consensus = () => {
    clusters = clusters.filter((c) => c.members.length);
    for (const c of clusters) {
      const count = new Map<Cell, number>();
      for (const m of c.members) for (const k of m.cells.keys()) count.set(k, (count.get(k) ?? 0) + 1);
      c.cells = new Set([...count].filter(([, n]) => n * 2 >= c.members.length).map(([k]) => k));
    }
  };
  for (const bar of bars) {
    if (!bar.cells.size) continue;
    const [i, d] = nearest(bar);
    if (i >= 0 && d <= SAME_PATTERN) clusters[i].members.push(bar);
    else clusters.push({ cells: new Set(bar.cells.keys()), members: [bar] });
  }
  consensus();
  for (;;) {
    let pair: [number, number] | null = null;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const d = distance(clusters[i].cells, clusters[i].cells.size, clusters[j].cells);
        if (d < bestD) (bestD = d), (pair = [i, j]);
      }
    if (!pair || bestD > SAME_PATTERN) break;
    clusters[pair[0]].members.push(...clusters[pair[1]].members);
    clusters.splice(pair[1], 1);
    consensus();
  }
  for (const c of clusters) c.members = [];
  for (const bar of bars) {
    if (!bar.cells.size) continue;
    const [i, d] = nearest(bar);
    if (i >= 0 && d <= SAME_PATTERN) clusters[i].members.push(bar);
  }
  consensus();

  const patterns: Pattern[] = clusters
    .filter((c) => c.members.length >= MIN_REPEATS)
    .sort((x, y) => Math.min(...x.members.map((m) => m.bar)) - Math.min(...y.members.map((m) => m.bar)))
    .map((c, i) => {
      const id = String.fromCharCode(65 + i);
      for (const m of c.members) m.pattern = id;
      return { id, bars: c.members.map((m) => m.bar).sort((x, y) => x - y), cells: c.cells };
    });
  return { bars, patterns };
}

// ─────────────────────────── Sections ───────────────────────────

/**
 * A fill or a crash on the one only starts a new section once the current one has this many bars: pop phrases
 * come in 8s, and a fill every four bars (or a crash on every phrase) must not chop a verse into pieces.
 */
const SPLIT_AFTER = 8;
/** A stretch shorter than this that is not tacet joins the section before it. */
const MIN_SECTION = 4;

type Role = { kind: 'rest' } | { kind: 'groove'; id: string } | { kind: 'fill' };

/** What each bar is for sectioning. A pattern that never runs two bars in a row is a recurring fill, not a groove. */
function roles(map: SongMap): Role[] {
  const grooves = new Set<string>();
  map.bars.forEach((b, i) => {
    if (b.pattern && map.bars[i + 1]?.pattern === b.pattern) grooves.add(b.pattern);
  });
  return map.bars.map((b): Role => (!b.cells.size ? { kind: 'rest' } : b.pattern && grooves.has(b.pattern) ? { kind: 'groove', id: b.pattern } : { kind: 'fill' }));
}

/**
 * Proposed section markers: a new section where the drums start or stop, where the groove changes, on the bar
 * after a fill, and on a crash on the one — the last two only after SPLIT_AFTER bars. Tacet stretches are
 * "Intro" or "Break" (the map ends at the last note, so there is no tacet ending); the rest are named after
 * their groove and numbered ("A1", "A2", "B1"…), to be renamed by ear. No notes, no sections.
 */
export function proposeSections(map: SongMap): SongSection[] {
  const r = roles(map);
  if (!r.some((x) => x.kind !== 'rest')) return [];
  const starts: number[] = [0];
  let lastGroove: string | null = null;
  for (let i = 1; i < r.length; i++) {
    const len = i - starts[starts.length - 1];
    const cur = r[i];
    const prev = r[i - 1];
    const drumsInOrOut = (cur.kind === 'rest') !== (prev.kind === 'rest');
    const grooveChange = cur.kind === 'groove' && lastGroove !== null && cur.id !== lastGroove;
    const afterFill = cur.kind === 'groove' && prev.kind === 'fill' && len >= SPLIT_AFTER;
    const crash = cur.kind !== 'rest' && map.bars[i].crashOnOne && len >= SPLIT_AFTER;
    if (drumsInOrOut || grooveChange || afterFill || crash) starts.push(i);
    if (cur.kind === 'groove') lastGroove = cur.id;
  }
  // A short stretch that is not tacet joins the section before it (a fill-only tail, a two-bar groove blip).
  const spans = starts.map((s, k) => ({ first: s, last: (starts[k + 1] ?? r.length) - 1 }));
  const merged: typeof spans = [];
  for (const s of spans) {
    const rest = r.slice(s.first, s.last + 1).every((x) => x.kind === 'rest');
    const prev = merged[merged.length - 1];
    const prevRest = prev && r.slice(prev.first, prev.last + 1).every((x) => x.kind === 'rest');
    if (prev && !rest && !prevRest && s.last - s.first + 1 < MIN_SECTION) prev.last = s.last;
    else merged.push({ ...s });
  }
  const count = new Map<string, number>();
  return merged.map((s, k) => {
    const span = r.slice(s.first, s.last + 1);
    let name: string;
    if (span.every((x) => x.kind === 'rest')) name = k === 0 ? 'Intro' : 'Break';
    else {
      const tally = new Map<string, number>();
      for (const x of span) if (x.kind === 'groove') tally.set(x.id, (tally.get(x.id) ?? 0) + 1);
      const top = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Fill';
      const n = (count.get(top) ?? 0) + 1;
      count.set(top, n);
      name = top === 'Fill' ? (n > 1 ? `Fill ${n}` : 'Fill') : `${top}${n}`;
    }
    return { bar: s.first + 1, name };
  });
}
