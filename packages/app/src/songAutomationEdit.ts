/**
 * Editing a lane's points (windsor#349; record
 * `2026-10-01-song-automation-lanes` decision 13; the mockup
 * `docs/design/automation-lanes-mockup.html`): the rules under the lane
 * toolbar's Edit and Draw tools, with no DOM.
 *
 * - **Snap**: a tick lands on the Snap grain, or on the nearest whole tick
 *   with Shift or Snap Off.
 * - **Where a press lands**: on a point (within `pointHitPx`), on the line
 *   (within `lineHitPx` above or below it, and the segment under it, if
 *   any), or in empty space.
 * - **Edit**: add a point, move one between its neighbours, bend a segment
 *   (one full bend per `bendPxPerUnit` of vertical drag, straight within
 *   `straightWithin`), straighten one, delete a point down to the last.
 * - **Draw**: a stroke's samples on the grain, filled between two pointer
 *   moves, replace the lane's points over the range drawn.
 *
 * Every function returns a new list; the lane's whole list is what a gesture
 * commits (`withPoints`), since a merge replaces an array wholesale. Heights
 * are display space (the engine's `toDisplay` / `fromDisplay`), so a bend
 * and a stroke are even on the knob's own scale.
 */
import type {
  AutomationLane,
  AutomationPoint,
  AutomationTargetId,
  AutomationTargetRow,
} from '@windsor/engine';
import { fromDisplay, replaceRange, toDisplay, valueAt } from '@windsor/engine';
import { laneY } from './songAutomationCurve';
import { rightHalfBend } from './songAutomationSplit';
import {
  AUTOMATION_DRAWING,
  AUTOMATION_GESTURES,
  type AutomationDrawing,
  type AutomationGestures,
} from './songAutomationTables';
import { pxToTick, tickToPx } from './songViewTables';

