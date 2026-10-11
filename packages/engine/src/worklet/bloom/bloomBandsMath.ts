/**
 * Small-argument series in place, for the levers that retune once a block
 * while a control glides (Focus's poles, Spread's pan): the same bits on every
 * platform (worklet rule 6), no double across a call (rule 2), nothing
 * allocated. Each reads its operand from `values[at]` and writes its results
 * from `values[at]` on.
 *
 * - `bloomExpm1InPlace`: e^x − 1 by its Taylor series, for |x| ≤ ½ (the
 *   bands' pole offsets are under 0.05 at any rate from 8 kHz). Kept as
 *   e^x − 1 so 1 − e^(−δ) loses nothing to cancellation.
 * - `bloomSinVersineInPlace`: sin x into `values[at]` and 1 − cos x into
 *   `values[at + 1]`, for |x| ≤ π/4 (the Taylor series, both to well under
 *   an ulp there). 1 − cos x is kept as such for the same reason.
 *
 * Pinned against `Math` in `inserts/bloomBands.test.ts` and, through the
 * bands and the output, by the lever tests.
 */

/** Terms of e^x − 1 = Σ x^k / k!, k = 1 … 18: index k − 1 holds 1/k!. */
const BLOOM_EXPM1_TERM_COUNT = 18;
const BLOOM_EXPM1_TERMS = new Float64Array(BLOOM_EXPM1_TERM_COUNT);
/** sin x = x Σ (−x²)^i / (2i + 1)!, and 1 − cos x = x² Σ (−x²)^i / (2i + 2)!, i = 0 … 10: the 1/(·)! here. */
const BLOOM_TRIG_TERM_COUNT = 11;
const BLOOM_SINE_TERMS = new Float64Array(BLOOM_TRIG_TERM_COUNT);
const BLOOM_VERSINE_TERMS = new Float64Array(BLOOM_TRIG_TERM_COUNT);
{
  let factorial = 1;
  for (let k = 1; k <= BLOOM_EXPM1_TERM_COUNT; k++) {
    factorial *= k;
    BLOOM_EXPM1_TERMS[k - 1] = 1 / factorial;
  }
  factorial = 1;
  for (let n = 1; n <= 2 * BLOOM_TRIG_TERM_COUNT + 1; n++) {
    factorial *= n;
    const i = (n - 1) >> 1;
    if (i >= BLOOM_TRIG_TERM_COUNT) continue;
    // The sign is the series' variable's, −x².
    if (n % 2 === 1) BLOOM_SINE_TERMS[i] = 1 / factorial;
    else BLOOM_VERSINE_TERMS[i] = 1 / factorial;
  }
}

/** e^x − 1 of `values[at]`, written back; |x| ≤ ½. */
function bloomExpm1InPlace(values: Float64Array, at: number): void {
  const x = values[at];
  const terms = BLOOM_EXPM1_TERMS;
  let sum = terms[BLOOM_EXPM1_TERM_COUNT - 1];
  for (let i = BLOOM_EXPM1_TERM_COUNT - 2; i >= 0; i--) sum = sum * x + terms[i];
  values[at] = x * sum;
}

/** sin x into `values[at]` and 1 − cos x into `values[at + 1]`, x = `values[at]`; |x| ≤ π/4. */
function bloomSinVersineInPlace(values: Float64Array, at: number): void {
  const x = values[at],
    x2 = -(x * x);
  const sines = BLOOM_SINE_TERMS,
    versines = BLOOM_VERSINE_TERMS;
  let s = sines[BLOOM_TRIG_TERM_COUNT - 1],
    v = versines[BLOOM_TRIG_TERM_COUNT - 1];
  for (let i = BLOOM_TRIG_TERM_COUNT - 2; i >= 0; i--) {
    s = s * x2 + sines[i];
    v = v * x2 + versines[i];
  }
  values[at] = x * s;
  values[at + 1] = x * x * v;
}

export { bloomExpm1InPlace, bloomSinVersineInPlace };
