/**
 * Sine, cosine, tanh and 2^x for the magnetic Tape module (windsor#219 fix
 * round), in IEEE double arithmetic alone, so a render is the same bits on
 * every platform.
 *
 * Why: V8's transcendental `Math` functions are C++ that its arm64 and x64
 * builds compile differently, and they disagree by an ulp. On one input set
 * of 200 000 doubles in [−20, 20], Node 24.20.0 arm64 and x64 (under
 * Rosetta) gave different `Math.sin` on 1148, `Math.cos` on 1019,
 * `Math.tanh` on 10 and `4 ** x` on 283. That was enough to move the
 * golden's hash between the M1 and CI. `+ − × ÷`, `Math.sqrt`, `Math.abs`
 * and `Math.round` are exact or correctly rounded everywhere, so the
 * functions here use nothing else: a reduction by a Cody–Waite split of π/2
 * or ln 2 (`tapePortableMathTables.ts`), then a Taylor polynomial in Horner
 * form. Each is within a few ulps of the correctly rounded value, which the
 * test measures against `Math`; they are not bit-equal to `Math`.
 *
 * Invariants: no call here reads a transcendental `Math` function or
 * allocates. `sine`, `cosine` and `exp2` return a double and are for
 * coefficient building off the per-sample path; `tanhInPlace` is the
 * per-sample form and, like the rest of the core, takes its operand and
 * gives its result in a `Float64Array`, so no double crosses the call
 * (worklet rules 2 and 7). Their domains: `sine` and `cosine` reduce exactly
 * for |x| < 2^20 π/2, `exp2` takes |x| ≤ `powerReach`. Pinned by
 * `inserts/tapePortableMath.test.ts` and, through the core,
 * `inserts/tapeMagneticGolden.test.ts`.
 */
import { TAPE_PORTABLE_MATH, type PortableMathTable } from './tapePortableMathTables';

/** Σ terms[i] x^i by Horner's rule, highest term first. */
function horner(terms: Float64Array, x: number): number {
  let sum = terms[terms.length - 1]!;
  for (let i = terms.length - 2; i >= 0; i--) sum = sum * x + terms[i]!;
  return sum;
}

/**
 * sin(r + quadrant π/2) for |r| ≤ π/4: the sine or cosine polynomial by the
 * quadrant's parity, negated in the third and fourth.
 */
function quadrantSine(r: number, quadrant: number, table: PortableMathTable): number {
  const r2 = r * r;
  const value = quadrant & 1 ? horner(table.cosineTerms, r2) : r * horner(table.sineTerms, r2);
  return quadrant & 2 ? -value : value;
}

/** x − k π/2 in three exact-product steps, for the nearest integer k. */
function halfPiRemainder(x: number, k: number, table: PortableMathTable): number {
  const [hi, mid, lo] = table.halfPiParts;
  return x - k * hi - k * mid - k * lo;
}

/** sin x. */
function sine(x: number, table: PortableMathTable = TAPE_PORTABLE_MATH): number {
  const k = Math.round(x / table.halfPi);
  return quadrantSine(halfPiRemainder(x, k, table), k & table.quadrantMask, table);
}

/** cos x, as sin(x + π/2): the same remainder a quadrant on. */
function cosine(x: number, table: PortableMathTable = TAPE_PORTABLE_MATH): number {
  const k = Math.round(x / table.halfPi);
  return quadrantSine(halfPiRemainder(x, k, table), (k + 1) & table.quadrantMask, table);
}

/**
 * 2^x: 2^k, exact from the table, times 2^f = 1 + expm1(f ln 2) for the
 * nearest integer k and f = x − k (exact, |f| ≤ ½). An integer x is exact.
 */
function exp2(x: number, table: PortableMathTable = TAPE_PORTABLE_MATH): number {
  const k = Math.round(x);
  if (!(Math.abs(k) <= table.powerReach)) throw new RangeError(`exp2: ${x} is out of range`);
  const r = (x - k) * table.ln2;
  return table.powersOfTwo[table.powerReach + k]! * (1 + r * horner(table.expm1Terms, r));
}

/**
 * tanh of `values[at]`, written back in place: with t = expm1(−2|x|), tanh|x|
 * = −t / (t + 2), odd in x; ±1 from `tanhUnity` out, and NaN stays NaN.
 * expm1(y) is 2^k (expm1 r + 1) − 1 for y = k ln 2 + r, |r| ≤ ln2/2, which
 * keeps its relative accuracy at small |y|, where tanh x ≈ x. The Horner loop
 * is written out here rather than called, so no double crosses a call.
 */
function tanhInPlace(
  values: Float64Array,
  at: number,
  table: PortableMathTable = TAPE_PORTABLE_MATH,
): void {
  const x = values[at]!;
  const magnitude = Math.abs(x);
  if (!(magnitude < table.tanhUnity)) {
    values[at] = x > 0 ? 1 : x < 0 ? -1 : x;
    return;
  }
  const y = -(magnitude + magnitude); // −2|x|, exactly
  const k = Math.round(y / table.ln2);
  const parts = table.ln2Parts;
  const r = y - k * parts[0] - k * parts[1] - k * parts[2];
  const terms = table.expm1Terms;
  let sum = terms[terms.length - 1]!;
  for (let i = terms.length - 2; i >= 0; i--) sum = sum * r + terms[i]!;
  const small = r * sum;
  const scale = table.powersOfTwo[table.powerReach + k]!;
  const t = k === 0 ? small : scale * small + (scale - 1);
  const tanh = -t / (t + 2);
  values[at] = x < 0 ? -tanh : tanh;
}

export { cosine, exp2, sine, tanhInPlace };
