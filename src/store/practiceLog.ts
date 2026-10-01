/**
 * Practice history persisted through a KV: one entry per finished take and per practice loop pass, oldest
 * first, capped at MAX_ENTRIES. Each entry keeps the timing & feel summary, so progress can be read over days
 * (and, later, by a coach) without storing every hit.
 */
import type { Difficulty } from '@/types';
import { DIFFICULTIES } from '@/types';
import { readJson, writeJson, type KV } from './kv';

export const PRACTICE_LOG_KEY = 'dk.practice.v1';
/** ~400 bytes each: a few months of daily practice in about a megabyte of localStorage. */
export const MAX_ENTRIES = 3000;

/** Median lean and interquartile spread (seconds) over `count` hits. */
export interface LeanEntry {
  lean: number;
  spread: number;
  count: number;
}

export interface PracticeEntry {
  songId: string;
  difficulty: Difficulty;
  /** Epoch ms. */
  date: number;
  /** A whole take (play mode, or practice ended from the pause menu) or one pass round a practice loop. */
  kind: 'take' | 'pass';
  rate: number;
  /** Bars covered, inclusive. */
  bars: { first: number; last: number };
  /** The section's name when the bars are exactly one section. */
  section?: string;
  /** Notes judged (hit or missed) and how many of them were missed. */
  notes: number;
  missed: number;
  /** 0..1, weighted like the score (perfect 1, great 0.7, good 0.4). */
  accuracy: number;
  all: LeanEntry | null;
  /** Kick against the hands on shared beats (s): positive = kick after. */
  kickVsHands: number | null;
  /** Ghost-note velocity as a fraction of the backbeat's. */
  ghostRatio: number | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isLean = (v: unknown): v is LeanEntry => !!v && typeof v === 'object' && isNum((v as LeanEntry).lean) && isNum((v as LeanEntry).spread) && isNum((v as LeanEntry).count);

function isEntry(v: unknown): v is PracticeEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  const bars = e.bars as Record<string, unknown> | undefined;
  return (
    typeof e.songId === 'string' &&
    DIFFICULTIES.includes(e.difficulty as Difficulty) &&
    isNum(e.date) &&
    (e.kind === 'take' || e.kind === 'pass') &&
    isNum(e.rate) &&
    !!bars && isNum(bars.first) && isNum(bars.last) &&
    isNum(e.notes) && isNum(e.missed) && isNum(e.accuracy) &&
    (e.all === null || isLean(e.all))
  );
}

/** Seconds kept to a tenth of a millisecond: plenty for timing, and it keeps the JSON short. */
const r4 = (s: number) => Math.round(s * 10000) / 10000;
const compactLean = (l: LeanEntry | null): LeanEntry | null => (l ? { lean: r4(l.lean), spread: r4(l.spread), count: l.count } : null);

export class PracticeLog {
  constructor(private readonly kv: KV) {}

  private read(): PracticeEntry[] {
    const data = readJson<unknown>(this.kv, PRACTICE_LOG_KEY, []);
    return Array.isArray(data) ? data.filter(isEntry) : [];
  }

  add(entry: PracticeEntry): void {
    const all = this.read();
    all.push({
      ...entry,
      accuracy: Math.round(entry.accuracy * 10000) / 10000,
      all: compactLean(entry.all),
      kickVsHands: entry.kickVsHands === null ? null : r4(entry.kickVsHands),
      ghostRatio: entry.ghostRatio === null ? null : Math.round(entry.ghostRatio * 1000) / 1000,
    });
    writeJson(this.kv, PRACTICE_LOG_KEY, all.slice(-MAX_ENTRIES));
  }

  /** Entries oldest first, optionally for one song (and difficulty). */
  list(filter: { songId?: string; difficulty?: Difficulty } = {}): PracticeEntry[] {
    return this.read().filter((e) => (!filter.songId || e.songId === filter.songId) && (!filter.difficulty || e.difficulty === filter.difficulty));
  }

  clear(): void {
    this.kv.remove(PRACTICE_LOG_KEY);
  }
}
