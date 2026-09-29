/**
 * The modulation lanes' console data (windsor#31): what the picker and a
 * lane's name read for each engine `StepModParam`, how a played value
 * prints, and the lane's painting tunables. The engine's `STEP_MOD_TABLE`
 * holds the curve, span and bounds and no display names; this table is the
 * console's half, keyed by the same parameter, and
 * `stepModLaneTables.test.ts` fails when an engine row has no label here.
 */
import type { StepModParam } from '@windsor/engine';
import { fmt2, fmtHz, fmtMs, fmtSigned } from './consoleFormat';

/** What the console shows for one parameter: its name and how its played value prints. */
export interface StepModLaneLabel {
  readonly label: string;
  readonly fmt: (value: number) => string;
}

/** Every modulatable parameter's name, in the engine's slot order. */
export const STEP_MOD_LANE_LABELS: Readonly<Record<StepModParam, StepModLaneLabel>> = {
  'filter.envAmount': { label: 'Filter Env Amt', fmt: fmtSigned },
  'filter.cutoff': { label: 'Cutoff', fmt: fmtHz },
  'filter.resonance': { label: 'Resonance', fmt: fmt2 },
  'filter.env.decayTime': { label: 'Filter Decay', fmt: fmtMs },
  'ops.0.level': { label: 'Op A Level', fmt: fmt2 },
  'ops.0.env.decayTime': { label: 'Op A Decay', fmt: fmtMs },
  'ops.0.env.decayCurve': { label: 'Op A Decay Crv', fmt: fmtSigned },
  'ops.0.feedback': { label: 'Op A Feedback', fmt: fmtSigned },
  'ops.0.width': { label: 'Op A Width', fmt: fmt2 },
  'ops.1.level': { label: 'Op B Level', fmt: fmt2 },
  'ops.1.env.decayTime': { label: 'Op B Decay', fmt: fmtMs },
  'ops.1.env.decayCurve': { label: 'Op B Decay Crv', fmt: fmtSigned },
  'ops.1.feedback': { label: 'Op B Feedback', fmt: fmtSigned },
  'ops.1.width': { label: 'Op B Width', fmt: fmt2 },
  'ops.2.level': { label: 'Op C Level', fmt: fmt2 },
  'ops.2.env.decayTime': { label: 'Op C Decay', fmt: fmtMs },
  'ops.2.env.decayCurve': { label: 'Op C Decay Crv', fmt: fmtSigned },
  'ops.2.feedback': { label: 'Op C Feedback', fmt: fmtSigned },
  'ops.2.width': { label: 'Op C Width', fmt: fmt2 },
  'ops.3.level': { label: 'Op D Level', fmt: fmt2 },
  'ops.3.env.decayTime': { label: 'Op D Decay', fmt: fmtMs },
  'ops.3.env.decayCurve': { label: 'Op D Decay Crv', fmt: fmtSigned },
  'ops.3.feedback': { label: 'Op D Feedback', fmt: fmtSigned },
  'ops.3.width': { label: 'Op D Width', fmt: fmt2 },
};

/** How a lane cell turns a pointer into a value. */
export interface LanePaintTable {
  /** A value this close to 0 snaps to 0, so the patch's own setting is easy to hit. */
  readonly snapBand: number;
  /** Values are held to 1 / `divisions` of the half-travel: 100 keeps two decimals. */
  readonly divisions: number;
}

export const LANE_PAINT: LanePaintTable = { snapBand: 0.05, divisions: 100 };

/** Decimals an `octaves` row's offset reads with, `+2.1 oct`. */
export const LANE_OCTAVE_DIGITS = 1;

/**
 * A lane cell's double-click window, ms: a press and release that doesn't
 * move shows its value at once but is written only when this runs out, so a
 * second press on the cell inside it resets to 0 with nothing else written.
 * A UI timing near the usual desktop double-click interval, not a
 * measurement.
 */
export const LANE_DOUBLE_CLICK_MS = 250;

/** Pointer travel, px, under which a press and release is a click rather than a drag. */
export const LANE_CLICK_SLOP_PX = 3;
