/**
 * Step variation (windsor#935, record `2026-10-24-step-variation`; windsor#945,
 * record `2026-10-24-step-variation-velocity-and-chance`): the pure maths the
 * Grid and the Arp run to vary a step, and the check their configs run over
 * its five fields. The sequencers own what a step plays; this file owns the
 * draws and what they mean.
 *
 * - **The draws.** Whenever Randomness and Probability are both above 0,
 *   each step makes `STEP_VARIATION_DRAWS` draws from the part's variation
 *   stream, whatever it plays, so an edit to one step, any switch or either
 *   knob never moves another step's draws. At either amount 0 nothing is
 *   drawn.
 * - **The rolls against Chance.** With `chancePerEffect` off, the first draw
 *   decides: under Probability every effect varies at strength Randomness
 *   (`variationAt` hands back its draws), otherwise the step plays as
 *   written (null). With it on, the flip, velocity, pitch and gate each roll
 *   on a draw of their own, and an effect whose roll fails is left out of
 *   the step's draws, so it plays as written.
 * - **A normal value** is one uniform draw through the inverse normal CDF
 *   (`inverseNormalCdf`, Acklam's rational approximation), the draw first
 *   mapped into `[zTail, 1 − zTail]` (`boundedNormal`), so `|z|` stays under
 *   about 2.66: a bounded bell, never a rare far-out value.
 * - **What a varied step does with them** is in the helpers below: a
 *   velocity offset, up or down (`variedVelocity`), an octave shift (`octaveShift`,
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

/** The five per-part fields a Grid and an Arp carry. */
export interface StepVariationConfig {
  /** How far a varied step strays, 0–1. */
  readonly randomness: number;
  /** How often a step varies, 0–1. */
  readonly probability: number;
  /** Whether a varied step may flip between note and rest. */
  readonly restsSound: boolean;
  /** Whether a varied pitch moves by whole octaves of its own note rather than borrowing another's. */
  readonly octaveMode: boolean;
  /** Whether each effect rolls Probability on its own draw rather than one roll deciding them all (windsor#945). */
  readonly chancePerEffect: boolean;
}

/** The switches: each a boolean. */
const SWITCHES = ['restsSound', 'octaveMode', 'chancePerEffect'] as const;

/** Both amounts in 0–1 and every switch a boolean: what the normaliser makes a document meet. */
export function assertStepVariation(config: StepVariationConfig): void {
  for (const field of ['randomness', 'probability'] as const) {
    const value = config[field];
    if (!(value >= 0 && value <= 1)) {
      throw new RangeError(`${field} must be in [0, 1], got ${value}`);
    }
  }
  for (const field of SWITCHES) {
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

/**
 * Whether step variation can move a note's pitch on this config: both
 * amounts above 0, so a varied step borrows another step's pitch (Octave
 * off) or moves by octaves (Octave on). The console reads it to tell a
 * slide whose pitches are written from one the run may move or meet.
 */
export function variationMovesPitch(
  config: Pick<StepVariationConfig, 'randomness' | 'probability'>,
): boolean {
  return config.randomness > 0 && config.probability > 0;
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

/**
 * One varied step's draws: the flip's uniform value and three normal values,
 * each absent where that effect's roll failed (`chancePerEffect` on), so it
 * plays as written.
 */
export interface StepDraw {
  readonly flip?: number | undefined;
  readonly velocity?: number | undefined;
  readonly pitch?: number | undefined;
  readonly gate?: number | undefined;
}

/**
 * One step's draws. Both amounts above 0: the step draws its fixed set, in
 * `STEP_VARIATION_DRAWS`'s order, and hands back what varies. With
 * `chancePerEffect` off that is every value when the first draw fell under
 * Probability; with it on, each value whose own roll did (the flip's is the
 * first draw). Null when nothing varies; either amount 0 draws nothing, and
 * null.
 */
export function variationAt(
  rng: Rng,
  config: Pick<StepVariationConfig, 'randomness' | 'probability' | 'chancePerEffect'>,
  table: StepVariationTable = STEP_VARIATION_TABLE,
): StepDraw | null {
  if (!(config.randomness > 0 && config.probability > 0)) return null;
  const passes = (u: number): boolean => u < config.probability;
  const first = passes(rng());
  const flip = rng();
  const velocity = boundedNormal(rng(), table.zTail);
  const pitch = boundedNormal(rng(), table.zTail);
  const gate = boundedNormal(rng(), table.zTail);
  const rolls = { velocity: passes(rng()), pitch: passes(rng()), gate: passes(rng()) };
  if (!config.chancePerEffect) return first ? { flip, velocity, pitch, gate } : null;
  if (!(first || rolls.velocity || rolls.pitch || rolls.gate)) return null;
  return {
    flip: first ? flip : undefined,
    velocity: rolls.velocity ? velocity : undefined,
    pitch: rolls.pitch ? pitch : undefined,
    gate: rolls.gate ? gate : undefined,
  };
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
  if (!config.restsSound || draw.flip === undefined) return false;
  const onBeat = ((localStep % table.onBeatEvery) + table.onBeatEvery) % table.onBeatEvery === 0;
  return draw.flip < (onBeat ? table.flipOnbeat : table.flipOffbeat) * config.randomness;
}

/**
 * A varied step's velocity offset, in the part's velocity units, up or down:
 * `z × velocitySigma × randomness`; undefined at 0 or where velocity's roll
 * failed. The part adds it to its velocity and holds the sum in
 * `[velocityFloor, 1]` (`partNoteOn`).
 */
export function variedVelocity(
  draw: StepDraw,
  randomness: number,
  table: StepVariationTable = STEP_VARIATION_TABLE,
): number | undefined {
  if (draw.velocity === undefined) return undefined;
  return draw.velocity * table.velocitySigma * randomness || undefined;
}

/** With Octave on, the whole octaves a varied pitch moves by: `z × octaveSigma × randomness`, rounded; 0 where pitch's roll failed. */
export function octaveShift(
  draw: StepDraw,
  randomness: number,
  table: StepVariationTable = STEP_VARIATION_TABLE,
): number {
  return roundSymmetric((draw.pitch ?? 0) * table.octaveSigma * randomness);
}

/** `note` moved by `octaves`, or by the nearest number of octaves that keeps it inside MIDI 0–`max`. */
export function shiftOctaveWithin(note: number, octaves: number, max = MIDI_NOTE_MAX): number {
  const lowest = Math.ceil(-note / SEMITONES_PER_OCTAVE);
  const highest = Math.floor((max - note) / SEMITONES_PER_OCTAVE);
  return note + clamp(octaves, lowest, highest) * SEMITONES_PER_OCTAVE;
}

/**
 * With Octave off, how many places along a line of `count` a varied pitch
 * borrows from: `z × sigma × count × randomness`, rounded; 0 where pitch's
 * roll failed. `sigma` is the Grid's `stepJumpSigma` or the Arp's
 * `listJumpSigma`.
 */
export function jumpOffset(
  draw: StepDraw,
  randomness: number,
  count: number,
  sigma: number,
): number {
  return roundSymmetric((draw.pitch ?? 0) * sigma * count * randomness);
}

/** A varied Arp gate: `gate + z × gateSigma × randomness` within `[floor, 1]`; `gate` itself where gate's roll failed. */
export function variedGate(
  gate: number,
  draw: StepDraw,
  randomness: number,
  table: StepVariationTable = STEP_VARIATION_TABLE,
  floor = GATE_MIN,
): number {
  if (draw.gate === undefined) return gate;
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
