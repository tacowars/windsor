/**
 * The constants of `tapePortableMath.ts` (windsor#219 fix round): the
 * Cody–Waite splits of π/2 and ln 2, the Taylor terms of sin, cos and
 * expm1, the powers of two the reductions scale by, and where tanh rounds to
 * ±1.
 *
 * Every entry is built from the two doubles `Math.PI` and `Math.LN2`, exact
 * integers and IEEE arithmetic (`+ − × ÷` and `Math.round`), which every
 * platform rounds alike, plus the two literal residues below. None calls a
 * transcendental `Math` function: V8's differ by an ulp between its arm64
 * and x64 builds, which is what the module exists to avoid.
 *
 * The series are mathematics (Taylor's), each term 1/n! rounded once from an
 * exact factorial; `tapePortableMath.test.ts` pins the functions against
 * `Math` and against themselves.
 */

/** n! for n ≤ 22, exact: its odd part fits in a double's 53 bits. */
function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** Terms `sign^i / (first + 2i)!` (alternating) or `1 / (first + i)!`, for i = 0 … count − 1. */
function reciprocalFactorials(first: number, count: number, alternating: boolean): Float64Array {
  const terms = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const n = alternating ? first + 2 * i : first + i;
    terms[i] = (alternating && i % 2 === 1 ? -1 : 1) / factorial(n);
  }
  return terms;
}

/**
 * A constant split as hi + mid + lo: hi keeps its top 32 or 33 bits, so an
 * integer multiple of it below 2^20 is exact; mid is the rest of the double
 * (exact, since hi is that close); lo is the true constant less the double.
 */
function split(value: number, residue: number): [number, number, number] {
  const scale = 4294967296; // 2^32
  const hi = Math.round(value * scale) / scale;
  return [hi, value - hi, residue];
}

/** Powers of two held exactly, from 2^-reach to 2^reach. */
const POWER_REACH = 64;

function powersOfTwo(reach: number): Float64Array {
  const powers = new Float64Array(2 * reach + 1);
  powers[reach] = 1;
  for (let k = 1; k <= reach; k++) {
    powers[reach + k] = powers[reach + k - 1]! * 2;
    powers[reach - k] = powers[reach - k + 1]! / 2;
  }
  return powers;
}

export const TAPE_PORTABLE_MATH = {
  /** π/2 as a double, and split: π/2 − Math.PI/2 = 6.123233995736766e-17. */
  halfPi: Math.PI / 2,
  halfPiParts: split(Math.PI / 2, 6.123233995736766e-17),
  /** k & this is the quadrant of k π/2 (two's complement, so negative k too). */
  quadrantMask: 3,
  /** ln 2 as a double, and split: ln 2 − Math.LN2 = 2.3190468138462996e-17. */
  ln2: Math.LN2,
  ln2Parts: split(Math.LN2, 2.3190468138462996e-17),
  /**
   * sin r = r Σ (−1)^i r^2i / (2i+1)! to r^19 and cos r = Σ (−1)^i r^2i / (2i)!
   * to r^20: past them, on |r| ≤ π/4, a term is below 1e-19 of the sum.
   */
  sineTerms: reciprocalFactorials(1, 10, true),
  cosineTerms: reciprocalFactorials(0, 11, true),
  /** expm1 r = r Σ r^i / (i+1)! to r^13: past it, on |r| ≤ ln2/2, a term is below 1e-17 of r. */
  expm1Terms: reciprocalFactorials(1, 13, false),
  /** |x| from which tanh x is ±1 in a double: 1 − tanh 22 = 2e^-44/(1 + e^-44) < 2^-54. */
  tanhUnity: 22,
  powerReach: POWER_REACH,
  powersOfTwo: powersOfTwo(POWER_REACH),
};

export type PortableMathTable = typeof TAPE_PORTABLE_MATH;
