/**
 * Step variation's tunables (windsor#935, record `2026-10-24-step-variation`):
 * how far a varied Grid step or Arp onset strays at full Randomness, how
 * often a beat flips with Rests sound on, and the bound on a normal draw.
 * They are values for tacowars to listen to, not settled ones. The logic is
 * `stepVariation.ts`, which takes this table as a parameter defaulting to it.
 */

export interface StepVariationTable {
  /** The velocity offset's σ at Randomness 1, as a fraction of the step's velocity. */
  readonly velocitySigma: number;
  /** The quietest a varied step plays: a varied note never goes silent. */
  readonly velocityFloor: number;
  /** The Grid's pitch borrow: σ of the step offset at Randomness 1, per step of the loop's length. */
  readonly stepJumpSigma: number;
  /** The Arp's pitch borrow: σ of the list offset at Randomness 1, per note of the list. */
  readonly listJumpSigma: number;
  /** The Arp's gate offset's σ at Randomness 1, in fractions of the step. */
  readonly gateSigma: number;
  /** With Rests sound on, the chance at Randomness 1 that an off-beat step flips between note and rest. */
  readonly flipOffbeat: number;
  /** The same on a beat: a step whose local step is a multiple of `onBeatEvery`. */
  readonly flipOnbeat: number;
  /** Steps per beat for the flip: every `onBeatEvery`-th local step is on the beat. */
  readonly onBeatEvery: number;
  /** With Octave on, σ of the octave shift at Randomness 1, in octaves. */
  readonly octaveSigma: number;
  /**
   * The uniform draw behind a normal value is mapped into
   * `[zTail, 1 − zTail]` before the inverse normal CDF, so `|z|` stays under
   * about 2.66 at 1/254: a bounded bell with no rare far-out value.
   */
  readonly zTail: number;
}

export const STEP_VARIATION_TABLE: StepVariationTable = {
  velocitySigma: 0.2,
  velocityFloor: 0.05,
  stepJumpSigma: 0.2,
  listJumpSigma: 0.25,
  gateSigma: 0.25,
  flipOffbeat: 0.5,
  flipOnbeat: 0.25,
  onBeatEvery: 4,
  octaveSigma: 1,
  zTail: 1 / 254,
};

/** The four per-part fields, as a new Grid or Arp starts: nothing varies. */
export const STEP_VARIATION_DEFAULTS = {
  randomness: 0,
  probability: 0,
  restsSound: false,
  octaveMode: false,
} as const;

/**
 * The inverse normal CDF's coefficients: P. J. Acklam, "An algorithm for
 * computing the inverse normal cumulative distribution function" (2003),
 * a rational approximation with relative error under 1.15e-9. `a` and `b`
 * are the central region's numerator and denominator, `c` and `d` the tails',
 * and `low` is where the tails begin.
 */
export const INVERSE_NORMAL_COEFFICIENTS = {
  a: [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ],
  b: [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ],
  c: [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ],
  d: [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416],
  low: 0.02425,
} as const;

/** Draws a step makes whenever Randomness and Probability are both above 0, whatever it plays. */
export const STEP_VARIATION_DRAWS = 5;
