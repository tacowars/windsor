/**
 * A knob's value ↔ sweep mapping and where an arrow key lands (moved out of
 * `knob.ts` with windsor#842's knee): a linear sweep, a log sweep, a log
 * sweep with a zero end (windsor#324), a stepped knob (windsor#712,
 * `knobSteps.ts`) and a knee knob over its catalog row (windsor#842), which
 * reads the lane's own map so the knob and the lane agree.
 * `knobScale.test.ts` pins every kind.
 */
import type { AutomationKnee, AutomationTargetRow } from '@windsor/engine';
import { fromDisplay, toDisplay } from '@windsor/engine';
import type { KnobSpec } from './knob';
import { KEY_STEP, KEY_STEP_FINE, LOG_FLOOR, ZERO_END_SLICE } from './knobConstants';
import { stepKeyTarget, steppedScale } from './knobSteps';

/** A knob's sweep: a value to its normalised position on the dial, and back. */
export interface Scale {
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
  /**
   * A zero-end knob's slice (`ZERO_END_SLICE`): the normalised position its
   * log sweep starts at, its floor. Below it the dial runs straight from 0 to
   * the floor. Absent on a knob without a zero end.
   */
  readonly zeroTop?: number;
}

/** The part of a spec that decides where a value or a key press lands. */
export type KnobScaleSpec = Pick<
  KnobSpec,
  'min' | 'max' | 'step' | 'curve' | 'logFloor' | 'knee' | 'steps'
>;

const clampNorm = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * A log sweep from `floor` to `max`; every value up to the floor sits at its
 * bottom. Its two ends are the floor and `max` exactly, not `exp(log(…))`'s
 * neighbour of them, so a knob at either end reads back what it was set to.
 */
function logSweep(floor: number, max: number): Scale {
  const lo = Math.log(floor);
  const hi = Math.log(max);
  return {
    toNorm: (v) => (Math.log(Math.max(floor, v)) - lo) / (hi - lo),
    fromNorm: (n) => {
      if (n <= 0) return floor;
      return n >= 1 ? max : Math.exp(lo + n * (hi - lo));
    },
  };
}

/**
 * A log knob whose `min` is 0 (windsor#324 fix round 2): the bottom
 * `ZERO_END_SLICE` of the dial runs straight from exact 0 to its `logFloor`,
 * and the log sweep from the floor to `max` fills the rest. The floor keeps a
 * position of its own above 0, and a value under it (the refitted kicks ship
 * some) one of its own inside the slice, so `fromNorm(toNorm(v))` is `v`
 * across the whole range and a touch moves nothing.
 */
function zeroEndLogScale(floor: number, max: number): Scale {
  const sweep = logSweep(floor, max);
  const top = ZERO_END_SLICE;
  return {
    zeroTop: top,
    toNorm: (v) => {
      if (v <= 0) return 0;
      return v < floor ? (v / floor) * top : top + (1 - top) * sweep.toNorm(v);
    },
    fromNorm: (n) => {
      if (n <= 0) return 0;
      return n < top ? floor * (n / top) : sweep.fromNorm((n - top) / (1 - top));
    },
  };
}

/**
 * A knee knob's sweep (windsor#842): the lane's map on a `knee` row of the
 * knob's bounds, so the knob and its catalog row's lane cannot disagree.
 */
function kneeScale(min: number, max: number, knee: AutomationKnee): Scale {
  const row: AutomationTargetRow = {
    target: '',
    label: '',
    min,
    max,
    scale: 'knee',
    unit: '',
    knee,
  };
  return { toNorm: (v) => toDisplay(row, v), fromNorm: (n) => fromDisplay(row, n) };
}

/**
 * The knob's value ↔ sweep mapping. A log knob whose `min` is 0 ends its
 * dial on exact 0 (`zeroEndLogScale`), so a 0 that means
 * something (an envelope stage that ends on its own sample, windsor#316) can
 * be dialled, shown and committed.
 */
export function scaleFor(spec: KnobScaleSpec): Scale {
  if (spec.steps) return steppedScale(spec.steps);
  if (spec.knee) return kneeScale(spec.min, spec.max, spec.knee);
  if (spec.curve === 'log') {
    if (spec.min <= 0) return zeroEndLogScale(spec.logFloor ?? LOG_FLOOR, spec.max);
    return logSweep(Math.max(LOG_FLOOR, spec.min), spec.max);
  }
  return {
    toNorm: (v) => (v - spec.min) / (spec.max - spec.min),
    fromNorm: (n) => spec.min + clampNorm(n) * (spec.max - spec.min),
  };
}

/**
 * Where an arrow key lands, before `commit` rounds and clamps it: the key's
 * share of the sweep, or exactly one `step` when that share is finer than the
 * knob's own grid. Without the fallback a coarsely stepped knob rounds
 * straight back to where it stood and the keyboard cannot move it at all —
 * Coarse (0..24 by 1) falls 2% of its range short, and so does shift on
 * Detune (#587). Inside a zero end's slice a press lands on the fine key
 * grid, so a press up from 0 and one back down return to exact 0, not to a
 * rounding error's neighbour of it.
 */
export function keyTarget(
  spec: KnobScaleSpec,
  current: number,
  dir: 1 | -1,
  fine: boolean,
): number {
  if (spec.steps) return stepKeyTarget(spec.steps, current, dir);
  const scale = scaleFor(spec);
  let n = scale.toNorm(current) + dir * (fine ? KEY_STEP_FINE : KEY_STEP);
  if (scale.zeroTop !== undefined && n < scale.zeroTop) {
    n = Math.round(n / KEY_STEP_FINE) * KEY_STEP_FINE;
  }
  const raw = scale.fromNorm(n);
  const step = spec.step ?? 0;
  return step > 0 && Math.abs(raw - current) < step ? current + dir * step : raw;
}
