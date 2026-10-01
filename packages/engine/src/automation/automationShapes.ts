/**
 * Stamped shapes (windsor#341, record `2026-10-01-song-automation-lanes`
 * decision 12): a shape over a range of song ticks becomes ordinary points
 * that replace the lane's points there, editable afterwards. Nothing new
 * runs live.
 *
 * The shape works in display space: `top` and `bottom` are heights in 0..1
 * and its bends are display-space bends, so a triangle on the level lane is
 * even in dB. Given the lane's row, the points come back in its units.
 * Upside down (`top < bottom`) every bend flips with the shape, so a sine
 * stays a sine and an S-curve an S.
 *
 * The result starts exactly at `startTick` and ends exactly at `endTick`,
 * each edge carrying the shape's value there: at the start the value from
 * the start on (the later point of a step), at the end the value arriving
 * there (the earlier one). `automationShapes.test.ts` pins every kind.
 */
import { DISPLAY_ROW, fromDisplay } from './automationDisplay';
import { firstPointPast, lastPointAtOrBefore, segmentValue, valueAt } from './automationEvaluate';
import type { AutomationPoint, AutomationTargetRow } from './automationLane';
import {
  SHAPE_CYCLES,
  SHAPE_DUTY_MAX,
  SHAPE_DUTY_MIN,
  SHAPE_S_CURVE_BEND,
  type AutomationShapeKind,
  type CyclicShapeKind,
} from './automationShapeTables';

/** What the shape panel sets. */
export interface AutomationShapeSpec {
  readonly kind: AutomationShapeKind;
  /** One cycle, in song ticks. Ramp and S-curve ignore it. */
  readonly rateTicks: number;
  /** The shape's top and bottom, heights in 0..1. */
  readonly top: number;
  readonly bottom: number;
  /** 0..1: how far into its cycle the shape is at the range's start. Ramp and S-curve ignore it. */
  readonly phase: number;
  /** 0.1..0.9: the square's share of each cycle at the top. */
  readonly duty: number;
}

/** Places a key at a tick: its height `v` between the spec's bottom and top, its bend flipped upside down. */
type Place = (tick: number, v: number, bend: number) => AutomationPoint;

function placer(spec: AutomationShapeSpec): Place {
  const span = spec.top - spec.bottom;
  const flip = span < 0 ? -1 : 1;
  return (tick, v, bend) => ({
    tick,
    value: spec.bottom + span * v,
    bend: bend === 0 ? 0 : flip * bend,
  });
}

/** Every cycle's keys that reach into `[startTick, endTick]`, in display space. */
function cycles(spec: AutomationShapeSpec, startTick: number, endTick: number): AutomationPoint[] {
  const { rateTicks } = spec;
  if (!(rateTicks > 0)) throw new RangeError(`stampShape: rate ${rateTicks} is not positive`);
  const duty = Math.min(SHAPE_DUTY_MAX, Math.max(SHAPE_DUTY_MIN, spec.duty));
  const keys = SHAPE_CYCLES[spec.kind as CyclicShapeKind](duty);
  const origin = startTick - spec.phase * rateTicks;
  const last = Math.ceil((endTick - origin) / rateTicks);
  const at = placer(spec);
  const out: AutomationPoint[] = [];
  for (let c = -1; c <= last; c++) {
    for (const key of keys) out.push(at(origin + (c + key.u) * rateTicks, key.v, key.bend));
  }
  return out;
}

/** A cyclic shape cut to the range: its edges, and every key strictly inside. */
function cyclicStamp(
  spec: AutomationShapeSpec,
  startTick: number,
  endTick: number,
): AutomationPoint[] {
  const gen = cycles(spec, startTick, endTick);
  const from = lastPointAtOrBefore(gen, startTick);
  const to = firstPointPast(gen, endTick, false);
  const start: AutomationPoint = {
    tick: startTick,
    value: valueAt(DISPLAY_ROW, gen, startTick),
    bend: gen[from]!.bend,
  };
  const end: AutomationPoint = {
    tick: endTick,
    value: segmentValue(DISPLAY_ROW, gen[to - 1]!, gen[to]!, endTick),
    bend: 0,
  };
  const inner = gen.filter((p) => p.tick > startTick && p.tick < endTick);
  return [start, ...inner, end];
}

/** Ramp and S-curve: bottom to top once across the range. */
function onceStamp(
  spec: AutomationShapeSpec,
  startTick: number,
  endTick: number,
): AutomationPoint[] {
  const at = placer(spec);
  if (spec.kind === 'ramp') return [at(startTick, 0, 0), at(endTick, 1, 0)];
  const mid = (startTick + endTick) / 2;
  return [
    at(startTick, 0, -SHAPE_S_CURVE_BEND),
    at(mid, 1 / 2, SHAPE_S_CURVE_BEND),
    at(endTick, 1, 0),
  ];
}

/**
 * The points that replace `[startTick, endTick]` with `spec`, in `row`'s
 * units (display space itself without one).
 */
export function stampShape(
  spec: AutomationShapeSpec,
  startTick: number,
  endTick: number,
  row: AutomationTargetRow = DISPLAY_ROW,
): AutomationPoint[] {
  if (!(endTick > startTick)) {
    throw new RangeError(`stampShape: the range ${startTick}..${endTick} is empty`);
  }
  const once = spec.kind === 'ramp' || spec.kind === 'sCurve';
  const display = once
    ? onceStamp(spec, startTick, endTick)
    : cyclicStamp(spec, startTick, endTick);
  if (row === DISPLAY_ROW) return display;
  return display.map((p) => ({ ...p, value: fromDisplay(row, p.value) }));
}

/** `points` with `[startTick, endTick]` replaced by `stamped`; the points outside are kept. */
export function replaceRange(
  points: readonly AutomationPoint[],
  startTick: number,
  endTick: number,
  stamped: readonly AutomationPoint[],
): AutomationPoint[] {
  return [
    ...points.filter((p) => p.tick < startTick),
    ...stamped,
    ...points.filter((p) => p.tick > endTick),
  ];
}
