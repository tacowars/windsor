/**
 * The modulation lanes' rules (windsor#31), without the DOM: which lanes a
 * sequencer may add, what a lane list becomes when one is added, removed,
 * painted or resized, how a pointer maps to a cell and a value, and what a
 * cell's readout says. Every function returns a new list for `ctx.change`,
 * where arrays replace wholesale; the lane shape and its limits are the
 * engine's (`StepModLane`, `STEP_MOD_LANES_MAX`), and a readout's played
 * value is the engine's own curve (`stepModValue`), so the console and the
 * voice cannot disagree. `stepModLane.ts` draws it; any step card may.
 */
import type { StepModLane, StepModParam, StepModRow } from '@windsor/engine';
import { STEP_MOD_LANES_MAX, STEP_MOD_PARAMS, STEP_MOD_TABLE, stepModValue } from '@windsor/engine';
import { fmtSigned } from './consoleFormat';
import {
  LANE_OCTAVE_DIGITS,
  LANE_PAINT,
  STEP_MOD_LANE_LABELS,
  type LanePaintTable,
} from './stepModLaneTables';

/** The parameters not yet on a lane, in the engine's slot order: what the picker offers. */
export function freeParams(lanes: readonly StepModLane[]): StepModParam[] {
  const taken = new Set(lanes.map((lane) => lane.param));
  return STEP_MOD_PARAMS.filter((param) => !taken.has(param));
}

/** Whether one more lane fits under the engine's limit. */
export const canAddLane = (lanes: readonly StepModLane[], max = STEP_MOD_LANES_MAX): boolean =>
  lanes.length < max;

/**
 * The list with a lane for `param` appended, every step at 0 — or null when
 * the list is full or `param` already has a lane, which the engine refuses.
 */
export function addLane(
  lanes: readonly StepModLane[],
  param: StepModParam,
  steps: number,
  max = STEP_MOD_LANES_MAX,
): StepModLane[] | null {
  if (!canAddLane(lanes, max) || lanes.some((lane) => lane.param === param)) return null;
  return [...lanes, { param, values: new Array<number>(Math.max(0, steps)).fill(0) }];
}

export function removeLane(lanes: readonly StepModLane[], index: number): StepModLane[] {
  return lanes.filter((_, i) => i !== index);
}

/** The list with lane `index`'s values replaced. */
export function withLaneValues(
  lanes: readonly StepModLane[],
  index: number,
  values: readonly number[],
): StepModLane[] {
  return lanes.map((lane, i) => (i === index ? { ...lane, values: [...values] } : lane));
}

/**
 * The list with the lane for `param` given `values`, or null when no lane
 * names `param` any more: what a write that waited (a click's double-click
 * window) lands on, so a lane removed or moved meanwhile never takes
 * another lane's values.
 */
export function withParamValues(
  lanes: readonly StepModLane[],
  param: StepModParam,
  values: readonly number[],
): StepModLane[] | null {
  const index = lanes.findIndex((lane) => lane.param === param);
  return index < 0 ? null : withLaneValues(lanes, index, values);
}

/** One step back to the patch's own value: a double-click. */
export function resetCell(values: readonly number[], index: number): number[] {
  return values.map((v, i) => (i === index ? 0 : v));
}

/** Every lane padded with 0 or trimmed to `steps` values, as the normaliser keeps them. */
export function lanesForSteps(lanes: readonly StepModLane[], steps: number): StepModLane[] {
  const n = Math.max(0, Math.trunc(steps));
  return lanes.map((lane) => ({
    ...lane,
    values: Array.from({ length: n }, (_, i) => lane.values[i] ?? 0),
  }));
}

/** A value held to the table's grid, and snapped to 0 inside its band. */
export function settle(value: number, table: LanePaintTable = LANE_PAINT): number {
  const v = Math.max(-1, Math.min(1, value));
  if (Math.abs(v) < table.snapBand) return 0;
  return Math.round(v * table.divisions) / table.divisions || 0;
}

/** A cell's vertical extent on screen. */
export interface Band {
  readonly top: number;
  readonly height: number;
}

/** The value a pointer at `y` sets in a cell spanning `band`: +1 at the top, 0 at the centre, -1 at the bottom. */
export function valueAtY(y: number, band: Band, table: LanePaintTable = LANE_PAINT): number {
  const half = band.height / 2;
  if (half <= 0) return 0;
  return settle((band.top + half - y) / half, table);
}

/** A cell's horizontal extent on screen. */
export interface Span {
  readonly left: number;
  readonly right: number;
}

