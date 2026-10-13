/**
 * The Pump editor's model (record `2026-10-13-pump-insert` decision 6): where
 * a point stands on the plot, what a press hits, and each edit as a new
 * point list. Pure, so `pumpCurveModel.test.ts` can pin every gesture's
 * result without a canvas. The ends stay at 0 and 1 of the cycle; an inner
 * point moves between its neighbours; a bend handle sits on the curve at
 * its segment's middle.
 */
import { PUMP_MAX_POINTS, PUMP_POINT_BOUNDS, pumpLevelAt } from '@windsor/engine';
import type { PumpPoint } from '@windsor/engine';
import { PUMP_GRID, PUMP_PLOT } from './pumpTables';

export interface PumpPlot {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
}

export interface PlotPoint {
  readonly x: number;
  readonly y: number;
}

/** What a press found: a point, a segment's bend handle, or nothing. */
export type PumpHit =
  | { readonly kind: 'point'; readonly index: number }
  | { readonly kind: 'bend'; readonly index: number }
  | { readonly kind: 'none' };

const HALF = 0.5;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const xOf = (plot: PumpPlot, at: number): number =>
  plot.pad + at * (plot.width - 2 * plot.pad);
export const yOf = (plot: PumpPlot, level: number): number =>
  plot.pad + (1 - level) * (plot.height - 2 * plot.pad);
export const atOf = (plot: PumpPlot, x: number): number =>
  clamp((x - plot.pad) / (plot.width - 2 * plot.pad), 0, 1);
export const levelOf = (plot: PumpPlot, y: number): number =>
  clamp(1 - (y - plot.pad) / (plot.height - 2 * plot.pad), 0, 1);

/** `at` on the grid, unless `free`. */
export const snapped = (at: number, free: boolean): number =>
  free ? at : Math.round(at * PUMP_GRID.steps) / PUMP_GRID.steps;

/** Where segment `i`'s bend handle stands: its middle in time, on the curve. */
export function handleOf(points: readonly PumpPoint[], i: number, plot: PumpPlot): PlotPoint {
  const at = (points[i]!.at + points[i + 1]!.at) * HALF;
  return { x: xOf(plot, at), y: yOf(plot, pumpLevelAt(points, at)) };
}

const near = (a: PlotPoint, b: PlotPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The point under `at` (the nearest within reach), else a bend handle, else none. */
export function hitPump(points: readonly PumpPoint[], at: PlotPoint, plot: PumpPlot): PumpHit {
  let best = -1;
  let bestPx: number = PUMP_PLOT.hitPx;
  points.forEach((p, i) => {
    const d = near(at, { x: xOf(plot, p.at), y: yOf(plot, p.level) });
    if (d <= bestPx) {
      best = i;
      bestPx = d;
    }
  });
  if (best >= 0) return { kind: 'point', index: best };
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i + 1]!.at === points[i]!.at) continue;
    if (near(at, handleOf(points, i, plot)) <= PUMP_PLOT.hitPx) return { kind: 'bend', index: i };
  }
  return { kind: 'none' };
}

/** A new point at `at` (snapped unless `free`), straight, in order; null when the shape is full. */
export function addPoint(
  points: readonly PumpPoint[],
  at: PlotPoint,
  plot: PumpPlot,
  free: boolean,
): { points: PumpPoint[]; index: number } | null {
  if (points.length >= PUMP_MAX_POINTS) return null;
  const position = clamp(snapped(atOf(plot, at.x), free), 0, 1);
  // After every point at or before it, so it lands inside the span it was pressed in.
  let index = points.findIndex((p) => p.at > position);
  if (index <= 0) index = points.length - 1;
  const point: PumpPoint = { at: position, level: levelOf(plot, at.y), bend: 0 };
  return { points: [...points.slice(0, index), point, ...points.slice(index)], index };
}

/** Point `index` moved to `at`: the ends keep their place in time, an inner one stays between its neighbours. */
export function movePoint(
  points: readonly PumpPoint[],
  index: number,
  at: PlotPoint,
  plot: PumpPlot,
  free: boolean,
): PumpPoint[] {
  const last = points.length - 1;
  const point = points[index]!;
  const position =
    index === 0 || index === last
      ? point.at
      : clamp(snapped(atOf(plot, at.x), free), points[index - 1]!.at, points[index + 1]!.at);
  const next = { ...point, at: position, level: levelOf(plot, at.y) };
  return points.map((p, i) => (i === index ? next : p));
}

/** Point `index` gone, unless it is an end. */
export function removePoint(points: readonly PumpPoint[], index: number): PumpPoint[] {
  if (index <= 0 || index >= points.length - 1) return [...points];
  return points.filter((_, i) => i !== index);
}

/**
 * Segment `index`'s bend after a vertical drag of `upPx` (up positive) from
 * `from`: the handle follows the pointer, so a rising segment bends early as
 * it is pulled up and a falling one bends late.
 */
export function bendPoint(
  points: readonly PumpPoint[],
  index: number,
  from: number,
  upPx: number,
): PumpPoint[] {
  const rising = points[index + 1]!.level >= points[index]!.level;
  const [lo, hi] = PUMP_POINT_BOUNDS.bend;
  const delta = ((hi - lo) * upPx) / PUMP_PLOT.bendDragPx;
  const bend = clamp(from + (rising ? delta : -delta), lo, hi);
  return points.map((p, i) => (i === index ? { ...p, bend } : p));
}

/** Segment `index` straight again. */
export const straighten = (points: readonly PumpPoint[], index: number): PumpPoint[] =>
  points.map((p, i) => (i === index ? { ...p, bend: 0 } : p));
