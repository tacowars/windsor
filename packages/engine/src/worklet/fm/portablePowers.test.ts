/**
 * The voice drive's portable powers (windsor#300): within a few ulps of
 * `Math` over the ranges the diode and the tone use, exact where a power of
 * two makes them so, and the same on every platform (they use no
 * transcendental `Math` function, which is the point).
 */
import { describe, expect, it } from 'vitest';

import { exp2InPlace, log2InPlace } from './portablePowers';

const ULP = 2 ** -52;

/** `count` doubles spread over [lo, hi] from a 32-bit LCG: no transcendental call. */
function inputs(count: number, lo: number, hi: number): Float64Array {
  const values = new Float64Array(count);
  let state = 1;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[i] = lo + (state / 4294967296) * (hi - lo);
  }
  return values;
}

const inPlace =
  (f: (values: Float64Array, at: number) => void) =>
  (x: number): number => {
    const cell = new Float64Array([x]);
    f(cell, 0);
    return cell[0]!;
  };
const log2 = inPlace(log2InPlace);
const exp2 = inPlace(exp2InPlace);

/** The largest error against `reference`, in ulps of max(|reference|, floor). */
function worstUlps(
  xs: Float64Array,
  f: (x: number) => number,
  ref: (x: number) => number,
  floor: number,
): number {
  let worst = 0;
  for (const x of xs) {
    const want = ref(x);
    const err = Math.abs(f(x) - want) / (Math.max(Math.abs(want), floor) * ULP);
    if (err > worst) worst = err;
  }
  return worst;
}

describe('the portable powers (windsor#300)', () => {
  it('takes log2 within a few ulps across the diode range, 2^-20 to 2^62', () => {
    const small = inputs(20000, 2 ** -20, 1);
    const large = inputs(20000, 1, 2 ** 62);
    expect(worstUlps(small, log2, Math.log2, 1)).toBeLessThan(4);
    expect(worstUlps(large, log2, Math.log2, 1)).toBeLessThan(4);
  });

  it('takes 2^x within a few ulps across ±64', () => {
    expect(worstUlps(inputs(40000, -64, 64), exp2, (x) => 2 ** x, 0)).toBeLessThan(4);
  });

  it('is exact on powers of two and integers', () => {
    for (let k = -60; k <= 60; k++) {
      expect(log2(2 ** k)).toBe(k);
      expect(exp2(k)).toBe(2 ** k);
    }
    expect(log2(1)).toBe(0);
  });
});
