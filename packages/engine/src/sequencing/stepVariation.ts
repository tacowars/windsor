/**
 * Step variation (windsor#935, record `2026-10-24-step-variation`): the pure
 * maths the Grid and the Arp run to vary a step, and the check their configs
 * run over its four fields. The sequencers own what a step plays; this file
 * owns the draws and what they mean.
 *
 * - **The draws.** Whenever Randomness and Probability are both above 0,
 *   each step makes `STEP_VARIATION_DRAWS` draws from the part's variation
 *   stream, whatever it plays, so an edit to one step, either switch or
 *   either knob never moves another step's draws. At either amount 0 nothing
 *   is drawn.
 * - **The gate.** The first draw: under Probability the step varies at
 *   strength Randomness (`variationAt` hands back its draws), otherwise it
 *   plays as written (null).
 * - **A normal value** is one uniform draw through the inverse normal CDF
 *   (`inverseNormalCdf`, Acklam's rational approximation), the draw first
 *   mapped into `[zTail, 1 − zTail]` (`boundedNormal`), so `|z|` stays under
 *   about 2.66: a bounded bell, never a rare far-out value.
 * - **What a varied step does with them** is in the helpers below: a
 *   velocity under 1 (`variedVelocity`), an octave shift (`octaveShift`,
 *   `shiftOctaveWithin`), a borrow offset (`jumpOffset`), a gate
 *   (`variedGate`) and, with Rests sound on, a flip between note and rest
 *   (`flips`).
 *
 * Pure: no clock, no graph. `generatorBoundary.test.ts` holds it there.
 */
import { GATE_MIN, MIDI_NOTE_MAX } from '../audioConstants';
import type { Rng } from './generatorSeed';
import { SEMITONES_PER_OCTAVE } from './scaleSampler';
import {
  INVERSE_NORMAL_COEFFICIENTS,
  STEP_VARIATION_TABLE,
  type StepVariationTable,
} from './stepVariationConstants';

/** The four per-part fields a Grid and an Arp carry. */
export interface StepVariationConfig {
  /** How far a varied step strays, 0–1. */
  readonly randomness: number;
  /** How often a step varies, 0–1. */
  readonly probability: number;
  /** Whether a varied step may flip between note and rest. */
  readonly restsSound: boolean;
  /** Whether a varied pitch moves by whole octaves of its own note rather than borrowing another's. */
  readonly octaveMode: boolean;
}

/** Both amounts in 0–1 and both switches booleans: what the normaliser makes a document meet. */
export function assertStepVariation(config: StepVariationConfig): void {
  for (const field of ['randomness', 'probability'] as const) {
    const value = config[field];
    if (!(value >= 0 && value <= 1)) {
      throw new RangeError(`${field} must be in [0, 1], got ${value}`);
    }
  }
  for (const field of ['restsSound', 'octaveMode'] as const) {
    if (typeof config[field] !== 'boolean') throw new RangeError(`${field} must be a boolean`);
  }
}

/**
 * Whether step variation can silence a note on this config: Rests sound on
 * and both amounts above 0. The console reads it to tell a slide's certain
 * hold from one a flipped rest may break.
 */
export function variationFlipsRests(
  config: Pick<StepVariationConfig, 'randomness' | 'probability' | 'restsSound'>,
): boolean {
  return config.restsSound && config.randomness > 0 && config.probability > 0;
}

type Coefficients = typeof INVERSE_NORMAL_COEFFICIENTS;

/** A polynomial's value at `x`, its coefficients highest power first (Horner). */
const poly = (coefficients: readonly number[], x: number): number =>
  coefficients.reduce((sum, c) => sum * x + c, 0);

/**
 * Φ⁻¹(p) for `p` in (0, 1): P. J. Acklam's rational approximation, "An
 * algorithm for computing the inverse normal cumulative distribution
 * function" (2003), central region and tails as published.
 */
export function inverseNormalCdf(p: number, k: Coefficients = INVERSE_NORMAL_COEFFICIENTS): number {
  if (p < k.low) {
    const q = Math.sqrt(-(2 * Math.log(p)));
    return poly(k.c, q) / (poly(k.d, q) * q + 1);
  }
  if (p > 1 - k.low) {
    const q = Math.sqrt(-(2 * Math.log(1 - p)));
    return -poly(k.c, q) / (poly(k.d, q) * q + 1);
  }
  const q = p - 1 / 2;
  const r = q * q;
  return (poly(k.a, r) * q) / (poly(k.b, r) * r + 1);
}

/** A uniform draw in [0, 1) as a normal value bounded by the tail: `u` mapped into `[tail, 1 − tail]` first. */
export function boundedNormal(u: number, tail = STEP_VARIATION_TABLE.zTail): number {
  return inverseNormalCdf(tail + u * (1 - 2 * tail));
}

