/**
 * The ensemble insert's tunables (#695): a Solina-style string ensemble —
 * three delay lines 120° apart, each swept by the sum of a slow and a fast
 * LFO. Rates in Hz, depths and the line centre in ms, `tone` in Hz. The
 * defaults are the ARP/Eminent Solina's (`ensemblePresetTables.ts` cites them).
 */
export const ENSEMBLE_NAME = 'ensemble';

export const ENSEMBLE_BOUNDS = {
  slowRate: [0.05, 2],
  slowDepth: [0, 4],
  fastRate: [2, 10],
  fastDepth: [0, 1],
  delay: [1, 20],
  tone: [1000, 20000],
  width: [0, 1],
  mix: [0, 1],
} as const;

/**
 * The Logan String Melody's slow : fast LFO mix, 79 : 21 (till-kopper.de, an
 * owner's teardown): a fast depth is the slow one × 21 / 79.
 */
export const ENSEMBLE_FAST_SHARE = 21 / 79;
/**
 * The ARP/Eminent Solina (and the Logan String Melody, the same TCA350 triple
 * chorus): the `solina` preset reads these. Stated — 0.6 and 6 Hz, the 12 kHz
 * second-order filter before the lines, no dry signal. Approximated — the
 * depths (no source gives a swing in ms: the Juno-60's measured ±1.85 ms is
 * the scale, scaled down for the Solina's "quite shallow depth") and the line
 * centre (no source gives the BBD clock). Width 1 is decision 8's, not the
 * hardware's: the original's output is mono, which is Width 0.
 * `docs/research/2026-09-25-695-ensemble.md` has each value's source.
 */
const SOLINA_SLOW_DEPTH_MS = 1.2;
export const ENSEMBLE_DEFAULTS = {
  slowRate: 0.6,
  slowDepth: SOLINA_SLOW_DEPTH_MS,
  fastRate: 6,
  fastDepth: Math.round(SOLINA_SLOW_DEPTH_MS * ENSEMBLE_FAST_SHARE * 100) / 100,
  delay: 5,
  tone: 12000,
  width: 1,
  mix: 1,
  enabled: true,
};

/**
 * Each line's LFO phase in degrees: three-phase, 120° apart, locked by
 * construction (a sine-and-cosine basis per rate, `ensembleInsert.ts`).
 */
export const ENSEMBLE_LINE_PHASES_DEG: readonly number[] = [0, 120, 240];
/** Each line's place at Width 1: left, centre, right; Width scales it toward the centre. */
export const ENSEMBLE_LINE_PANS: readonly number[] = [-1, 0, 1];

export const ENSEMBLE_DSP = {
  millisecondsPerSecond: 1000,
  degreesPerTurn: 360,
  /** An equal-power pan spans a quarter turn: gain L = cos θ, R = sin θ, θ ∈ [0, π/2]. */
  panQuarterTurn: Math.PI / 4,
  /** Butterworth: a linear Q of √½, which the Web Audio lowpass takes in dB. */
  toneQDb: 20 * Math.log10(Math.SQRT1_2),
  /** The line's reach: the centre ceiling plus both depth ceilings, in seconds. */
  delayMaxSeconds:
    (ENSEMBLE_BOUNDS.delay[1] + ENSEMBLE_BOUNDS.slowDepth[1] + ENSEMBLE_BOUNDS.fastDepth[1]) / 1000,
} as const;
