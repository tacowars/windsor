/**
 * The Transient insert's tunables (record `2026-10-18-transient-insert`): a
 * transient shaper with no threshold, whose Attack and Sustain reshape every
 * hit by the envelope difference of its followers, whatever the hit's level.
 * Read by the main thread (spec, card, automation) and by
 * `worklet/transient/`, so it imports nothing that reaches the rest of the
 * engine. The followers' timing is a table of its own (`transientTables.ts`).
 */
import { exp2 } from './tapePortableMath';

/** The processor's registered name. */
export const TRANSIENT_NAME = 'transient-insert';

/**
 * The continuous fields (decision 2): the spec's ranges, the automation
 * rows' and the knobs', all linear. Attack, Sustain and Output are the
 * reference's ranges; Mix is Windsor's, for parallel use.
 */
export const TRANSIENT_BOUNDS = {
  /** dB at a hit's front, at full onset shape. */
  attack: [-15, 15],
  /** dB on a hit's decay, at full sustain shape. */
  sustain: [-24, 24],
  /** dB after the shaping, on wet and dry alike. */
  output: [-20, 6],
  /** 0 is the input, 1 the shaped signal. */
  mix: [0, 1],
} as const;

export const TRANSIENT_DEFAULTS = {
  attack: 0,
  sustain: 0,
  output: 0,
  mix: 1,
} as const;

/** log2(10) / 20: a dB value times this is the base-2 exponent of its gain. */
const DB_TO_LOG2 = 0.16609640474436813;

export const TRANSIENT_DSP = {
  dbToLog2: DB_TO_LOG2,
  /** log2(e): a one-pole's `exp(−1/n)` is `2^(−log2(e)/n)`. */
  log2E: 1.4426950408889634,
  msToSeconds: 0.001,
  /** The controls' one-pole (decision 6), Advanced Drive's 20 ms. */
  smoothMs: 20,
  /** A smoothed control this close to its target lands on it, so neutral is exact (decision 7). */
  settle: 1e-12,
  /** A switch param's value at and above which it reads as on. */
  switchOn: 0.5,
  /** How often the open card is told the window's largest boost and cut: the compressor's rate. */
  meterHz: 30,
  /** The card's meter reads ±this many dB. */
  meterCeilingDb: 24,
} as const;

/** The most the shaping and the Output can lift a sample, in dB: +15 + 24 + 6. */
export const TRANSIENT_WORST_GAIN_DB =
  TRANSIENT_BOUNDS.attack[1] + TRANSIENT_BOUNDS.sustain[1] + TRANSIENT_BOUNDS.output[1];

/** The plate's input floor (windsor#793), before the gain after it. */
const SLEEP_INPUT_FLOOR = 1e-9;

/**
 * Sleep (decision 8, the compressor's pattern, windsor#793). The worklet
 * rules' floor scaled by the worst-case gain after it: an input sample within
 * `floor` of 0 is silence, and the floor is the plate's 1e-9 divided by the
 * +45 dB the shaping and the Output can add, so a quiet input they would lift
 * into hearing keeps the insert awake. The followers' shapes are 0 under the
 * same floor, so a sleeping insert and one that never slept play the same
 * gain, exactly 1, over a silent block. Worked out in portable arithmetic
 * (`tapePortableMath.ts`), so the floor is the same bits on every platform.
 */
export const TRANSIENT_SLEEP = {
  floor: SLEEP_INPUT_FLOOR / exp2(TRANSIENT_WORST_GAIN_DB * DB_TO_LOG2),
} as const;