/** Where a lane is drawn: the view's zoom, the lane's height and the song's length. */
export interface LaneFrame {
  readonly pxPerBar: number;
  readonly heightPx: number;
  readonly songTicks: number;
  readonly drawing?: AutomationDrawing;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `tick` on the grain (`grainTicks` 0 or `free`: the nearest whole tick), inside the song. */
export function snapTick(
  tick: number,
  grainTicks: number,
  songTicks: number,
  free = false,
): number {
  const snapped =
    free || grainTicks <= 0 ? Math.round(tick) : Math.round(tick / grainTicks) * grainTicks;
  return clamp(snapped, 0, songTicks);
}

/** Draw's grain: the Snap grain, or `drawOffGrainTicks` while Snap is Off (decision 3). */
export const drawGrain = (
  snapTicks: number,
  gestures: AutomationGestures = AUTOMATION_GESTURES,
): number => (snapTicks > 0 ? snapTicks : gestures.drawOffGrainTicks);

/** The song tick at `x` px into the lane, inside the song. */
export const tickAtPx = (x: number, frame: LaneFrame): number =>
  clamp(pxToTick(x, frame.pxPerBar), 0, frame.songTicks);

/** The display height (0..1) at `y` px from the lane's top. */
export function displayAtPx(y: number, frame: LaneFrame): number {
  const { padPx } = frame.drawing ?? AUTOMATION_DRAWING;
  return clamp(1 - (y - padPx) / (frame.heightPx - 2 * padPx), 0, 1);
}

/** The value in `row`'s units at `y` px from the lane's top. */
export const valueAtPx = (row: AutomationTargetRow, y: number, frame: LaneFrame): number =>
  fromDisplay(row, displayAtPx(y, frame));

/** Where `value` draws, in px from the lane's top. */
export const pxOfValue = (row: AutomationTargetRow, value: number, frame: LaneFrame): number =>
  laneY(toDisplay(row, value), frame.heightPx, frame.drawing);

/** The segment `i → i + 1` that `tick` falls in, or null before the first point or from the last. */
export function segmentAt(points: readonly AutomationPoint[], tick: number): number | null {
  for (let i = points.length - 2; i >= 0; i--) {
    if (points[i]!.tick <= tick && points[i + 1]!.tick > tick) return i;
  }
  return null;
}

/** Where an Edit press lands. */
export type LanePress =
  | { readonly kind: 'point'; readonly index: number }
  | { readonly kind: 'space'; readonly near: boolean; readonly segment: number | null };

/** The press at (`x`, `y`) px: the nearest point within reach, else the line or empty space. */
export function pressAt(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  frame: LaneFrame,
  at: { readonly x: number; readonly y: number },
  gestures: AutomationGestures = AUTOMATION_GESTURES,
): LanePress {
  let best = -1;
  let bestPx = gestures.pointHitPx;
  points.forEach((p, i) => {
    const dx = tickToPx(p.tick, frame.pxPerBar) - at.x;
    const dy = pxOfValue(row, p.value, frame) - at.y;
    const d = Math.hypot(dx, dy);
    if (d < bestPx) {
      bestPx = d;
      best = i;
    }
  });
  if (best >= 0) return { kind: 'point', index: best };
  const tick = tickAtPx(at.x, frame);
  const lineY = pxOfValue(row, valueAt(row, points, tick), frame);
  return {
    kind: 'space',
    near: Math.abs(lineY - at.y) < gestures.lineHitPx,
    segment: segmentAt(points, tick),
  };
}

/** How many points sit at `tick`, leaving out point `except`. */
const pointsAtTick = (points: readonly AutomationPoint[], tick: number, except = -1): number =>
  points.filter((p, i) => i !== except && p.tick === tick).length;

/** A tick holds at most two points: the two sides of a step. */
const STEP_POINTS = 2;

/**
 * `points` with a point at `tick`, after any already there, carrying the
 * bend of the segment it splits so the curve keeps its direction; null when
 * `tick` already holds two points (a step), which a third would break.
 */
export function addPoint(
  points: readonly AutomationPoint[],
  tick: number,
  value: number,
): { readonly points: AutomationPoint[]; readonly index: number } | null {
  if (pointsAtTick(points, tick) >= STEP_POINTS) return null;
  let index = points.findIndex((p) => p.tick > tick);
  if (index < 0) index = points.length;
  const bend = index > 0 ? points[index - 1]!.bend : 0;
  const next = [...points];
  next.splice(index, 0, { tick, value, bend });
  return { points: next, index };
}

/**
 * `points` with a point on the line at `tick` ("add on the line"): the
 * line's own value there, the split segment's bend kept on the left half
 * and fitted on the right (`rightHalfBend`), so the curve stays as near
 * as one segment allows. Null when `tick` already holds two points.
 */
export function addPointOnLine(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  tick: number,
): { readonly points: AutomationPoint[]; readonly index: number } | null {
  const added = addPoint(points, tick, valueAt(row, points, tick));
  if (!added) return null;
  const { index } = added;
  const a = points[index - 1];
  const b = points[index];
  if (!a || !b || a.tick >= tick) return added;
  const s = (tick - a.tick) / (b.tick - a.tick);
  added.points[index] = { ...added.points[index]!, bend: rightHalfBend(row, a, b, s) };
  return added;
}

/**
 * `points` with point `index` at `value` and `tick`, held between its
 * neighbours' ticks: on a neighbour's tick, unless that tick already holds
 * two points (a step), when it stops one tick short.
 */
export function movePoint(
  points: readonly AutomationPoint[],
  index: number,
  to: { readonly tick: number; readonly value: number },
): AutomationPoint[] {
  const point = points[index];
  if (!point) return [...points];
  const before = points[index - 1];
  const after = points[index + 1];
  const full = (tick: number): boolean => pointsAtTick(points, tick, index) >= STEP_POINTS;
  const lo = before ? before.tick + (full(before.tick) ? 1 : 0) : 0;
  const hi = after ? after.tick - (full(after.tick) ? 1 : 0) : Infinity;
  const next = [...points];
  next[index] = { ...point, tick: clamp(to.tick, lo, hi), value: to.value };
  return next;
}

/**
 * A bend dragged `dyPx` down from where it started at `startBend`: up bows
 * the segment up. Clamped to −1..1, and straight within `straightWithin`.
 */
export function draggedBend(
  startBend: number,
  dyPx: number,
  gestures: AutomationGestures = AUTOMATION_GESTURES,
): number {
  const bend = clamp(startBend - dyPx / gestures.bendPxPerUnit, -1, 1);
  return Math.abs(bend) < gestures.straightWithin ? 0 : bend;
}

/** `points` with the segment after point `segment` bent by `bend` (0 straightens it). */
export function withBend(
  points: readonly AutomationPoint[],
  segment: number,
  bend: number,
): AutomationPoint[] {
  return points.map((p, i) => (i === segment ? { ...p, bend } : p));
}

/** `points` without point `index`; a lane keeps at least one point. */
export const deletePoint = (
  points: readonly AutomationPoint[],
  index: number,
): AutomationPoint[] => (points.length <= 1 ? [...points] : points.filter((_, i) => i !== index));

/** A pointer position in a Draw stroke: a song tick and a display height. */
export interface StrokePosition {
  readonly tick: number;
  readonly display: number;
}

/**
 * Sample the stroke from `from` (the last position, or null at the press)
 * to `to` into `samples` (grain tick → display height): every grain tick
 * between them, on the straight line joining them, so a fast drag leaves no
 * gap. A tick drawn again takes the newer height, and so does a cell both
 * positions snap to, however slowly the pointer crossed it.
 */
export function strokeTo(
  samples: Map<number, number>,
  from: StrokePosition | null,
  to: StrokePosition,
  grain: { readonly ticks: number; readonly songTicks: number },
): void {
  const end = snapTick(to.tick, grain.ticks, grain.songTicks);
  if (!from) {
    samples.set(end, to.display);
    return;
  }
  const start = snapTick(from.tick, grain.ticks, grain.songTicks);
  if (start === end) {
    // Both samples fall in one cell: the pointer's newest height is the cell's.
    samples.set(end, to.display);
    return;
  }
  const count = Math.round(Math.abs(end - start) / grain.ticks);
  const span = to.tick - from.tick;
  for (let i = 0; i <= count; i++) {
    const tick = i === count ? end : start + Math.sign(end - start) * i * grain.ticks;
    const u = span === 0 ? 1 : clamp((tick - from.tick) / span, 0, 1);
    samples.set(tick, from.display + (to.display - from.display) * u);
  }
}

/** `original` with the stroke's range replaced by its samples, straight, in `row`'s units. */
export function strokePoints(
  row: AutomationTargetRow,
  original: readonly AutomationPoint[],
  samples: ReadonlyMap<number, number>,
): AutomationPoint[] {
  const ticks = [...samples.keys()].sort((a, b) => a - b);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  if (lo === undefined || hi === undefined) return [...original];
  const drawn = ticks.map((tick) => ({
    tick,
    value: fromDisplay(row, samples.get(tick)!),
    bend: 0,
  }));
  return replaceRange(original, lo, hi, drawn);
}

/** `lanes` with the lane on `target` holding `points`. */
export const withPoints = (
  lanes: readonly AutomationLane[],
  target: AutomationTargetId,
  points: readonly AutomationPoint[],
): AutomationLane[] => lanes.map((l) => (l.target === target ? { ...l, points } : l));
