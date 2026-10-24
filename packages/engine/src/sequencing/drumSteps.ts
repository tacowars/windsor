/**
 * The Drum's step (windsor#948, record `2026-10-24-drum-sequencer`
 * decision 3): a rest, or a hit with its own velocity, accent, pitch offset
 * and ratchet. No tie and no slide: a hit's length is the part's gate. The
 * type, its defaults and the check the Drum's config runs over each step;
 * `drumSequencer.ts` plays them.
 */
import { DRUM_DEFAULT_HITS, DRUM_PITCH_MAX } from './drumConstants';
import { assertRatchet } from './gridSequencer';
import { defaultStepCount } from './meter';
import type { Meter } from './meterTables';
import { DIVISORS } from './scheduler';

export interface DrumHitStep {
  readonly kind: 'hit';
  /** Scales the part's velocity, 0–1; absent is 1. A ghost note is a low value. */
  readonly velocity?: number;
  readonly accent: boolean;
  /** Whole semitones added to the part's `note`, ±`DRUM_PITCH_MAX`; absent is 0. */
  readonly pitch?: number;
  /** Hits the step's roll plays, 1 to `RATCHET_MAX` (`audioConstants.ts`); absent is one. */
  readonly ratchet?: number;
}

export type DrumStep = { readonly kind: 'rest' } | DrumHitStep;

export const DRUM_STEP_KINDS = ['rest', 'hit'] as const;
export type DrumStepKind = (typeof DRUM_STEP_KINDS)[number];

export const DRUM_REST: DrumStep = { kind: 'rest' };

/** A hit at full velocity, unaccented, on the part's note, one hit; `over` writes its fields. */
export function drumHit(over: Partial<Omit<DrumHitStep, 'kind'>> = {}): DrumHitStep {
  return { kind: 'hit', accent: false, ...over };
}

/**
 * The line a part starts with when its kind becomes `drum`: a bar of
 * sixteenths in the song's meter (16 in 4/4), rests but for hits on
 * `hits` that fall inside it.
 */
export function defaultDrumSteps(
  meter?: Meter,
  hits: readonly number[] = DRUM_DEFAULT_HITS,
): DrumStep[] {
  const count = defaultStepCount(meter, DIVISORS.sixteenth);
  return Array.from({ length: count }, (_, i) => (hits.includes(i) ? drumHit() : DRUM_REST));
}

/** One step: a known kind, and a hit's velocity, pitch and ratchet in range. */
export function assertDrumStep(step: DrumStep, index: number, pitchMax = DRUM_PITCH_MAX): void {
  const at = `steps[${index}]`;
  if (!(DRUM_STEP_KINDS as readonly string[]).includes(step.kind)) {
    throw new RangeError(`${at}.kind must be one of ${DRUM_STEP_KINDS.join('|')}`);
  }
  if (step.kind !== 'hit') return;
  const { velocity, pitch, ratchet } = step;
  if (velocity !== undefined && !(velocity >= 0 && velocity <= 1)) {
    throw new RangeError(`${at}.velocity must be in [0, 1], got ${velocity}`);
  }
  if (pitch !== undefined && !(Number.isInteger(pitch) && Math.abs(pitch) <= pitchMax)) {
    throw new RangeError(`${at}.pitch must be an integer within ±${pitchMax}, got ${pitch}`);
  }
  assertRatchet(ratchet, at);
}
