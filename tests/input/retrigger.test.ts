import { describe, expect, it, vi } from 'vitest';
import { RETRIGGER_MS, RetriggerFilter } from '@/input/retrigger';
import { InputHub } from '@/input/hub';
import type { RawMidiHit } from '@/input/midi';
import { emptyBindings } from '@/store';
import { DEFAULT_KEYBOARD, type InputHit } from '@/types';

describe('RetriggerFilter', () => {
  it('drops a second trigger of the same stroke', () => {
    const f = new RetriggerFilter();
    expect(f.accept('crash', 1000)).toBe(true);
    expect(f.accept('crash', 1050)).toBe(false); // TD-07 crash edge: 55 then 49, 50 ms apart
    expect(f.accept('kick', 1000)).toBe(true); // other drums are independent
    expect(f.accept('kick', 1045)).toBe(false); // beater bounce
  });

  it('keeps real doubles', () => {
    const f = new RetriggerFilter();
    const sixteenth = 60_000 / 108 / 4;
    expect(f.accept('kick', 0)).toBe(true);
    expect(f.accept('kick', sixteenth)).toBe(true);
    expect(f.accept('kick', sixteenth + sixteenth / 2)).toBe(true); // a 32nd: 69 ms
    expect(RETRIGGER_MS).toBeLessThan(sixteenth / 2);
  });

  it('measures from the last accepted stroke, so a buzz thins out instead of vanishing', () => {
    const f = new RetriggerFilter();
    expect([0, 40, 80, 120, 160].map((t) => f.accept('snare', t))).toEqual([true, false, true, false, true]);
  });
});

describe('InputHub retrigger filter', () => {
  const raw = (note: number, timeStamp: number): RawMidiHit => ({ note, channel: 9, velocity: 100, timeStamp, skew: 0, timeStampFallback: false, portId: 'td07', portName: 'TD-07' });

  it('filters mapped hits and leaves the raw stream alone', () => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    try {
      const hub = new InputHub(DEFAULT_KEYBOARD);
      const bindings = emptyBindings();
      bindings.kick = [{ note: 36, channel: -1 }];
      bindings.crash = [{ note: 49, channel: -1 }, { note: 55, channel: -1 }];
      hub.setDevice({ deviceKey: 'TD-07', deviceName: 'TD-07', bindings, velocityThreshold: 1, createdAt: 0, updatedAt: 0 });
      const hits: InputHit[] = [];
      const raws: RawMidiHit[] = [];
      hub.onHit((h) => hits.push(h));
      hub.onRaw((r) => raws.push(r));
      [raw(55, 1000), raw(49, 1050), raw(36, 1000), raw(36, 1045), raw(36, 1139)].forEach((r) => hub.onRaw(r));
      expect(raws.length).toBe(5);
      expect(hits.map((h) => [h.voice, h.timeStamp])).toEqual([
        ['crash', 1000],
        ['kick', 1000],
        ['kick', 1139],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
