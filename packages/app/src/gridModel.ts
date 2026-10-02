/**
 * The grid card's step operations (#603), without the DOM: what each cell
 * does to a `GridSpec`'s step list, how the loop length grows the list, and
 * how a written degree is shown against the song's current scale. Every
 * function returns a new list; the card writes it through `ctx.change`, where
 * arrays replace wholesale.
 */
import type {
  GridNoteStep,
  GridSpec,
  GridStep,
  GridStepKind,
  Harmony,
  StepModLane,
} from '@windsor/engine';
import {
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  SEMITONES_PER_OCTAVE,
  foldDegree,
  gridNote,
  pitchClassName,
  scaleOffsets,
} from '@windsor/engine';
import { GRID_RANDOM_FLAG_CHANCE, GRID_RANDOM_OCTAVE_SPAN } from './gridConstants';
import type { StepSlide } from './stepModLaneModel';

export { GRID_STEPS_MAX, GRID_STEP_OCTAVE_MAX };

/**
 * What the cell operations below need of a note: its octave and its two
 * flags. A grid step has them, and so does an arp cell, which has no degree
 * (windsor#137), so the two cards share one set of operations.
 */
export interface NoteCell {
  readonly kind: 'note';
  readonly octave: number;
  readonly accent: boolean;
  readonly slide: boolean;
}

/** A rest, a tie or a note: a `GridStep` when `N` is the grid's note, an `ArpStep` when the arp's. */
export type Cell<N extends NoteCell> = { readonly kind: 'rest' } | { readonly kind: 'tie' } | N;

/** The top cell's cycle: a note becomes a tie, a tie a rest, a rest a fresh note. */
const NEXT_KIND: Record<GridStepKind, GridStepKind> = { note: 'tie', tie: 'rest', rest: 'note' };

/** The next kind. A rest becomes `note()`: the grid's root note, or the note a card names. */
export function cycleKind(step: GridStep): GridStep;
export function cycleKind<N extends NoteCell>(step: Cell<N>, note: () => N): Cell<N>;
export function cycleKind(step: Cell<NoteCell>, note: () => NoteCell = gridNote): Cell<NoteCell> {
  const kind = NEXT_KIND[step.kind];
  return kind === 'note' ? note() : { kind };
}

/** The list with step `index` replaced: a grid step list, or any other card's cells. */
export function withStep(steps: readonly GridStep[], index: number, step: GridStep): GridStep[];
export function withStep<T>(steps: readonly T[], index: number, step: T): T[];
export function withStep<T>(steps: readonly T[], index: number, step: T): T[] {
  return steps.map((s, i) => (i === index ? step : s));
}

/** A note step edit; a rest or tie is returned unchanged. */
function editNote<N extends NoteCell>(step: Cell<N>, edit: (note: N) => N): Cell<N> {
  return step.kind === 'note' ? edit(step) : step;
}

export function setDegree(step: GridStep, degree: number): GridStep {
  return editNote(step, (note) => ({ ...note, degree: Math.max(0, Math.trunc(degree)) }));
}

/** Octave up or down by one, held within ±`GRID_STEP_OCTAVE_MAX`. */
export function cycleOctave<N extends NoteCell>(step: Cell<N>, direction: 1 | -1): Cell<N> {
  return editNote(step, (note) => ({
    ...note,
    octave: Math.max(
      -GRID_STEP_OCTAVE_MAX,
      Math.min(GRID_STEP_OCTAVE_MAX, note.octave + direction),
    ),
  }));
}

