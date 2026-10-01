/**
 * The Euclid card's Play steppers (windsor#356, the mockup's value boxes):
 * Note, Steps and Rotate, moved one press at a time. Each press returns the
 * fields it writes, through the same model functions the knobs wrote
 * through (`stepsChange`, `rotateChange`), or null at a limit, where it
 * writes nothing. Pure: the card's box draws the value and sends the write.
 */
import type { EuclideanSpec } from '@windsor/engine';
import { noteName } from './consoleFormat';
import type { RowFields } from './euclidLaneModel';
import { EUCLID_STEPS_MAX, rotateChange, stepsChange } from './euclidModel';
import { type CardKnobSpec, EUCLID_NOTE_STEPPER } from './sequencerKnobTables';

/** A press: one step down (-1) or up (+1). */
export type StepDelta = -1 | 1;

/** One stepper's reading and its presses. */
export interface StepperModel {
  /** The value as the box reads it. */
  text(spec: EuclideanSpec): string;
  /** The fields a press writes, or null where the press is at a limit. */
  step(spec: EuclideanSpec, delta: StepDelta): RowFields | null;
}

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/** The note as name and number: `D3 · 50`. */
export const noteText = (note: number): string => `${noteName(note)} · ${note}`;

/** One semitone, held within the note range (0–127). */
export function noteStep(
  spec: EuclideanSpec,
  delta: StepDelta,
  range: Pick<CardKnobSpec, 'min' | 'max'> = EUCLID_NOTE_STEPPER,
): RowFields | null {
  const note = clampInt(spec.note + delta, range.min, range.max);
  return note === spec.note ? null : { note };
}

/** One step more or fewer, 1 to `EUCLID_STEPS_MAX`, carrying the k bounds and ratchets as a Steps turn does. */
export function stepsStep(spec: EuclideanSpec, delta: StepDelta): RowFields | null {
  const steps = clampInt(spec.steps + delta, 1, EUCLID_STEPS_MAX);
  return steps === spec.steps ? null : stepsChange(spec, steps);
}

/** One step of rotation, wrapping within the steps: `0` down is `steps − 1`, `steps − 1` up is `0`. */
export function rotateStep(spec: EuclideanSpec, delta: StepDelta): RowFields | null {
  const n = spec.steps;
  const rotate = rotateChange(spec, (((spec.rotate + delta) % n) + n) % n);
  return rotate === spec.rotate ? null : { rotate };
}

/** The three steppers, in the Play row's order. */
export const EUCLID_STEPPERS = {
  note: { text: (spec) => noteText(spec.note), step: noteStep },
  steps: { text: (spec) => String(spec.steps), step: stepsStep },
  rotate: { text: (spec) => String(spec.rotate), step: rotateStep },
} as const satisfies Record<string, StepperModel>;
