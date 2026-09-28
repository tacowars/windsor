import { describe, expect, it } from 'vitest';

import { DIVISORS } from './scheduler';
import { isStraight, playableSwing, swingSlope, swingTicks, unswingTicks } from './swing';
import {
  STRAIGHT_SWING,
  SWING_AMOUNT_MAX,
  SWING_AMOUNT_MIN,
  SWING_GRIDS,
  SWING_TABLE,
  type Swing,
} from './swingTables';

const TRIPLET = 200 / 3;
/** Every amount the song allows, in half-percent steps, on both grids. */
const SWEEP: Swing[] = SWING_GRIDS.flatMap((grid) =>
  Array.from({ length: (SWING_AMOUNT_MAX - SWING_AMOUNT_MIN) * 2 + 1 }, (_, i) => ({
    amount: SWING_AMOUNT_MIN + i / 2,
    grid,
  })),
);

describe('the swing table', () => {
  it('pairs a quarter for the 8ths grid and an 8th for the 16ths grid', () => {
    expect(SWING_TABLE.pairTicks[8]).toBe(DIVISORS.quarter);
    expect(SWING_TABLE.pairTicks[16]).toBe(DIVISORS.eighth);
  });

  it('defaults to straight 16ths', () => {
    expect(STRAIGHT_SWING).toEqual({ amount: 50, grid: 16 });
    expect(isStraight(STRAIGHT_SWING)).toBe(true);
    expect(isStraight({ amount: 50, grid: 8 })).toBe(true);
  });
});

describe('playableSwing', () => {
  it('passes a valid swing through and repairs what the clock cannot play', () => {
    const hard: Swing = { amount: 75, grid: 8 };
    expect(playableSwing(hard)).toBe(hard);
    expect(playableSwing(undefined)).toEqual(STRAIGHT_SWING);
    expect(playableSwing({ amount: 100, grid: 16 })).toEqual({ amount: 75, grid: 16 });
    expect(playableSwing({ amount: 20, grid: 8 })).toEqual({ amount: 50, grid: 8 });
    expect(playableSwing({ amount: NaN, grid: 8 })).toEqual({ amount: 50, grid: 8 });
    expect(playableSwing({ amount: 60, grid: 4 } as unknown as Swing)).toEqual({
      amount: 60,
      grid: 16,
    });
  });
});

describe('the swing warp', () => {
  it('is the identity when straight, slope exactly 1', () => {
    for (let t = 0; t < 200; t += 0.25) {
      expect(swingTicks(t, STRAIGHT_SWING)).toBe(t);
      expect(unswingTicks(t, STRAIGHT_SWING)).toBe(t);
      expect(swingSlope(Math.floor(t), STRAIGHT_SWING)).toBe(1);
    }
  });

  it('puts the off-beat 16th at 2/3 of the 8th at 66.7 and 3/4 at 75', () => {
    expect(swingTicks(6, { amount: TRIPLET, grid: 16 })).toBeCloseTo(8, 12);
    expect(swingTicks(6, { amount: 66.7, grid: 16 })).toBeCloseTo(12 * 0.667, 12);
    expect(swingTicks(6, { amount: 75, grid: 16 })).toBe(9);
    // Every pair alike, the boundaries unmoved.
    expect(swingTicks(18, { amount: 75, grid: 16 })).toBe(21);
    expect(swingTicks(12, { amount: 75, grid: 16 })).toBe(12);
  });

  it('puts the off-beat 8th at 2/3 and 3/4 of the quarter on the 8ths grid', () => {
    expect(swingTicks(12, { amount: TRIPLET, grid: 8 })).toBeCloseTo(16, 12);
    expect(swingTicks(12, { amount: 75, grid: 8 })).toBe(18);
    expect(swingTicks(36, { amount: 75, grid: 8 })).toBe(42);
    expect(swingTicks(24, { amount: 75, grid: 8 })).toBe(24);
    // The 16ths within move proportionally and never reorder.
    expect(swingTicks(6, { amount: 75, grid: 8 })).toBe(9);
    expect(swingTicks(18, { amount: 75, grid: 8 })).toBe(21);
  });

  it('is monotonic at every amount, with slopes that sum to the pair', () => {
    for (const swing of SWEEP) {
      const pair = SWING_TABLE.pairTicks[swing.grid];
      let last = -Infinity;
      for (let t = 0; t <= 4 * pair; t += 0.125) {
        const w = swingTicks(t, swing);
        expect(w).toBeGreaterThan(last);
        last = w;
      }
      let sum = 0;
      for (let t = 0; t < pair; t++) {
        expect(swingSlope(t, swing)).toBeGreaterThan(0);
        sum += swingSlope(t, swing);
      }
      expect(sum).toBeCloseTo(pair, 12);
    }
  });

  it('inverts: unswing(swing(t)) is t', () => {
    for (const swing of SWEEP) {
      for (let t = 0; t < 100; t += 0.5) {
        expect(unswingTicks(swingTicks(t, swing), swing)).toBeCloseTo(t, 9);
      }
    }
  });
});
