/**
 * A switch lane's edits (windsor#631; record `2026-10-06-insert-switch-lanes`
 * decisions 2 and 9): an insert's on/off, held at two levels, Off and On,
 * with no ramp and no bend. Pure, with no DOM.
 *
 * - **Steps.** Every edit ends in `switchSteps`: the first point at its
 *   level, then each change as a step, two points on one tick, every value
 *   0 or 1 and every bend 0. A point that changes nothing on a held lane
 *   draws nothing, so it is dropped.
 * - **Draw** paints cells: the grain cell under the pointer, from its start
 *   to the next grain line, so a drag across bars 2 and 3 holds both at the
 *   level drawn, and the lane returns to what it held where the stroke ends.
 * - **Edit**: a click sets the clicked level from its tick to the next
 *   change (a click at the level already held changes nothing); a drag moves
 *   a point in time, a step's two points together, and the pressed point
 *   takes the level under the pointer, so it flips by crossing the middle;
 *   a double-click on a step deletes both its points, so the levels either
 *   side of it join.
 */
import type { AutomationPoint, AutomationTargetRow } from '@windsor/engine';
import { switchValue, valueAt } from '@windsor/engine';
import { movePoint, strokeTo, type StrokePosition } from './songAutomationEdit';

/** A Draw stroke's grain: its cell in ticks, inside the song. */
export interface StrokeGrain {
  readonly ticks: number;
  readonly songTicks: number;
}

const point = (tick: number, value: number): AutomationPoint => ({ tick, value, bend: 0 });

/**
 * `points` as steps: the first point's level, then at each tick whose last
 * point changes the level, the level before and the level after.
 */
export function switchSteps(points: readonly AutomationPoint[]): AutomationPoint[] {
  const first = points[0];
  if (!first) return [];
  let level = switchValue(first.value);
  const out = [point(first.tick, level)];
  points.forEach((p, i) => {
    // The last point on a tick is what the lane holds from it.
    if (points[i + 1]?.tick === p.tick) return;
    const now = switchValue(p.value);
    if (now === level) return;
    if (out[out.length - 1]!.tick !== p.tick) out.push(point(p.tick, level));
    out.push(point(p.tick, now));
    level = now;
  });
  return out;
}

const sameSteps = (a: readonly AutomationPoint[], b: readonly AutomationPoint[]): boolean =>
  a.length === b.length && a.every((p, i) => p.tick === b[i]!.tick && p.value === b[i]!.value);

/** The position's cell: half a grain back, so `strokeTo`'s nearest grain line is the cell's start. */
const cellOf = (at: StrokePosition, grain: StrokeGrain): StrokePosition => ({
  tick: at.tick - grain.ticks / 2,
  display: at.display,
});

/** `strokeTo` over cells: each sample keyed by the start of the cell the pointer crossed. */
export function switchStrokeTo(
  samples: Map<number, number>,
  from: StrokePosition | null,
  to: StrokePosition,
  grain: StrokeGrain,
): void {
  strokeTo(samples, from && cellOf(from, grain), cellOf(to, grain), grain);
}

/**
 * `original` with the stroke's cells held at the level drawn in each, and
 * from the end of the last cell what `original` held there, as steps.
 */
export function switchStrokePoints(
  row: AutomationTargetRow,
  original: readonly AutomationPoint[],
  samples: ReadonlyMap<number, number>,
  grain: StrokeGrain,
): AutomationPoint[] {
  const cells = [...samples.keys()].filter((t) => t < grain.songTicks).sort((a, b) => a - b);
  const lo = cells[0];
  const last = cells[cells.length - 1];
  if (lo === undefined || last === undefined) return [...original];
  const end = Math.min(last + grain.ticks, grain.songTicks);
  const drawn = cells.map((tick) => point(tick, samples.get(tick)!));
  const back = end < grain.songTicks ? [point(end, valueAt(row, original, end))] : [];
  return switchSteps([
    ...original.filter((p) => p.tick < lo),
    ...drawn,
    ...back,
    ...original.filter((p) => p.tick > end),
  ]);
}

/**
 * `points` with `value` held from `tick` to the next change, as steps; null
 * when the lane already holds `value` there, so a click makes no undo step.
 */
export function switchAddPoint(
  points: readonly AutomationPoint[],
  tick: number,
  value: number,
): AutomationPoint[] | null {
  const at = points.findIndex((p) => p.tick > tick);
  const index = at < 0 ? points.length : at;
  const next = switchSteps([...points.slice(0, index), point(tick, value), ...points.slice(index)]);
  return sameSteps(next, switchSteps(points)) ? null : next;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * `points` with point `index` at `to`, as steps. A point that is half of a
 * step moves with its other half, held between the points either side of
 * the pair. The pressed point takes `to.value`, and with it the span it
 * belongs to: the step's second point (or a lone point) the span from its
 * tick to the next change, the step's first point the span that ends at its
 * tick, back to the previous change. A step whose two sides meet in one
 * level is gone.
 */
export function switchMovePoint(
  points: readonly AutomationPoint[],
  index: number,
  to: { readonly tick: number; readonly value: number },
): AutomationPoint[] {
  const pressed = points[index];
  if (!pressed) return [...points];
  const partner = [index - 1, index + 1].find((i) => points[i]?.tick === pressed.tick);
  if (partner === undefined) return switchSteps(movePoint(points, index, to));
  const first = Math.min(index, partner);
  const lo = points[first - 1]?.tick ?? 0;
  const hi = points[first + 2]?.tick ?? Infinity;
  const tick = clamp(to.tick, lo, hi);
  const next = points.map((p, i) => (i === first || i === first + 1 ? { ...p, tick } : p));
  next[index] = { ...next[index]!, value: to.value };
  // The first half holds the span before the step, which starts at the
  // point before it: the previous step's second half, or the lane's first.
  if (index === first && first > 0) next[first - 1] = { ...next[first - 1]!, value: to.value };
  return switchSteps(next);
}

/** `points` without point `index`, and without its other half when it is half of a step. */
export function switchDeletePoint(
  points: readonly AutomationPoint[],
  index: number,
): AutomationPoint[] {
  const pressed = points[index];
  if (!pressed || points.length <= 1) return [...points];
  const partner = [index - 1, index + 1].find((i) => points[i]?.tick === pressed.tick);
  const kept = points.filter((_, i) => i !== index && i !== partner);
  return switchSteps(kept.length > 0 ? kept : [pressed]);
}
