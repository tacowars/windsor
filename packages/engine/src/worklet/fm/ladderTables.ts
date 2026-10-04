/**
 * The Acid Ladder's tables (windsor#573, record
 * `2026-10-04-acid-ladder-filter-mode` decision 6): the diode law and the
 * 2× solver's decimator. Data only and import-free; `ladder.ts` reads
 * them once at load.
 *
 * `LADDER_SATURATOR` is tanh as a rational in `+ − × ÷`, so the ladder's
 * render is the same bits on arm64 and x64 (`Math.tanh` is not): the [7/6]
 * truncation of Lambert's continued fraction,
 * tanh x ≈ x (135135 + 17325 x² + 378 x⁴ + x⁶) / (135135 + 62370 x² + 3150 x⁴ + 28 x⁶),
 * held at ±1 from |x| = `limit`, the first point where it reaches 1, and
 * monotone up to it. Its error against `Math.tanh` is under 9.7e-5
 * everywhere, its own derivative's under 2e-4 against 1 − tanh², and the
 * slope it leaves at the limit is 3.5e-4. The [5/4] truncation is 1.4e-3
 * out and the [9/8] 6.8e-6 at twice the cost
 * (`docs/research/2026-10-04-acid-ladder-filter/saturator.mjs`, which
 * reads them). The coefficients are the numerator's and the denominator's
 * in powers of x², lowest first.
 *
 * `LADDER_DECIMATOR` is the 2× solver's decimation filter: taps over the
 * oversampled output, newest first, summing to 1. Three taps, its zero at
 * the oversampled rate's Nyquist: the aliasing reading found no decimator,
 * this one and a seven-tap half-band within 2 dB of each other, the
 * products that fold coming from above the oversampled rate. The voice
 * ships the 2× solver (`LADDER_OVERSAMPLE`, windsor#593), so every Acid
 * sample reads it; at 1× it would not be read.
 * `ladder.test.ts` pins the saturator against `Math.tanh`.
 */

interface LadderSaturator {
  /** x P(x²): P's coefficients, lowest power first. */
  numerator: readonly number[];
  /** Q(x²): Q's coefficients, lowest power first. */
  denominator: readonly number[];
  /** |x| from which the rational reaches 1 and is held there. */
  limit: number;
}

const LADDER_SATURATOR: LadderSaturator = {
  numerator: [135135, 17325, 378, 1],
  denominator: [135135, 62370, 3150, 28],
  limit: 4.971786858527593,
};

const LADDER_DECIMATOR: readonly number[] = [0.25, 0.5, 0.25];

export type { LadderSaturator };
export { LADDER_SATURATOR, LADDER_DECIMATOR };
