/**
 * The tangent in place (windsor#362), for a Noise operator's colour filters'
 * prewarp, g = tan(π fc / fs): the same bits on every platform. V8's
 * `Math.tan` is C++ that its arm64 and x64 builds round differently, and the
 * goldens are bit-exact, so this uses only `+ − × ÷` and `Math.round` over
 * `inserts/tapePortableMathTables.ts`, the table `tapePortableMath.ts`'s sine
 * and cosine read: x = k π/2 + r with |r| ≤ π/4 by the Cody–Waite split of
 * π/2, then sin r and cos r by their Taylor polynomials in Horner form, and
 * tan x = sin r / cos r for an even k, −cos r / sin r for an odd one (tan
 * has period π). Within a few ulps of the correctly rounded value, not
 * bit-equal to `Math.tan`.
 *
 * Takes its operand from `values[at]` and leaves the result there, so no
 * double crosses the call (worklet rule 2), and allocates nothing. Reduces
 * exactly for |x| < 2^20 π/2. `portableTangent.test.ts` holds it to
 * `Math.tan`.
 */

import { TAPE_PORTABLE_MATH } from '../../inserts/tapePortableMathTables';

/** tan of `values[at]`, written back. */
function tanInPlace(values: Float64Array, at: number): void {
  const table = TAPE_PORTABLE_MATH;
  const x = values[at];
  const k = Math.round(x / table.halfPi);
  const parts = table.halfPiParts;
  const r = x - k * parts[0] - k * parts[1] - k * parts[2];
  const r2 = r * r;
  const sineTerms = table.sineTerms;
  let sinR = sineTerms[sineTerms.length - 1];
  for (let i = sineTerms.length - 2; i >= 0; i--) sinR = sinR * r2 + sineTerms[i];
  sinR *= r;
  const cosineTerms = table.cosineTerms;
  let cosR = cosineTerms[cosineTerms.length - 1];
  for (let i = cosineTerms.length - 2; i >= 0; i--) cosR = cosR * r2 + cosineTerms[i];
  values[at] = (k & 1) === 0 ? sinR / cosR : -cosR / sinR;
}

export { tanInPlace };
