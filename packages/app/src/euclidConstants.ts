/**
 * The Euclid card's tunables (windsor#356, record
 * `2026-10-01-euclid-lanes-and-ratchets`): the pitch lane's drag rate, the
 * density plot's size and reach, and the card's words. The limits on the
 * rows themselves are the engine's (`EUCLID_LANE_STEPS_MAX`,
 * `EUCLID_PITCH_LANE_MAX`, `EUCLID_RATCHET_MAX`).
 */

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

/** Decimals a fractional cycle in bars reads with. */
export const EUCLID_CYCLE_BAR_DIGITS = 2;

/** The card's hint, on the rail's ? (decision 1). */
export const EUCLID_HINT =
  'Lit cells are hits; the ring on each row is its playhead. Click a trigger cell to flip it: ' +
  'the figure freezes and the row reads Release, which lets the modulator back in. Ratchets ' +
  'split a hit into 2, 3 or 4. Lanes are read when a hit sounds, each at its own length. ' +
  'The toggle above shows lanes at their own length or laid out under this pass of the hits. ' +
  'Nothing here restarts the sequencer; only the divisor rebuilds it.';

/** The readout line's resting text. */
export const EUCLID_READOUT_HINT = 'Hover a cell to read it. The ring on each row is its playhead.';