/** One varied step's draws: the flip's uniform value and three normal values. */
export interface StepDraw {
  readonly flip: number;
  readonly velocity: number;
  readonly pitch: number;
  readonly gate: number;
}

/**
 * One step's draws. Both amounts above 0: the step draws its fixed set and
 * hands back its draws when the first fell under Probability, null when it
 * plays as written. Either amount 0: nothing is drawn, and null.
 */
export function variationAt(
  rng: Rng,
  config: Pick<StepVariationConfig, 'randomness' | 'probability'>,
  table: StepVariationTable = STEP_VARIATION_TABLE,
): StepDraw | null {
  if (!(config.randomness > 0 && config.probability > 0)) return null;
  const varies = rng() < config.probability;
  const flip = rng();
  const velocity = boundedNormal(rng(), table.zTail);
  const pitch = boundedNormal(rng(), table.zTail);
  const gate = boundedNormal(rng(), table.zTail);
  return varies ? { flip, velocity, pitch, gate } : null;
}

/** `x` rounded to the nearest whole, halves away from 0, so a shift up and one down are mirror images. */
const roundSymmetric = (x: number): number => Math.sign(x) * Math.round(Math.abs(x)) || 0;

/** `x` held inside `[low, high]`. */
const clamp = (x: number, low: number, high: number): number => Math.min(high, Math.max(low, x));

/**
 * With Rests sound on, whether a varied step flips between note and rest:
 * a beat (a local step that is a multiple of `onBeatEvery`) at
 * `flipOnbeat × randomness`, any other step at `flipOffbeat × randomness`.
 */
export function flips(
  draw: StepDraw,
  config: Pick<StepVariationConfig, 'randomness' | 'restsSound'>,
  localStep: number,
  table: StepVariationTable = STEP_VARIATION_TABLE,
): boolean {
  if (!config.restsSound) return false;
  const onBeat = ((localStep % table.onBeatEvery) + table.onBeatEvery) % table.onBeatEvery === 0;
  return draw.flip < (onBeat ? table.flipOnbeat : table.flipOffbeat) * config.randomness;
}

/** A varied step's velocity, a fraction of the part's: `1 + z·σ` within `[velocityFloor, 1]`; undefined at 1. */
export function variedVelocity(
  draw: StepDraw,
  randomness: number,
  table: StepVariationTable = STEP_VARIATION_TABLE,
): number | undefined {
  const velocity = clamp(
    1 + draw.velocity * table.velocitySigma * randomness,
    table.velocityFloor,
    1,
  );
  return velocity < 1 ? velocity : undefined;
}

/** With Octave on, the whole octaves a varied pitch moves by: `z × octaveSigma × randomness`, rounded. */
export function octaveShift(
  draw: StepDraw,
  randomness: number,
  table: StepVariationTable = STEP_VARIATION_TABLE,
): number {
  return roundSymmetric(draw.pitch * table.octaveSigma * randomness);
}

/** `note` moved by `octaves`, or by the nearest number of octaves that keeps it inside MIDI 0–`max`. */
export function shiftOctaveWithin(note: number, octaves: number, max = MIDI_NOTE_MAX): number {
  const lowest = Math.ceil(-note / SEMITONES_PER_OCTAVE);
  const highest = Math.floor((max - note) / SEMITONES_PER_OCTAVE);
  return note + clamp(octaves, lowest, highest) * SEMITONES_PER_OCTAVE;
}

/**
 * With Octave off, how many places along a line of `count` a varied pitch
 * borrows from: `z × sigma × count × randomness`, rounded. `sigma` is the
 * Grid's `stepJumpSigma` or the Arp's `listJumpSigma`.
 */
export function jumpOffset(
  draw: StepDraw,
  randomness: number,
  count: number,
  sigma: number,
): number {
  return roundSymmetric(draw.pitch * sigma * count * randomness);
}

/** A varied Arp gate: `gate + z × gateSigma × randomness` within `[floor, 1]`. */
export function variedGate(
  gate: number,
  draw: StepDraw,
  randomness: number,
  table: StepVariationTable = STEP_VARIATION_TABLE,
  floor = GATE_MIN,
): number {
  return clamp(gate + draw.gate * table.gateSigma * randomness, floor, 1);
}

/** `i` wrapped onto `0..length − 1`. */
export function wrapIndex(i: number, length: number): number {
  return ((i % length) + length) % length;
}

/**
 * The index nearest `from` (wrapped over `length`) whose step passes `test`,
 * looking out both ways, earlier first at a tie; −1 when none does.
 */
export function nearestIndex(from: number, length: number, test: (i: number) => boolean): number {
  for (let d = 0; d <= length / 2; d++) {
    const before = wrapIndex(from - d, length);
    if (test(before)) return before;
    const after = wrapIndex(from + d, length);
    if (test(after)) return after;
  }
  return -1;
}
