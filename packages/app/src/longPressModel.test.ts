import { describe, expect, it } from 'vitest';
import { LONG_PRESS } from './contextMenuTables';
import { holdRingTiming, longPressDue, longPressMoved, longPressOpens } from './longPressModel';

describe('the long press', () => {
  it('is a touch’s or a pen’s, never a mouse’s, which right-clicks', () => {
    expect(longPressOpens('touch')).toBe(true);
    expect(longPressOpens('pen')).toBe(true);
    expect(longPressOpens('mouse')).toBe(false);
  });

  it('opens after 450 ms held within 8 px, and not sooner or further', () => {
    expect(LONG_PRESS).toEqual({ ms: 450, slopPx: 8 });
    const press = { startMs: 1000, from: { x: 100, y: 20 } };
    expect(longPressDue(press, { ms: 1450, at: { x: 100, y: 20 } })).toBe(true);
    expect(longPressDue(press, { ms: 1449, at: { x: 100, y: 20 } })).toBe(false);
    expect(longPressDue(press, { ms: 1500, at: { x: 108, y: 20 } })).toBe(true);
    expect(longPressDue(press, { ms: 1500, at: { x: 109, y: 20 } })).toBe(false);
    expect(longPressDue(press, { ms: 1500, at: { x: 106, y: 26 } })).toBe(false); // 8.5 px on the diagonal
    expect(longPressMoved({ x: 0, y: 0 }, { x: 0, y: 9 })).toBe(true);
    expect(longPressMoved({ x: 0, y: 0 }, { x: 0, y: 8 })).toBe(false);
  });
});

describe('the hold ring', () => {
  it('waits 150 ms, so a shorter press never draws it, then fills until the press opens at 450 ms', () => {
    expect(holdRingTiming()).toEqual({ delayMs: 150, fillMs: 300 });
    expect(holdRingTiming({ showMs: 100, radiusPx: 30 }, { ms: 500, slopPx: 8 })).toEqual({
      delayMs: 100,
      fillMs: 400,
    });
  });
});
