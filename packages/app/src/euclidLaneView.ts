/**
 * How the Euclid card lays its lanes out and where each row's playhead is
 * (windsor#356, record `2026-10-01-euclid-lanes-and-ratchets` decisions 2
 * and 9). Two views, the console's and never the song's:
 *
 * - **own length**: lane cell `i` is lane step `i`, one cell per lane step;
 *   its playhead is `laneStep(localStep, length)`.
 * - **under the hits**: one cell per trigger step, cell `i` showing lane
 *   step `(pass × steps + i) mod length`, the pass being the trigger's
 *   current one; a notch where the lane restarts and the cells under a rest
 *   dimmed. Its playhead is the trigger's step.
 *
 * Either way an edit writes the lane index the cell shows. Every position
 * is the engine's: `RegionStep.localStep` (windsor#355) and `laneStep`, in
 * `regionPlayhead.ts`'s numbering (a step, a ghost below -1, or dark).
 */
import type { RegionStep } from '@windsor/engine';
import { TICKS_PER_BAR, laneStep } from '@windsor/engine';
import { EUCLID_CYCLE_BAR_DIGITS } from './euclidConstants';
import { DARK, ghostOf } from './regionPlayhead';

export type LaneView = 'own' | 'hits';
export const LANE_VIEWS: readonly LaneView[] = ['own', 'hits'];

/** One lane row's layout: the view, the trigger's steps and pass, the lane's length. */
export interface LaneLayout {
  readonly view: LaneView;
  readonly steps: number;
  readonly pass: number;
  readonly length: number;
}

/** Cells the row draws: the lane's length, or one per trigger step. */
export const cellCount = (layout: LaneLayout): number =>
  layout.view === 'own' ? layout.length : layout.steps;

/** The lane index cell `cell` shows and writes. */
export function cellLaneIndex(layout: LaneLayout, cell: number): number {
  if (layout.view === 'own') return cell;
  return laneStep(layout.pass * layout.steps + cell, layout.length);
}

/** Whether a notch marks cell `cell`: under the hits, where the lane starts over. */
export const restartsAt = (layout: LaneLayout, cell: number): boolean =>
  layout.view === 'hits' && cell > 0 && cellLaneIndex(layout, cell) === 0;

/** Whether cell `cell` is dimmed: under the hits, over a rest of the trigger's figure. */
export const dimmedAt = (layout: LaneLayout, figure: readonly boolean[], cell: number): boolean =>
  layout.view === 'hits' && figure[cell] !== true;

/** The trigger's local step in a region step: the engine's, or its step when the kind reports none. */
const localOf = (at: RegionStep): number => at.localStep ?? at.step;

/** The trigger's pass at `at`: whole figures since the region's entry, 0 while nothing plays. */
export function passOf(at: RegionStep | null, steps: number): number {
  if (!at || at.step < 0 || steps < 1) return 0;
  return Math.max(0, Math.floor(localOf(at) / steps));
}

/** A cell lit at `at`'s strength: bright while live, else its ghost; dark with no position. */
const lit = (at: RegionStep | null, cell: number): number => {
  if (!at || at.step < 0) return DARK;
  return at.live ? cell : ghostOf(cell);
};

/** The trigger row's (and the ratchet row's) playhead. */
export const triggerHead = (at: RegionStep | null): number => lit(at, at?.step ?? DARK);

/** A lane row's playhead: its own step at its own length, or the trigger's step under the hits. */
export function laneHead(at: RegionStep | null, layout: LaneLayout): number {
  if (!at || at.step < 0) return DARK;
  return lit(at, layout.view === 'own' ? laneStep(localOf(at), layout.length) : at.step);
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

/** The full cycle: the least common multiple of the trigger's steps and every lane's length, in steps and bars. */
export function fullCycle(
  steps: number,
  lengths: readonly number[],
  divisor: number,
): { steps: number; bars: number } {
  const cycle = lengths.reduce((acc, n) => (n > 0 ? lcm(acc, n) : acc), Math.max(1, steps));
  return { steps: cycle, bars: (cycle * divisor) / TICKS_PER_BAR };
}

/** The cycle's line: `Rows line up every 35 bars (560 steps)`. */
export function cycleText(cycle: { steps: number; bars: number }): string {
  const { bars } = cycle;
  const whole = Number.isInteger(bars);
  const shown = whole ? String(bars) : String(Number(bars.toFixed(EUCLID_CYCLE_BAR_DIGITS)));
  const unit = whole && bars === 1 ? 'bar' : 'bars';
  return `Rows line up every ${shown} ${unit} (${cycle.steps} steps)`;
}
