/**
 * The portable functions (windsor#219 fix round): within a few ulps of
 * `Math`, exact where they promise to be, and pinned to the bit by a hash
 * over fixed inputs. The inputs come from an integer generator and IEEE
 * arithmetic, so the hashes are the same on every platform the functions
 * are; a hash that moves on one machine and not another is the defect this
 * module exists to prevent.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cosine, exp2, sine, tanhInPlace } from './tapePortableMath';
import { TAPE_PORTABLE_MATH } from './tapePortableMathTables';

const ULP = 2 ** -52;

/** `count` doubles in [−reach, reach] from a 32-bit LCG: no transcendental call. */
function inputs(count: number, reach: number, seed = 1): Float64Array {
  const values = new Float64Array(count);
  let state = seed;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[i] = (state / 4294967296 - 0.5) * 2 * reach;
  }
  return values;
}

const tanh = (x: number) => {
  const cell = new Float64Array([x]);
  tanhInPlace(cell, 0);
  return cell[0]!;
};

/** The largest error of `f` against `reference`, in ulps of max(|reference|, floor). */
function worstUlps(
  xs: Float64Array,
  f: (x: number) => number,
  reference: (x: number) => number,
  floor = 0,
) {
  let worst = 0;
  for (const x of xs) {
    const want = reference(x);
    const error = Math.abs(f(x) - want) / (Math.max(Math.abs(want), floor) * ULP);
    worst = Math.max(worst, error);
  }
  return worst;
}

function hash(xs: Float64Array, f: (x: number) => number): string {
  const ys = xs.map(f);
  return createHash('sha256').update(Buffer.from(ys.buffer)).digest('hex').slice(0, 16);
}

describe('the portable functions against Math', () => {
  it('sine and cosine are within 2 ulps of 1 over [-100, 100]', () => {
    const xs = inputs(100_000, 100);
    expect(worstUlps(xs, sine, Math.sin, 1)).toBeLessThanOrEqual(2);
    expect(worstUlps(xs, cosine, Math.cos, 1)).toBeLessThanOrEqual(2);
  });

  it('sine keeps its relative accuracy near zero, and both are exact at 0', () => {
    expect(worstUlps(inputs(10_000, 1e-3), sine, Math.sin)).toBeLessThanOrEqual(2);
    expect([sine(0), cosine(0)]).toEqual([0, 1]);
  });

  it('tanh is within 4 ulps relative over [-30, 30] and near zero, odd, and ±1 from 22', () => {
    expect(worstUlps(inputs(100_000, 30), tanh, Math.tanh)).toBeLessThanOrEqual(4);
    expect(worstUlps(inputs(10_000, 0.02, 7), tanh, Math.tanh)).toBeLessThanOrEqual(4);
    for (const x of inputs(1000, 25, 3)) expect(tanh(-x)).toBe(-tanh(x));
    expect([tanh(22), tanh(-22), tanh(1e300), tanh(-Infinity)]).toEqual([1, -1, 1, -1]);
    expect(tanh(NaN)).toBeNaN();
  });

  it('exp2 is exact at every integer in reach, within 2 ulps between, and refuses past it', () => {
    const reach = TAPE_PORTABLE_MATH.powerReach;
    for (let k = -reach; k <= reach; k++) expect(exp2(k)).toBe(2 ** k);
    expect(worstUlps(inputs(100_000, 4), exp2, (x) => 2 ** x)).toBeLessThanOrEqual(2);
    expect(() => exp2(reach + 1)).toThrow(RangeError);
    expect(() => exp2(NaN)).toThrow(RangeError);
  });
});

describe('the tables', () => {
  it('split π/2 and ln 2 so a multiple of the high part below 2^20 is exact', () => {
    for (const [hi, mid] of [TAPE_PORTABLE_MATH.halfPiParts, TAPE_PORTABLE_MATH.ln2Parts]) {
      expect(Number.isInteger(hi! * 2 ** 32)).toBe(true);
      expect(hi! + mid!).not.toBe(hi);
    }
    expect(TAPE_PORTABLE_MATH.halfPiParts[0] + TAPE_PORTABLE_MATH.halfPiParts[1]).toBe(Math.PI / 2);
    expect(TAPE_PORTABLE_MATH.ln2Parts[0] + TAPE_PORTABLE_MATH.ln2Parts[1]).toBe(Math.LN2);
  });

  it('hold the Taylor terms as reciprocal factorials', () => {
    expect([...TAPE_PORTABLE_MATH.sineTerms.slice(0, 3)]).toEqual([1, -1 / 6, 1 / 120]);
    expect([...TAPE_PORTABLE_MATH.cosineTerms.slice(0, 3)]).toEqual([1, -1 / 2, 1 / 24]);
    expect([...TAPE_PORTABLE_MATH.expm1Terms.slice(0, 3)]).toEqual([1, 1 / 2, 1 / 6]);
  });
});

describe('the portable functions to the bit', () => {
  // Written on Node 24 arm64 (M1) and read identically on Node 24 x64 (Rosetta);
  // `Math.sin`, `Math.cos`, `Math.tanh` and `**` hash differently between those two.
  it('hash the same over fixed inputs', () => {
    const wide = inputs(20_000, 80);
    const narrow = inputs(20_000, 4, 5);
    expect({
      sine: hash(wide, (x) => sine(x)),
      cosine: hash(wide, (x) => cosine(x)),
      tanh: hash(narrow, tanh),
      exp2: hash(narrow, (x) => exp2(x)),
    }).toEqual({
      sine: 'ba888b32422ace87',
      cosine: '6dcc0626602e2f23',
      tanh: '88d3e59a4aa64a8e',
      exp2: 'bf88b24cd179c6ef',
    });
  });
});
