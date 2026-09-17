/**
 * The Euclidean card's operations (#610), without the DOM: the partial a
 * Steps turn sends (with every field the new `n` bounds carried along, so a
 * turn never lands in the engine's refusal), a pulse-bound turn that keeps
 * `min ≤ start ≤ max` inside the figure, a Rotate turn held within `±n`, the
 * cell toggle that freezes a figure, and the figure the strip previews when
 * no player holds one. Every function returns data; the card writes it
 * through `ctx.change`, where a `pattern` array replaces wholesale.
 */
import type { EuclideanSpec } from '../../../packages/client/src/audio/index-for-editor';
import {
  EUCLID_STEPS_MAX,
  PPQ,
  euclid,
  patternToString,
} from '../../../packages/client/src/audio/index-for-editor';

export { EUCLID_STEPS_MAX };

export type Figure = readonly boolean[];
export type PulseField = 'min' | 'max' | 'start';
export type Pulses = Readonly<Record<PulseField, number>>;

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/** A figure cut or padded with rests to `n` steps — the normaliser's own resize rule. */
function resize(figure: Figure, n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => figure[i] ?? false);
}

/**
 * The sequencer partial a Steps turn sends: `steps`, plus only the fields
 * the new `n` forces to move — the pulse bounds above it, a rotation past
 * it, a captured figure of the old length.
 */
export function stepsChange(spec: EuclideanSpec, steps: number): Record<string, unknown> {
  const n = clampInt(steps, 1, EUCLID_STEPS_MAX);
  const partial: Record<string, unknown> = { steps: n };
  const { min, max, start } = spec.pulses;
  const pulses = { min: Math.min(min, n), max: Math.min(max, n), start: Math.min(start, n) };
  if (pulses.min !== min || pulses.max !== max || pulses.start !== start) partial.pulses = pulses;
  const rotate = rotateChange({ ...spec, steps: n }, spec.rotate);
  if (rotate !== spec.rotate) partial.rotate = rotate;
  if (spec.pattern && spec.pattern.length !== n) partial.pattern = resize(spec.pattern, n);
  return partial;
}

/**
 * One pulse bound turned: the field clamped into the figure, the other bound
 * dragged along so `min ≤ max` holds, and `start` held between them.
 */
export function pulsesChange(spec: EuclideanSpec, field: PulseField, value: number): Pulses {
  const v = clampInt(value, 0, spec.steps);
  let { min, max, start } = spec.pulses;
  if (field === 'min') {
    min = v;
    max = Math.max(max, v);
  } else if (field === 'max') {
    max = v;
    min = Math.min(min, v);
  } else {
    start = v;
  }
  return { min, max, start: Math.max(min, Math.min(max, start)) };
}

/** A Rotate turn held within `±steps`, the normaliser's bound, so the live figure and the document agree. */
export function rotateChange(spec: Pick<EuclideanSpec, 'steps'>, rotate: number): number {
  return clampInt(rotate, -spec.steps, spec.steps);
}

/** The figure with one step flipped: what a cell click freezes into the document. */
export function toggleStep(figure: Figure, index: number): boolean[] {
  return figure.map((on, i) => (i === index ? !on : on));
}

/** What the strip shows with no live figure: the captured pattern, else `E(start, n)` rotated. */
export function previewFigure(spec: EuclideanSpec): Figure {
  if (spec.pattern) return spec.pattern;
  return euclid(Math.min(spec.pulses.start, spec.steps), spec.steps, spec.rotate);
}

export const countOnsets = (figure: Figure): number => figure.filter(Boolean).length;

/** The strip's change key — the figure as `x.` text; the card repaints only when it differs. */
export const figureKey = patternToString;

/** The step the playhead sits on for an audible tick. */
export function playheadStep(audibleTick: number, divisor: number, steps: number): number {
  return Math.floor(audibleTick / divisor) % steps;
}

/** Steps per beat, for the strip's grouping gap; 0 when the step does not divide the beat. */
export function stepsPerBeat(divisor: number): number {
  return divisor > 0 && PPQ % divisor === 0 ? PPQ / divisor : 0;
}
