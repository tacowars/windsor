/**
 * The bend for the right half of a bent segment split on its own line
 * (windsor#349, "add on the line"). The engine's curve is `u^k` in display
 * space (`bendCurve`): the left half of a split is that same curve with the
 * same bend, exactly, but the right half is no power law, so no one bend
 * reproduces it. It takes the bend whose curve is nearest the original's in
 * the least-squares sense over the half, in display space, found on a grid
 * over −1..1 and refined by golden-section search. Main thread only, once
 * per click, so it allocates freely.
 */
import type { AutomationPoint, AutomationTargetRow } from '@windsor/engine';
import { bendCurve, toDisplay } from '@windsor/engine';
import { AUTOMATION_SPLIT_FIT, type AutomationSplitFit } from './songAutomationTables';

/** The golden section's ratio, (√5 − 1) / 2: how far into an interval each probe sits. */
const GOLDEN = 0.6180339887498949;
const MIN_BEND = -1;
const MAX_BEND = 1;

/** The bend in `lo..hi` that minimises `cost`, by golden-section search. */
function goldenMin(
  cost: (bend: number) => number,
  range: { readonly lo: number; readonly hi: number },
  iterations: number,
): number {
  let { lo, hi } = range;
  let x1 = hi - GOLDEN * (hi - lo);
  let x2 = lo + GOLDEN * (hi - lo);
  let c1 = cost(x1);
  let c2 = cost(x2);
  for (let i = 0; i < iterations; i++) {
    if (c1 <= c2) {
      hi = x2;
      x2 = x1;
      c2 = c1;
      x1 = hi - GOLDEN * (hi - lo);
      c1 = cost(x1);
    } else {
      lo = x1;
      x1 = x2;
      c1 = c2;
      x2 = lo + GOLDEN * (hi - lo);
      c2 = cost(x2);
    }
  }
  return c1 <= c2 ? x1 : x2;
}

/** The bend on `fit`'s grid over −1..1 with the lowest `cost`, and the grid's step. */
function gridMin(
  cost: (bend: number) => number,
  gridSteps: number,
): { readonly bend: number; readonly cost: number; readonly step: number } {
  const step = (MAX_BEND - MIN_BEND) / gridSteps;
  let bend = MIN_BEND;
  let best = Infinity;
  for (let i = 0; i <= gridSteps; i++) {
    const c = cost(MIN_BEND + i * step);
    if (c < best) {
      best = c;
      bend = MIN_BEND + i * step;
    }
  }
  return { bend, cost: best, step };
}

/**
 * The bend for the right half of bent segment `a → b` split at fraction
 * `s`: the least-squares fit of the original curve over that half, sampled
 * at `fit.samples` points, in −1..1. An unbent or flat segment keeps its bend.
 */
export function rightHalfBend(
  row: AutomationTargetRow,
  a: AutomationPoint,
  b: AutomationPoint,
  s: number,
  fit: AutomationSplitFit = AUTOMATION_SPLIT_FIT,
): number {
  const rise = toDisplay(row, b.value) - toDisplay(row, a.value);
  if (a.bend === 0 || rise === 0) return a.bend;
  const at = bendCurve(s, a.bend, rise);
  const rest = 1 - at;
  if (!(rest > 0)) return a.bend;
  // The original's right half as a fraction of its own rise, at each sample.
  const vs = Array.from({ length: fit.samples }, (_, i) => (i + 1) / (fit.samples + 1));
  const targets = vs.map((v) => (bendCurve(s + (1 - s) * v, a.bend, rise) - at) / rest);
  const cost = (bend: number): number =>
    vs.reduce((sum, v, i) => sum + (targets[i]! - bendCurve(v, bend, rise)) ** 2, 0);
  const grid = gridMin(cost, fit.gridSteps);
  const range = {
    lo: Math.max(MIN_BEND, grid.bend - grid.step),
    hi: Math.min(MAX_BEND, grid.bend + grid.step),
  };
  const refined = goldenMin(cost, range, fit.refineIterations);
  return cost(refined) < grid.cost ? refined : grid.bend;
}
