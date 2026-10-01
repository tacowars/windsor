/* eslint-disable no-magic-numbers -- IEEE 754 layout (the exponent's bias, width and mask) and the series' own arithmetic; the tunables are fmConstants.ts */
/**
 * Base-2 logarithm and power in place (windsor#300), for the voice drive's
 * diode curve and its tone's cutoff: the same bits on every platform. V8's
 * `Math.log2` and `**` are C++ that its arm64 and x64 builds round
 * differently, and the goldens are bit-exact, so these use only `+ − × ÷`,
 * `Math.round` and a typed-array view of a double's bits, which every
 * platform does alike (the reasoning of `inserts/tapePortableMath.ts`, whose
 * table the power reads).
 *
 * - `log2InPlace`: x = 2^e · m with m in (√½, √2], read from the bits; then
 *   ln m = 2 atanh s = 2 Σ s^(2i+1) / (2i+1) with s = (m − 1)/(m + 1),
 *   |s| ≤ 0.172, so twelve terms leave the rest below 1e-18 of the sum.
 *   For a positive, normal, finite x only.
 * - `exp2InPlace`: `tapePortableMath.ts`'s `exp2`, written in place: 2^k
 *   from the table times 1 + expm1(f ln 2). For |x| ≤ the table's
 *   `powerReach` (64) only.
 *
 * Both take their operand from `values[at]` and leave the result there, so
 * no double crosses the call (worklet rule 2), and allocate nothing.
 * `portablePowers.test.ts` holds them to `Math` within a few ulps.
 */

import { TAPE_PORTABLE_MATH } from '../../inserts/tapePortableMathTables';

/** atanh's series terms, 1 / (2i + 1). */
const LOG_TERM_COUNT = 12;
const LOG_TERMS = new Float64Array(LOG_TERM_COUNT);
for (let i = 0; i < LOG_TERM_COUNT; i++) LOG_TERMS[i] = 1 / (2 * i + 1);

/** One double and its two 32-bit words; the high word's index is the platform's byte order. */
const BITS = new Float64Array(1);
const WORDS = new Uint32Array(BITS.buffer);
BITS[0] = 1;
const HIGH_WORD = WORDS[1] === 0x3ff00000 ? 1 : 0;

const EXPONENT_BIAS = 1023;
const MANTISSA_HIGH_MASK = 0x000fffff;
const EXPONENT_OF_ONE = 0x3ff00000;

/** log2 of `values[at]`, written back; `values[at]` must be positive, normal and finite. */
function log2InPlace(values: Float64Array, at: number): void {
  BITS[0] = values[at];
  const high = WORDS[HIGH_WORD];
  let e = (high >>> 20) - EXPONENT_BIAS;
  WORDS[HIGH_WORD] = (high & MANTISSA_HIGH_MASK) | EXPONENT_OF_ONE;
  let m = BITS[0];
  if (m > Math.SQRT2) {
    m *= 0.5;
    e += 1;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let sum = LOG_TERMS[LOG_TERM_COUNT - 1];
  for (let i = LOG_TERM_COUNT - 2; i >= 0; i--) sum = sum * s2 + LOG_TERMS[i];
  values[at] = e + 2 * s * sum * Math.LOG2E;
}

/** 2 to the power `values[at]`, written back; |`values[at]`| must be at most 64. */
function exp2InPlace(values: Float64Array, at: number): void {
  const table = TAPE_PORTABLE_MATH;
  const x = values[at];
  const k = Math.round(x);
  const r = (x - k) * table.ln2;
  const terms = table.expm1Terms;
  let sum = terms[terms.length - 1];
  for (let i = terms.length - 2; i >= 0; i--) sum = sum * r + terms[i];
  values[at] = table.powersOfTwo[table.powerReach + k] * (1 + r * sum);
}

export { log2InPlace, exp2InPlace };
