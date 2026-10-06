/**
 * Display space (windsor#341, record `2026-10-01-song-automation-lanes`
 * decision 5): a target's value mapped onto 0..1 of the lane's height along
 * its knob's scale, and back. Bends, drawing and shapes all work here, so a
 * straight line on the level lane is an even fade in dB and one on the
 * cutoff lane an even sweep in octaves.
 *
 * - `linear`: `(v − min) / (max − min)`.
 * - `switch` (windsor#628): off at the bottom, on at the top; a height at
 *   or above `AUTOMATION_SWITCH_ON_AT` reads back as on. A switch value
 *   reads `Off` or `On` (`switchReading`).
 * - `db`, `octaves`, `log`: `log(v / lo) / log(max / lo)`, `lo` the row's
 *   `floor` or else its `min`. A level in dB is the log of its gain, so the
 *   `db` row is the same map from its floor in dB to its max in dB; a value
 *   at or below the floor is 0, and 0 maps back to the row's `min`.
 *
 * Both ends map exactly: `fromDisplay(row, 1)` is `max` and
 * `fromDisplay(row, 0)` is `min`, not `exp(log(…))`'s neighbour of them.
 * Values outside the row clamp to its ends. `automationDisplay.test.ts`
 * pins the round trip on every scale.
 */
import { AUTOMATION_SWITCH_ON_AT } from './automationConstants';
import type { AutomationTargetRow } from './automationLane';

/** The identity row: display space itself, a linear 0..1. */
export const DISPLAY_ROW: AutomationTargetRow = {
  target: '',
  label: '',
  min: 0,
  max: 1,
  scale: 'linear',
  unit: '',
};

const clampUnit = (y: number): number => (y < 0 ? 0 : y > 1 ? 1 : y);

/** The bottom of a logarithmic row's sweep. */
const logBottom = (row: AutomationTargetRow): number => row.floor ?? row.min;

/** `value`, in the row's units, as a height in 0..1. */
export function toDisplay(row: AutomationTargetRow, value: number): number {
  if (row.scale === 'switch') return switchValue(value);
  if (row.scale === 'linear') return clampUnit((value - row.min) / (row.max - row.min));
  const lo = logBottom(row);
  if (value <= lo) return 0;
  return clampUnit(Math.log(value / lo) / Math.log(row.max / lo));
}

/** A height in 0..1 as a value in the row's units. */
export function fromDisplay(row: AutomationTargetRow, y: number): number {
  if (y <= 0) return row.min;
  if (y >= 1) return row.max;
  if (row.scale === 'switch') return switchValue(y) === 1 ? row.max : row.min;
  if (row.scale === 'linear') return row.min + y * (row.max - row.min);
  const lo = logBottom(row);
  return lo * Math.exp(y * Math.log(row.max / lo));
}

/** A switch's value, 0 or 1: 1 at or above `onAt`. */
export function switchValue(value: number, onAt = AUTOMATION_SWITCH_ON_AT): 0 | 1 {
  return value >= onAt ? 1 : 0;
}

/** What a switch value reads: `On` at or above `onAt`, `Off` below. */
export function switchReading(value: number, onAt = AUTOMATION_SWITCH_ON_AT): 'Off' | 'On' {
  return switchValue(value, onAt) === 1 ? 'On' : 'Off';
}
