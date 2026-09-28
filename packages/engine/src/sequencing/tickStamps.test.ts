import { describe, expect, it } from 'vitest';

import { TickStamps } from './tickStamps';

describe('TickStamps', () => {
  it('finds the last recorded tick stamped at or before now', () => {
    const stamps = new TickStamps(8);
    stamps.clear(10);
    for (let t = 10; t < 15; t++) stamps.record(t, t * 0.1);
    expect(stamps.soundingAt(0.5, 0)).toBe(-1);
    expect(stamps.soundingAt(1.0, 0)).toBe(10);
    expect(stamps.soundingAt(1.25, 0)).toBe(12);
    expect(stamps.soundingAt(1.3 - 1e-12, 1e-9)).toBe(13);
    expect(stamps.soundingAt(9, 0)).toBe(14);
    expect(stamps.oldest).toBe(10);
  });

  it('holds only the ring and forgets everything on clear', () => {
    const stamps = new TickStamps(4);
    stamps.clear(0);
    for (let t = 0; t < 10; t++) stamps.record(t, t);
    expect(stamps.oldest).toBe(6);
    expect(stamps.soundingAt(3, 0)).toBe(-1);
    expect(stamps.soundingAt(7.5, 0)).toBe(7);
    stamps.clear(20);
    expect(stamps.soundingAt(100, 0)).toBe(-1);
  });

  it('reads the tick each stamp was issued with when a loop jumps it back (windsor#15)', () => {
    const stamps = new TickStamps(8);
    stamps.clear(94);
    [94, 95, 48, 49].forEach((tick, i) => stamps.record(tick, i));
    expect(stamps.oldest).toBe(94);
    expect(stamps.soundingAt(1.5, 0)).toBe(95);
    expect(stamps.soundingAt(2, 0)).toBe(48);
    expect(stamps.soundingAt(9, 0)).toBe(49);
  });
});
