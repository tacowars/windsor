/**
 * Swing's tunables (windsor#14): the bounds a song's `transport.swing` is
 * clamped into, the straight default, and each grid's pair length in ticks.
 *
 * The amount is the MPC convention: where the off-beat lands within its
 * pair, as a percentage of the pair's length. 50 is straight, 66.7 a triplet
 * feel, 75 hard. The grid names the note whose second of each pair is
 * delayed: 16 swings the off-beat 16th inside each 8th, 8 the off-beat 8th
 * inside each quarter.
 */

/** The grids a song may swing: the second 8th or the second 16th of each pair. */
export const SWING_GRIDS = [8, 16] as const;
export type SwingGrid = (typeof SWING_GRIDS)[number];

/** A song's swing: one amount and one grid, shared by every part. */
export interface Swing {
  /** Where the off-beat lands in its pair, in percent of the pair: 50 (straight) to 75. */
  readonly amount: number;
  readonly grid: SwingGrid;
}

export const SWING_AMOUNT_MIN = 50;
export const SWING_AMOUNT_MAX = 75;
export const SWING_GRID_DEFAULT: SwingGrid = 16;

/** Straight: what a song without a (valid) swing plays, bit for bit as before windsor#14. */
export const STRAIGHT_SWING: Swing = { amount: SWING_AMOUNT_MIN, grid: SWING_GRID_DEFAULT };

/** What the warp reads: the percent scale and each grid's pair length on the 24 PPQ grid. */
export interface SwingTable {
  /** The amount's full scale: 100 percent. */
  readonly percent: number;
  /** The amount that is straight: the warp is the identity there, and the least one. */
  readonly straight: number;
  /** The hardest amount the clock plays; past it the second half of a pair would vanish. */
  readonly max: number;
  /** Ticks in one pair — a quarter for the 8ths grid, an 8th for the 16ths grid. */
  readonly pairTicks: Readonly<Record<SwingGrid, number>>;
}

/** The shipped table. `swing.test.ts` pins the pair lengths to `DIVISORS`. */
export const SWING_TABLE: SwingTable = {
  percent: 100,
  straight: SWING_AMOUNT_MIN,
  max: SWING_AMOUNT_MAX,
  pairTicks: { 8: 24, 16: 12 },
};
