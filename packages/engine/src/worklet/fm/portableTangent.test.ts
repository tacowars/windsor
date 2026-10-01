/**
 * The portable tangent (windsor#362): within a few ulps of `Math.tan` over
 * the prewarp's range and beyond it, odd, and periodic in π, with no
 * transcendental `Math` call of its own.
 */
import { describe, expect, it } from 'vitest';

import { tanInPlace } from './portableTangent';

/** The noise filters' widest prewarp angle: π times the ceiling's 0.45. */
const PREWARP_MAX = 0.45 * Math.PI;

const tan = (x: number): number => {
  const cell = new Float64Array([x]);
  tanInPlace(cell, 0);
  return cell[0]!;
};

/** `count` doubles spread over [lo, hi] from a 32-bit LCG: no transcendental call. */
function inputs(count: number, lo: number, hi: number): Float64Array {
  const values = new Float64Array(count);
  let state = 7;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[i] = lo + (state / 4294967296) * (hi - lo);
  }
  return values;
}

/** The largest relative error against `Math.tan`, in units of 2^-52. */
function worstUlps(xs: Float64Array): number {
  let worst = 0;
  for (const x of xs) {
    const ref = Math.tan(x);
    worst = Math.max(worst, Math.abs(tan(x) - ref) / Math.abs(ref) / 2 ** -52);
  }
  return worst;
}

describe('tanInPlace', () => {
  it('is within a few ulps of Math.tan across the prewarp range', () => {
    // Measured on Node 24: at most 2.6 ulps over 0 to 0.45π.
    expect(worstUlps(inputs(20000, 1e-6, PREWARP_MAX))).toBeLessThan(4);
  });

  it('keeps its accuracy past π/4, π/2 and π, by the reduction', () => {
    // Measured on Node 24: at most 3.0 ulps over ±10, away from the poles.
    const xs = inputs(20000, -10, 10).filter((x) => Math.abs(Math.cos(x)) > 1e-3);
    expect(worstUlps(Float64Array.from(xs))).toBeLessThan(8);
  });

  it('is exact at 0, odd, and 1 at π/4 to the ulp', () => {
    expect(tan(0)).toBe(0);
    for (const x of inputs(100, 0, 1.4)) expect(tan(-x)).toBe(-tan(x));
    expect(Math.abs(tan(Math.PI / 4) - 1)).toBeLessThanOrEqual(2 ** -52);
  });

  it('matches the analog prewarp a Butterworth section is tuned by at 1 kHz and 10 kHz', () => {
    for (const hz of [1000, 10000]) {
      const x = (Math.PI * hz) / 48000;
      expect(tan(x)).toBeCloseTo(Math.tan(x), 14);
    }
  });
});
