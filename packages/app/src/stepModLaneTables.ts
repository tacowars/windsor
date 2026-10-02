/**
 * The modulation lanes' painting tunables (windsor#31). A lane's name and
 * how its played value prints are the engine's automation catalog's
 * (`VOICE_AUTOMATION_ROWS`, windsor#424), read through `catalogRow` and
 * `automationReadout.ts`, so a step lane and a song lane on one target say
 * the same thing.
 */

/** How a lane cell turns a pointer into a value. */
export interface LanePaintTable {
  /** A value this close to 0 snaps to 0, so the patch's own setting is easy to hit. */
  readonly snapBand: number;
  /** Values are held to 1 / `divisions` of the half-travel: 100 keeps two decimals. */
  readonly divisions: number;
}

export const LANE_PAINT: LanePaintTable = { snapBand: 0.05, divisions: 100 };

/** Decimals a `ratio` row's offset reads with, `+2.1 oct`. */
export const LANE_OCTAVE_DIGITS = 1;

/**
 * A lane cell's double-click window, ms: a still second press on a cell that
 * starts within this of the last click's release resets the cell to 0.
 * A UI timing near the usual desktop double-click interval, not a
 * measurement.
 */
export const LANE_DOUBLE_CLICK_MS = 250;

/** Pointer travel, px, under which a press and release is a click rather than a drag. */
export const LANE_CLICK_SLOP_PX = 3;
