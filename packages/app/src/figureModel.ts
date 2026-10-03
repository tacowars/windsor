/**
 * The Figure device's cell rules without the DOM (windsor#490, epic
 * windsor#483; record `2026-10-03-figure-sequencer`): what a cell's click,
 * its tone picker, its Vel drag and its flags do; how Length, Rotate and
 * Randomize change the line; and what a cell's tone reads over a chord.
 * Every function returns a new value for `changePattern`, where an array
 * replaces wholesale. The octave, accent and slide edits are
 * `gridModel.ts`'s and the ratchet's `ratchetModel.ts`'s, which take a
 * Figure cell as they take a Grid step.
 *
 * **A tone's label** (windsor#489: chord degrees) is read from the engine's
 * `figureNote` over the chord's stack: the interval of the tone above the
 * chord's root, named as a degree within the octave
 * (`FIGURE_INTERVAL_DEGREES`), a prime per octave up and a minus per octave
 * down. So 0 1 2 3 read `R 3 5 R'` over a triad, `R 3 5 7` over a seventh,
 * and a sus chord's stack reads `R 4 5`.
 */
import type { FigureCell, FigureNoteCell, FigureSpec, StepModLane } from '@windsor/engine';
import {
  FIGURE_TONE_MAX,
  GRID_STEPS_MAX,
  RATCHET_MAX,
  SEMITONES_PER_OCTAVE,
  figureNote,
  figureNoteCell,
} from '@windsor/engine';
import {
  FIGURE_INTERVAL_DEGREES,
  FIGURE_RANDOM,
  FIGURE_SUMMARY_CELLS,
  FIGURE_SUMMARY_STACK,
  FIGURE_TERTIAN_DEGREES,
  FIGURE_TONE_GLYPHS,
  FIGURE_VEL,
  type FigureRandomTable,
} from './figureConstants';
import { type Draw, cycleKind, rotateLanes, rotateSteps } from './gridModel';

/** The degree an interval within the octave names at stack position `position`. */
function degreeOf(semitones: number, position: number): number {
  const candidates = FIGURE_INTERVAL_DEGREES[semitones] ?? [1];
  const tertian = FIGURE_TERTIAN_DEGREES[position] ?? 1;
  let best = candidates[0] ?? 1;
  for (const degree of candidates) {
    if (Math.abs(degree - tertian) < Math.abs(best - tertian)) best = degree;
  }
  return best;
}

/**
 * What tone `tone` reads over `stack` (a `HarmonyChord.stack`): `R`, `3`,
 * `5`, `7`, with `'` per octave up and `−` per octave down; the tone's
 * number with no chord.
 */
export function toneLabel(stack: readonly number[], tone: number): string {
  const note = figureNote(stack, tone, 0);
  const root = stack[0];
  if (note === null || root === undefined) return String(tone);
  const interval = note - root;
  const octaves = Math.floor(interval / SEMITONES_PER_OCTAVE);
  const within = interval - octaves * SEMITONES_PER_OCTAVE;
  const position = ((tone % stack.length) + stack.length) % stack.length;
  const degree = degreeOf(within, position);
  const name = degree === 1 ? FIGURE_TONE_GLYPHS.root : String(degree);
  if (octaves > 0) return name + FIGURE_TONE_GLYPHS.up.repeat(octaves);
  return FIGURE_TONE_GLYPHS.down.repeat(-octaves) + name;
}

/** What a cell's top reads: `·` for a rest, `—` for a tie, a note's tone over `stack`. */
export function cellLabel(cell: FigureCell, stack: readonly number[]): string {
  if (cell.kind === 'rest') return '·';
  if (cell.kind === 'tie') return '—';
  return toneLabel(stack, cell.tone);
}

/**
 * The region block's line (`songViewTables.ts`): the first cells of the
 * line named over a plain triad, `R 3 5 3`, since a lane has no one chord.
 */
export function lineSummary(
  cells: readonly FigureCell[],
  length: number,
  stack: readonly number[] = FIGURE_SUMMARY_STACK,
  count: number = FIGURE_SUMMARY_CELLS,
): string {
  return cells
    .slice(0, Math.max(0, Math.min(length, count)))
    .map((cell) => cellLabel(cell, stack))
    .join(' ');
}

/** The tone picker's choices, −`FIGURE_TONE_MAX` to `FIGURE_TONE_MAX`, each labelled over `stack`. */
export function toneOptions(stack: readonly number[]): { tone: number; label: string }[] {
  return Array.from({ length: 2 * FIGURE_TONE_MAX + 1 }, (_, i) => {
    const tone = i - FIGURE_TONE_MAX;
    return { tone, label: toneLabel(stack, tone) };
  });
}

/** The top cell's cycle: note → tie → rest → a root note. A note that leaves keeps none of its fields. */
export const nextFigureKind = (cell: FigureCell): FigureCell =>
  cycleKind(cell, () => figureNoteCell());

/** A note cell's edit; a rest or a tie comes back unchanged. */
const editNote = (cell: FigureCell, edit: (note: FigureNoteCell) => FigureNoteCell): FigureCell =>
  cell.kind === 'note' ? edit(cell) : cell;

