/**
 * The lane's curve (windsor#341, record `2026-10-01-song-automation-lanes`
 * decisions 4, 5 and 8): `valueAt` reads a lane's value at a song tick, and
 * `rampsBetween` turns a window of it into the breakpoints the player
 * schedules linear AudioParam ramps to.
 *
 * - Before the first point the lane holds the first point's value, after the
 *   last point the last one's.
 * - Where two points share a tick (a step) the value at that tick is the
 *   later point's.
 * - Within a segment `a → b`, in display space,
 *   `y = ya + (yb − ya) · u^k`, `k = BASE^(−a.bend · sign(yb − ya))`: a
 *   positive bend bows the segment up, a negative one down, whichever way it
 *   runs, and a bend of 0 or a flat segment is the straight line exactly.
 *
 * Pure, and `valueAt` allocates nothing. `automationEvaluate.test.ts` pins
 * both.
 */
import { AUTOMATION_BEND_BASE, AUTOMATION_GRAIN_TICKS } from './automationConstants';
import { fromDisplay, toDisplay } from './automationDisplay';
import type { AutomationPoint, AutomationTargetRow } from './automationLane';

/** A breakpoint the player ramps to: a song tick and a value in the target's units. */
export interface AutomationRamp {
  readonly tick: number;
  readonly value: number;
}

/** The bent fraction of a segment: `u` raised to the bend's exponent, `u` itself unbent. */
export function bendCurve(u: number, bend: number, rise: number): number {
  if (bend === 0 || rise === 0) return u;
  return Math.pow(u, Math.pow(AUTOMATION_BEND_BASE, -bend * Math.sign(rise)));
}

/** The index of the last point at or before `tick`, or −1 when every point is after it. */
export function lastPointAtOrBefore(points: readonly AutomationPoint[], tick: number): number {
  return firstPointPast(points, tick, true) - 1;
}

/** The index of the first point after `tick` (or at it, unless `strictly`), or the length. */
export function firstPointPast(
  points: readonly AutomationPoint[],
  tick: number,
  strictly: boolean,
): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const t = points[mid]!.tick;
    if (t < tick || (strictly && t === tick)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The value inside segment `a → b` at `tick`, with `a.tick < b.tick`. */
export function segmentValue(
  row: AutomationTargetRow,
  a: AutomationPoint,
  b: AutomationPoint,
  tick: number,
): number {
  if (tick <= a.tick) return a.value;
  if (tick >= b.tick) return b.value;
  if (a.value === b.value) return a.value;
  const ya = toDisplay(row, a.value);
  const yb = toDisplay(row, b.value);
  const u = (tick - a.tick) / (b.tick - a.tick);
  return fromDisplay(row, ya + (yb - ya) * bendCurve(u, a.bend, yb - ya));
}

/** The lane's value at `tick`, in the row's units. A lane has at least one point. */
export function valueAt(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  tick: number,
): number {
  if (points.length === 0) throw new Error('valueAt: a lane has at least one point');
  const i = lastPointAtOrBefore(points, tick);
  if (i < 0) return points[0]!.value;
  const a = points[i]!;
  if (i === points.length - 1 || tick === a.tick) return a.value;
  return segmentValue(row, a, points[i + 1]!, tick);
}

/**
 * Whether segment `a → b` is a straight line in the row's own units, so a
 * linear ramp between its ends is exact: unbent on a linear row, or flat. A
 * straight line on a log or dB row is a curve in its units, and is cut.
 */
function straightInUnits(
  row: AutomationTargetRow,
  a: AutomationPoint,
  b: AutomationPoint,
): boolean {
  return a.value === b.value || (a.bend === 0 && row.scale === 'linear');
}

/** Options for `rampsBetween`. */
export interface RampWindow {
  /** The window's first tick, included. */
  readonly fromTick: number;
  /** The window's end, excluded, so consecutive windows share no breakpoint. */
  readonly toTick: number;
  /** The cut through a curved segment, in ticks. */
  readonly grainTicks?: number;
}

/**
 * The breakpoints in `[fromTick, toTick)` the player ramps linearly to, in
 * tick order and the row's units: every point there (both of a step, at
 * one tick), and inside a curved segment a cut every `grainTicks` from its
 * start. A segment that is straight in the row's units adds only its ends.
 */
export function rampsBetween(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  window: RampWindow,
): AutomationRamp[] {
  const { fromTick, toTick, grainTicks = AUTOMATION_GRAIN_TICKS } = window;
  const out: AutomationRamp[] = [];
  if (!(grainTicks > 0)) throw new Error(`rampsBetween: grain ${grainTicks} is not positive`);
  // The segment running into the window: from the last point before it, so
  // both points of a step on its first tick are inside.
  const first = Math.max(0, firstPointPast(points, fromTick, false) - 1);
  for (let i = first; i < points.length; i++) {
    const a = points[i]!;
    if (a.tick >= toTick) break;
    if (a.tick >= fromTick) out.push({ tick: a.tick, value: a.value });
    const b = points[i + 1];
    if (!b || b.tick === a.tick || straightInUnits(row, a, b)) continue;
    const start = Math.max(1, Math.ceil((fromTick - a.tick) / grainTicks));
    for (let k = start; ; k++) {
      const tick = a.tick + k * grainTicks;
      if (tick >= b.tick || tick >= toTick) break;
      out.push({ tick, value: segmentValue(row, a, b, tick) });
    }
  }
  return out;
}
