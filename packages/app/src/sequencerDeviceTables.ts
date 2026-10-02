/**
 * The sequencer device's sizes (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decisions 1, 4 and 5; the look is
 * `docs/research/2026-09-30-sequencer-rack/grid.html`). As the insert rack
 * does with `INSERT_RACK_PX`, `sequencerDevice.ts` sets each entry on the
 * pane's row as a CSS custom property and `console.css` reads it, so every
 * number is written once, here.
 */
import { PERC_COLOR, PITCH_COLOR } from './consoleColors';
import type { LaneTone } from './songViewTables';

/** The Grid's step rows, top down, in px: the step number, note, degree, Oct, A, S, ratchet. */
export const GRID_HEAD_ROWS_PX: readonly number[] = [12, 18, 18, 18, 18, 18, 14];

/** The gap between a step column's cells, in px. */
export const STRIP_ROW_GAP_PX = 2;

/** The height of a column's step rows: what the lane names' corner matches, so a name sits level with its lane. */
export const stripHeadPx = (
  rows: readonly number[] = GRID_HEAD_ROWS_PX,
  gap = STRIP_ROW_GAP_PX,
): number => rows.reduce((sum, row) => sum + row, 0) + gap * Math.max(0, rows.length - 1);

/** Custom property → px. */
export const SEQUENCER_DEVICE_PX: Readonly<Record<string, number>> = {
  /** A converted device's height (the insert rack's `--rack-h` is 196). */
  '--seq-h': 244,
  /** The side rail: dot, name, the device's own buttons, the region, Split and Delete. */
  '--seq-rail': 24,
  /** A step column's width. */
  '--step-w': 32,
  /** The extra space before each group of four steps. */
  '--beat-gap': 4,
  /** One modulation lane's height. */
  '--lane-h': 42,
  /** The lane names' column, with + Lane in its corner. */
  '--names-w': 96,
  /** The step rows held at the top of the strip. */
  '--strip-head-h': stripHeadPx(),
  /** A column holding a picker and a button. */
  '--seq-wide-col': 96,
  /** A knob's dial in the device, the insert rack's small dial. */
  '--seq-dial': 30,
};

/** A part's accent on its device (the mockup's `--kc`): the dot, the knob arcs, the lit cells. */
export const DEVICE_ACCENT: Readonly<Record<LaneTone, string>> = {
  perc: PERC_COLOR,
  pitch: PITCH_COLOR,
  none: 'var(--ink-faint)',
};
