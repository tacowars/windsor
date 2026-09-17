/**
 * The grid card's step operations (#603), without the DOM: what each cell
 * does to a `GridSpec`'s step list, how the loop length grows the list, and
 * how a written degree is shown against the song's current scale. Every
 * function returns a new list; the card writes it through `ctx.change`, where
 * arrays replace wholesale.
 */
import type {
  ArrangementKey,
  GridNoteStep,
  GridStep,
  GridStepKind,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  foldDegree,
  gridNote,
  scaleOffsets,
} from '../../../packages/client/src/audio/index-for-editor';
import { NOTE_NAMES } from './dom';
import { GRID_RANDOM_FLAG_CHANCE, GRID_RANDOM_OCTAVE_SPAN } from './gridConstants';

export { GRID_STEPS_MAX, GRID_STEP_OCTAVE_MAX };

/** The top cell's cycle: a note becomes a tie, a tie a rest, a rest a note on the root. */
const NEXT_KIND: Record<GridStepKind, GridStepKind> = { note: 'tie', tie: 'rest', rest: 'note' };

export function cycleKind(step: GridStep): GridStep {
  const kind = NEXT_KIND[step.kind];
  return kind === 'note' ? gridNote() : { kind };
}

export function withStep(steps: readonly GridStep[], index: number, step: GridStep): GridStep[] {
  return steps.map((s, i) => (i === index ? step : s));
}

/** A note step edit; a rest or tie is returned unchanged. */
function editNote(step: GridStep, edit: (note: GridNoteStep) => GridNoteStep): GridStep {
  return step.kind === 'note' ? edit(step) : step;
}

export function setDegree(step: GridStep, degree: number): GridStep {
  return editNote(step, (note) => ({ ...note, degree: Math.max(0, Math.trunc(degree)) }));
}

/** Octave up or down by one, held within ±`GRID_STEP_OCTAVE_MAX`. */
export function cycleOctave(step: GridStep, direction: 1 | -1): GridStep {
  return editNote(step, (note) => ({
    ...note,
    octave: Math.max(
      -GRID_STEP_OCTAVE_MAX,
      Math.min(GRID_STEP_OCTAVE_MAX, note.octave + direction),
    ),
  }));
}

export function toggleFlag(step: GridStep, flag: 'accent' | 'slide'): GridStep {
  return editNote(step, (note) => ({ ...note, [flag]: !note[flag] }));
}

/**
 * The step list for a loop length: grown with root notes when the length
 * runs past it, never shortened — a step past the loop stays in the document
 * (greyed in the card) until the length reaches it again.
 */
export function stepsForLength(steps: readonly GridStep[], length: number): GridStep[] {
  const target = Math.max(1, Math.min(GRID_STEPS_MAX, Math.trunc(length)));
  if (target <= steps.length) return [...steps];
  return [...steps, ...Array.from({ length: target - steps.length }, () => gridNote())];
}

/**
 * The loop's steps turned `by` places — positive moves every step later, so
 * the last wraps to the front — with the steps past `length` left where they
 * are. The card's Rotate knob applies the difference since its last value, so
 * the document holds the rotated list and no offset.
 */
export function rotateSteps(steps: readonly GridStep[], by: number, length: number): GridStep[] {
  const n = Math.max(1, Math.min(Math.trunc(length), steps.length));
  const shift = ((Math.trunc(by) % n) + n) % n;
  if (shift === 0) return [...steps];
  const loop = steps.slice(0, n);
  const rotated = loop.map((_, i) => loop[(i - shift + n) % n] ?? loop[0]!);
  return [...rotated, ...steps.slice(n)];
}

/** A uniform draw in [0, 1); the card passes `Math.random`, a test passes its own. */
export type Draw = () => number;

/**
 * Randomize: every step a note with a degree from the current scale, an octave
 * within ±`GRID_RANDOM_OCTAVE_SPAN`, and accent and slide each at
 * `GRID_RANDOM_FLAG_CHANCE`. Four draws per step, in that order.
 */
export function randomSteps(count: number, degreeCount: number, draw: Draw): GridStep[] {
  const degrees = Math.max(1, Math.trunc(degreeCount));
  const span = GRID_RANDOM_OCTAVE_SPAN;
  return Array.from({ length: Math.max(1, Math.trunc(count)) }, () =>
    gridNote(Math.min(degrees - 1, Math.floor(draw() * degrees)), {
      octave: Math.min(span, Math.floor(draw() * (2 * span + 1)) - span),
      accent: draw() < GRID_RANDOM_FLAG_CHANCE,
      slide: draw() < GRID_RANDOM_FLAG_CHANCE,
    }),
  );
}

/** What the card watches to know its labels are stale: the root and the scale. */
export function keySignature(key: ArrangementKey): string {
  const scale = typeof key.scale === 'string' ? key.scale : key.scale.join(',');
  return `${key.root}|${scale}`;
}

/** A written degree against the current scale: where it lands, and whether it folded to get there. */
export interface FoldedDegree {
  degree: number;
  carry: number;
  folded: boolean;
}

export function foldedView(degree: number, key: ArrangementKey): FoldedDegree {
  const count = scaleOffsets(key.scale).length;
  const { degree: shown, carry } = foldDegree(degree, count);
  return { degree: shown, carry, folded: carry > 0 };
}

/** The degree picker's choices: every degree of the current scale, named from the root. */
export function degreeOptions(key: ArrangementKey): { value: string; label: string }[] {
  return scaleOffsets(key.scale).map((offset, i) => ({
    value: String(i),
    label: `${i + 1} ${NOTE_NAMES[(((key.root + offset) % 12) + 12) % 12] ?? '?'}`,
  }));
}

/** What a step's top cell reads: a rest, a tie, or the note name with its fold and octave. */
export function stepLabel(step: GridStep, key: ArrangementKey): string {
  if (step.kind === 'rest') return '·';
  if (step.kind === 'tie') return '—';
  const offsets = scaleOffsets(key.scale);
  const view = foldedView(step.degree, key);
  const name = NOTE_NAMES[(((key.root + (offsets[view.degree] ?? 0)) % 12) + 12) % 12] ?? '?';
  const octave = step.octave + view.carry;
  return octave === 0 ? name : `${name}${octave > 0 ? '+' : ''}${octave}`;
}
