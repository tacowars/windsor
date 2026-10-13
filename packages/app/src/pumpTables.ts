/**
 * The Pump card's tunables (record `2026-10-13-pump-insert` decision 6): the
 * editor's plot and its hit sizes, the grid the points snap to, and how the
 * key's trace is scaled and held behind the shape; and its knobs, on the
 * engine's ranges and defaults.
 */
import { DEFAULT_PUMP, PUMP_BOUNDS } from '@windsor/engine';
import type { PumpSpec } from '@windsor/engine';
import { fmt2 } from './consoleFormat';
import type { InsertKnobEntry } from './insertKnobTables';

export const PUMP_PLOT = {
  /** The canvas's CSS px, the EQ's plot's. */
  width: 384,
  height: 160,
  /** Space inside the frame, so a point on an edge can still be grabbed. */
  pad: 7,
  /** How near a press must be to a point, or to a bend handle, in px. */
  hitPx: 8,
  pointRadius: 4,
  handleRadius: 3,
  /** Px of vertical drag that move a bend by its whole range. */
  bendDragPx: 120,
  labelFont: '9px ui-monospace, monospace',
} as const;

/** The grid across the cycle: lines at every step, stronger at each beat-group, and the snap. */
export const PUMP_GRID = {
  steps: 16,
  major: 4,
  /** Level lines, linear. */
  levels: [0.25, 0.5, 0.75],
} as const;

/** The key's trace behind the shape: its level in dB, from `floorDb` (the bottom) to 0. */
export const PUMP_TRACE = {
  floorDb: -48,
  /** Each new cycle's trace over the held one: older cycles fade by this each time. */
  holdDecay: 0.6,
} as const;

/** Depth's readout, as a percentage. */
export const PUMP_PERCENT = 100;

export const PUMP_LABELS = {
  plot: 'Pump shape: press to add or move a point, double-click a point to remove it, drag a diamond to bend a segment. Alt moves off the grid.',
  sync: 'Sync',
  division: 'Length',
  undo: 'Pump shape',
} as const;

const percent = (v: number): string => `${Math.round(v * PUMP_PERCENT)}%`;
/** Below this many ms a time reads to a tenth. */
const MS_TENTHS_BELOW = 10;
const ms = (v: number): string => `${v.toFixed(v < MS_TENTHS_BELOW ? 1 : 0)}ms`;
const B = PUMP_BOUNDS;
const D = DEFAULT_PUMP;

/** The Pump's knobs: Depth at the big dial, then the cycle's length in ms and the detector. */
export const PUMP_KNOBS: readonly InsertKnobEntry<PumpSpec>[] = [
  {
    f: 'depth',
    label: 'Depth',
    o: { min: B.depth[0], max: B.depth[1], def: D.depth, fmt: percent },
  },
  {
    f: 'lengthMs',
    label: 'Length',
    o: { min: B.lengthMs[0], max: B.lengthMs[1], def: D.lengthMs, curve: 'log', fmt: ms },
  },
  {
    f: 'sensitivity',
    label: 'Sens',
    o: { min: B.sensitivity[0], max: B.sensitivity[1], def: D.sensitivity, fmt: fmt2 },
  },
  {
    f: 'holdMs',
    label: 'Hold',
    o: { min: B.holdMs[0], max: B.holdMs[1], def: D.holdMs, curve: 'log', fmt: ms },
  },
  {
    f: 'smoothMs',
    label: 'Smooth',
    o: { min: B.smoothMs[0], max: B.smoothMs[1], def: D.smoothMs, fmt: ms },
  },
];