export function toggleFlag<N extends NoteCell>(step: Cell<N>, flag: 'accent' | 'slide'): Cell<N> {
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
export function rotateSteps<T>(steps: readonly T[], by: number, length: number): T[] {
  const n = Math.max(1, Math.min(Math.trunc(length), steps.length));
  const shift = ((Math.trunc(by) % n) + n) % n;
  if (shift === 0) return [...steps];
  const loop = steps.slice(0, n);
  const rotated = loop.map((_, i) => loop[(i - shift + n) % n] ?? loop[0]!);
  return [...rotated, ...steps.slice(n)];
}

/**
 * The modulation lanes turned with the steps (windsor#31): a lane value
 * belongs to its step, like a parameter lock, so Rotate carries it along.
 */
export function rotateLanes(
  lanes: readonly StepModLane[],
  by: number,
  length: number,
): StepModLane[] {
  return lanes.map((lane) => ({ ...lane, values: rotateSteps(lane.values, by, length) }));
}

/** The pattern Rotate turns: the loop length, its steps and their lanes. */
type GridTurnable = Pick<GridSpec, 'length' | 'steps' | 'lanes'>;

/** The Rotate knob after a move: its new value, and the write the move makes (null when nothing turns). */
export interface GridTurn {
  turned: number;
  change: { steps: GridStep[]; lanes: StepModLane[] } | null;
}

/**
 * The Rotate knob's move from `turned` to `target`, as the Basslead's
 * `turnBass`: the difference, turned over the pattern the document holds
 * now, ratchets and lane values with their steps. `turned` is an offset
 * from the pattern the knob last turned, so Length and Randomize, which
 * replace that pattern, rebase it to `GRID_TURN_REBASED`: back at zero then
 * means the new pattern as it stands, not a turn back over steps it never
 * held.
 */
export function turnGrid(spec: GridTurnable, turned: number, target: number): GridTurn {
  const to = Math.round(target);
  const by = to - turned;
  if (by === 0) return { turned: to, change: null };
  return {
    turned: to,
    change: {
      steps: rotateSteps(spec.steps, by, spec.length),
      lanes: rotateLanes(spec.lanes, by, spec.length),
    },
  };
}

/** Rotate's value once Length or Randomize has replaced the pattern it turned. */
export const GRID_TURN_REBASED = 0;

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
/** Root and scale only: the events are the timeline's, and relabelling a degree needs neither. */
export type Key = Pick<Harmony, 'root' | 'scale'>;

export function keySignature(key: Key): string {
  const scale = typeof key.scale === 'string' ? key.scale : key.scale.join(',');
  return `${key.root}|${scale}`;
}

/** A written degree against the current scale: where it lands, and whether it folded to get there. */
export interface FoldedDegree {
  degree: number;
  carry: number;
  folded: boolean;
}

export function foldedView(degree: number, key: Key): FoldedDegree {
  const count = scaleOffsets(key.scale).length;
  const { degree: shown, carry } = foldDegree(degree, count);
  return { degree: shown, carry, folded: carry > 0 };
}

/** The degree picker's choices: every degree of the current scale, named from the root. */
export function degreeOptions(key: Key): { value: string; label: string }[] {
  return scaleOffsets(key.scale).map((offset, i) => ({
    value: String(i),
    label: `${i + 1} ${pitchClassName(key.root, offset)}`,
  }));
}

/** What a step's top cell reads: a rest, a tie, or the note name with its fold and octave. */
export function stepLabel(step: GridStep, key: Key): string {
  if (step.kind === 'rest') return '·';
  if (step.kind === 'tie') return '—';
  const offsets = scaleOffsets(key.scale);
  const view = foldedView(step.degree, key);
  const name = pitchClassName(key.root, offsets[view.degree] ?? 0);
  const octave = step.octave + view.carry;
  return octave === 0 ? name : `${name}${octave > 0 ? '+' : ''}${octave}`;
}

/** A note step's pitch relative to the part's register root: equal exactly when the engine's MIDI notes are. */
function relativePitch(step: GridNoteStep, key: Key): number {
  const offsets = scaleOffsets(key.scale);
  const { degree, carry } = foldDegree(step.degree, offsets.length);
  return (step.octave + carry) * SEMITONES_PER_OCTAVE + (offsets[degree] ?? 0);
}

/**
 * How a step's note-on meets the note before it (windsor#31, `StepSlide`),
 * read the way `GridSequencer.noteStep` decides it. `kind` is what a Slide
 * does once a note is held: `none` for a rest, a tie, a note without Slide
 * or a Slide after a rest; `retarget` onto a different pitch; `same` onto
 * the pitch already held. The held note is the latest note before the
 * step, walking back over ties (a rest holds nothing).
 *
 * `when` says whether the run can change that. The engine holds nothing on
 * a region's entry, so a Slide whose held note comes from wrapping round
 * the loop (step 1 among them) plays its own values on entry and is held
 * only once the loop wraps: `wrap`. Skip drops a note step as a rest, which
 * releases the held note, so with Skip above 0 a Slide after a note may
 * play too: `skip`. Otherwise the line decides it alone: `always`.
 */
export function slideAt(
  spec: Pick<GridSpec, 'steps' | 'length' | 'skipChance'>,
  index: number,
  key: Key,
): StepSlide {
  const { steps } = spec;
  const n = Math.max(1, Math.min(Math.trunc(spec.length), steps.length));
  const step = steps[index];
  const none: StepSlide = { kind: 'none', when: 'always' };
  if (!step || step.kind !== 'note' || !step.slide || index >= n) return none;
  for (let back = 1; back <= n; back++) {
    const prev = steps[(((index - back) % n) + n) % n];
    if (!prev || prev.kind === 'rest') return none;
    if (prev.kind === 'tie') continue;
    const kind = relativePitch(prev, key) === relativePitch(step, key) ? 'same' : 'retarget';
    const when = back > index ? 'wrap' : spec.skipChance > 0 ? 'skip' : 'always';
    return { kind, when };
  }
  return none;
}
