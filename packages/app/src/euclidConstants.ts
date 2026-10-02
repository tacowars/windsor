/**
 * The Euclid card's tunables (windsor#356, record
 * `2026-10-01-euclid-lanes-and-ratchets`): the pitch lane's drag rate, the
 * density plot's size and reach, the Play section's knob columns and the
 * lane count. The limits on the rows themselves are the engine's
 * (`EUCLID_LANE_STEPS_MAX`, `EUCLID_PITCH_LANE_MAX`, `EUCLID_RATCHET_MAX`).
 */
import { STEP_MOD_LANES_MAX } from '@windsor/engine';

/** A pitch cell's vertical drag: pixels per semitone. */
export const EUCLID_PX_PER_SEMITONE = 6;

/** A non-zero pitch cell's shortest bar, as a share of the half-height, so ±1 still shows. */
export const EUCLID_PITCH_BAR_MIN = 0.12;

/** Semitones an arrow key moves a pitch cell. */
export const EUCLID_PITCH_KEY_STEP = 1;

/** Bars the density page's plot looks ahead from the current one. */
export const EUCLID_PLOT_BARS = 16;

/** The density plot's SVG box: its size, the inset of the k range, and the head room past the bounds. */
export const EUCLID_PLOT = {
  width: 200,
  height: 74,
  pad: 9,
  /** Steps of `k` the plot shows past each bound, so the band never touches an edge. */
  margin: 2,
  /** The label's baseline under the top edge. */
  labelY: 10,
  /** The bound labels' inset from the left edge. */
  labelX: 3,
} as const;

/** Decimals of the bar line's seconds an Hz plot is keyed by: it repaints when they move. */
export const EUCLID_PLOT_SECONDS_DIGITS = 3;

/** Decimals a fractional cycle in bars reads with. */
export const EUCLID_CYCLE_BAR_DIGITS = 2;

/**
 * The Play section's knob strip (windsor#393 decision 4), column by column
 * in the mockup's order: Vel, Acc vel and Acc mod, then Hold.
 */
export const EUCLID_KNOB_COLUMNS: readonly (readonly string[])[] = [
  ['velocity', 'accentVelocity', 'accentMod'],
  ['hold'],
];

/** A share as a CSS percentage: the density plot's labels sit on its lines. */
export const EUCLID_PERCENT = 100;

/** The most lanes a part carries: Accent and Pitch once each, then the sound lanes. */
export const EUCLID_LANES_MAX = 2 + STEP_MOD_LANES_MAX;