/** The cell a pointer at `x` is over: the one whose centre is nearest, so a gap or an overshoot picks a side. */
export function cellAtX(x: number, cells: readonly Span[]): number {
  let best = -1;
  let distance = Infinity;
  cells.forEach((cell, i) => {
    const d = Math.abs(x - (cell.left + cell.right) / 2);
    if (d < distance) [best, distance] = [i, d];
  });
  return best;
}

/** Where a drag is: the cell and the value it sets there. */
export interface PaintPoint {
  readonly index: number;
  readonly value: number;
}

/**
 * A drag's move from `from` to `to`: `to`'s cell takes its value, and every
 * cell the drag crossed on the way takes the straight line between the two,
 * so a fast sweep leaves no cell behind. `from` null is the press itself.
 */
export function paintSpan(
  values: readonly number[],
  from: PaintPoint | null,
  to: PaintPoint,
  table: LanePaintTable = LANE_PAINT,
): number[] {
  const out = [...values];
  const set = (i: number, v: number): void => {
    if (i >= 0 && i < out.length) out[i] = settle(v, table);
  };
  if (!from || from.index === to.index) {
    set(to.index, to.value);
    return out;
  }
  const dir = Math.sign(to.index - from.index);
  const span = to.index - from.index;
  for (let i = from.index + dir; i !== to.index + dir; i += dir) {
    set(i, from.value + ((i - from.index) / span) * (to.value - from.value));
  }
  return out;
}

const rowOf = (param: StepModParam): StepModRow | undefined =>
  STEP_MOD_TABLE.find((row) => row.param === param);

/** The offset a value pushes, in the row's own terms: octaves, the knob's units, or the lane value on a log row. */
export function offsetLabel(row: StepModRow, value: number): string {
  if (row.curve === 'octaves') {
    const oct = value * row.span;
    return `${oct >= 0 ? '+' : ''}${oct.toFixed(LANE_OCTAVE_DIGITS)} oct`;
  }
  return fmtSigned(row.curve === 'linear' ? value * row.span : value);
}

/**
 * How a step's note-on meets the voice (windsor#31). `kind`: `none`, a
 * plain note-on (or no note at all); `retarget`, a Slide onto a new pitch,
 * which hands the sounding voice over and keeps the old step's offsets on
 * every `slideKeeps` row; `same`, a Slide onto the pitch already held,
 * which sends no note-on, so none of the step's values reach the voice.
 * `when`: `always`, or a hold the run decides: `wrap`, held only once the
 * loop has wrapped (a region's entry holds nothing), and `skip`, held unless
 * Skip drops the note before it. The card reads it from its own steps (the
 * grid's `slideAt`).
 */
export interface StepSlide {
  readonly kind: 'none' | 'retarget' | 'same';
  readonly when: 'always' | 'wrap' | 'skip';
}

/** A plain step: what a card without slides reports. */
export const NO_SLIDE: StepSlide = { kind: 'none', when: 'always' };

/** Whether a step's own value reaches the voice: it `plays`, a slide keeps the old one (`held`), or the run decides (`depends`). */
export type LaneHold = 'plays' | 'held' | 'depends';

export function heldBySlide(slide: StepSlide, param: StepModParam): LaneHold {
  const holds =
    slide.kind === 'same' || (slide.kind === 'retarget' && rowOf(param)?.slideKeeps === true);
  if (!holds) return 'plays';
  return slide.when === 'always' ? 'held' : 'depends';
}

/** What a readout adds after the offset when a slide holds the row, or may. */
const HOLD_NOTE: Record<StepSlide['when'], string> = {
  always: 'held by slide',
  wrap: 'held by slide once looping',
  skip: 'held by slide unless skipped',
};

/**
 * What a cell's readout says: the offset, and what the step plays through
 * the engine's curve when the patch's own value is known; or, when a slide
 * holds the row or may, that instead.
 */
export function laneReadout(
  param: StepModParam,
  value: number,
  base: number | undefined,
  slide: StepSlide = NO_SLIDE,
): string {
  const row = rowOf(param);
  if (!row) return fmtSigned(value);
  const offset = offsetLabel(row, value);
  if (heldBySlide(slide, param) !== 'plays') return `${offset} · ${HOLD_NOTE[slide.when]}`;
  if (base === undefined) return offset;
  return `${offset} → ${STEP_MOD_LANE_LABELS[param].fmt(stepModValue(row, base, value))}`;
}

/** The name a lane and the picker show. */
export const laneLabel = (param: StepModParam): string => STEP_MOD_LANE_LABELS[param].label;
