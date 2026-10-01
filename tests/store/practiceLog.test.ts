import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, PRACTICE_LOG_KEY, PracticeLog, memoryKV, type PracticeEntry } from '@/store';

const entry = (over: Partial<PracticeEntry> = {}): PracticeEntry => ({
  songId: 'labon-ko', difficulty: 'expert', date: 1, kind: 'pass', rate: 0.8, bars: { first: 23, last: 30 }, section: 'Verse 1',
  notes: 180, missed: 4, accuracy: 0.912345, all: { lean: -0.0123456, spread: 0.0187654, count: 170 }, kickVsHands: 0.0201234, ghostRatio: 0.31234, ...over,
});

describe('PracticeLog', () => {
  it('appends entries oldest first, compacted, and filters by song and difficulty', () => {
    const log = new PracticeLog(memoryKV());
    log.add(entry());
    log.add(entry({ date: 2, difficulty: 'hard' }));
    log.add(entry({ date: 3, songId: 'other' }));
    expect(log.list().map((e) => e.date)).toEqual([1, 2, 3]);
    expect(log.list({ songId: 'labon-ko', difficulty: 'expert' }).map((e) => e.date)).toEqual([1]);
    const [first] = log.list();
    expect(first.all).toEqual({ lean: -0.0123, spread: 0.0188, count: 170 });
    expect(first.accuracy).toBe(0.9123);
    expect(first.ghostRatio).toBe(0.312);
  });

  it('keeps the newest MAX_ENTRIES and drops malformed stored entries', () => {
    const kv = memoryKV({ [PRACTICE_LOG_KEY]: JSON.stringify([...Array.from({ length: MAX_ENTRIES }, (_, i) => entry({ date: i })), { songId: 'x' }]) });
    const log = new PracticeLog(kv);
    expect(log.list()).toHaveLength(MAX_ENTRIES); // the malformed one is ignored
    log.add(entry({ date: MAX_ENTRIES }));
    const all = log.list();
    expect(all).toHaveLength(MAX_ENTRIES);
    expect(all[0].date).toBe(1);
    expect(all[all.length - 1].date).toBe(MAX_ENTRIES);
    expect(new PracticeLog(memoryKV({ [PRACTICE_LOG_KEY]: '{oops' })).list()).toEqual([]);
  });

  it('clear empties it', () => {
    const log = new PracticeLog(memoryKV());
    log.add(entry());
    log.clear();
    expect(log.list()).toEqual([]);
  });
});