/** The cell on tone `tone`, held within ±`FIGURE_TONE_MAX`. */
export const setTone = (cell: FigureCell, tone: number): FigureCell =>
  editNote(cell, (note) => ({
    ...note,
    tone: Math.max(-FIGURE_TONE_MAX, Math.min(FIGURE_TONE_MAX, Math.round(tone))),
  }));

/** A note's velocity: its own, absent is 1. */
export const cellVelocity = (cell: FigureCell): number =>
  cell.kind === 'note' ? (cell.velocity ?? 1) : 1;

/** A velocity on the Vel cell's grid: 0 to 1 in steps of `step`. */
export function snapVelocity(value: number, step: number = FIGURE_VEL.step): number {
  const snapped = Math.round(Math.max(0, Math.min(1, value)) / step) * step;
  return Number(snapped.toFixed(2));
}

/** The cell at velocity `velocity`, snapped; at 1 it carries no `velocity`, as the normaliser writes it. */
export function setVelocity(cell: FigureCell, velocity: number): FigureCell {
  return editNote(cell, (note) => {
    const v = snapVelocity(velocity);
    if (v < 1) return { ...note, velocity: v };
    const full: { -readonly [K in keyof FigureNoteCell]: FigureNoteCell[K] } = { ...note };
    delete full.velocity;
    return full;
  });
}

/** The velocity a vertical drag of `dy` px (up is negative) reaches from `from`. */
export const dragVelocity = (from: number, dy: number, px: number = FIGURE_VEL.dragPx): number =>
  snapVelocity(from - dy / px);

/** What the Vel cell reads: `1` at full, else the value without its leading zero (`.75`, `.8`, `0`). */
export function velocityLabel(velocity: number): string {
  if (velocity >= 1) return '1';
  if (velocity <= 0) return '0';
  return String(Number(velocity.toFixed(2))).replace(/^0/, '');
}

/**
 * The cells and lanes for a line `length` long: grown with root notes (and
 * lane values) when it runs past the cells, never shortened, so a cell past
 * the line stays written until the length reaches it again.
 */
export function cellsForLength(cells: readonly FigureCell[], length: number): FigureCell[] {
  const target = Math.max(1, Math.min(GRID_STEPS_MAX, Math.trunc(length)));
  if (target <= cells.length) return [...cells];
  return [...cells, ...Array.from({ length: target - cells.length }, () => figureNoteCell())];
}

/** The pattern Rotate turns: the line's length, its cells and their lanes. */
export type FigureTurnable = Pick<FigureSpec, 'length' | 'cells' | 'lanes'>;

/**
 * The cells and lanes turned `by` places over the line's first `length`
 * cells. A cell moves whole, so its velocity and ratchet go with it, and a
 * lane value goes with its cell.
 */
export function rotateFigure(
  spec: FigureTurnable,
  by: number,
): { cells: FigureCell[]; lanes: StepModLane[] } {
  return {
    cells: rotateSteps(spec.cells, by, spec.length),
    lanes: rotateLanes(spec.lanes, by, spec.length),
  };
}

/** One random note's tone over a chord of `size` tones: a chord tone, at the root's octave or the next. */
function randomTone(draw: Draw, size: number): number {
  return Math.min(size, Math.floor(draw() * (size + 1)));
}

/**
 * One random cell: a rest or a tie now and then, else a note on a chord
 * tone with a written velocity, accent and slide each at `flag`, an octave
 * now and then and a roll at `ratchet`. Nine draws in that order, always,
 * so a test can script them.
 */
function randomCell(draw: Draw, size: number, table: FigureRandomTable, max: number): FigureCell {
  const kind = draw();
  const tone = randomTone(draw, size);
  const velocity = table.velocities[Math.floor(draw() * table.velocities.length)] ?? 1;
  const accent = draw() < table.flag;
  const slide = draw() < table.flag;
  const shifted = draw() < table.octave;
  const down = draw() < table.octaveDown;
  const rolls = draw() < table.ratchet;
  const roll = Math.min(max, 2 + Math.floor(draw() * (max - 1)));
  if (kind < table.rest) return { kind: 'rest' };
  if (kind < table.rest + table.tie) return { kind: 'tie' };
  const octave = shifted ? (down ? -table.octaveSpan : table.octaveSpan) : 0;
  const v = snapVelocity(velocity);
  return figureNoteCell(tone, {
    octave,
    accent,
    slide,
    ...(v < 1 && { velocity: v }),
    ...(rolls && roll > 1 && { ratchet: roll }),
  });
}

/**
 * Randomize: the line's first `length` cells rerolled over the chord's
 * tones (`size` of them; a triad with no chord), every cell past them kept.
 * The lanes, the processes and the seed are not the cells', so nothing here
 * reaches them.
 */
export function randomFigureCells(
  cells: readonly FigureCell[],
  length: number,
  size: number,
  draw: Draw,
  table: FigureRandomTable = FIGURE_RANDOM,
): FigureCell[] {
  const shown = Math.max(0, Math.min(Math.trunc(length), cells.length));
  const tones = Math.max(1, Math.trunc(size));
  return cells.map((cell, i) => (i < shown ? randomCell(draw, tones, table, RATCHET_MAX) : cell));
}
