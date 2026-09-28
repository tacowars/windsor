/**
 * The Parts tab's panel tunables (#618): the algorithm thumbnail's geometry,
 * the bay-off threshold and the duty a Pulse operator starts at.
 */

/** The algorithm picker's thumbnail: one box per operator on a row per modulation depth. */
export const ALG_THUMB = {
  width: 58,
  /** Row pitch, in px. */
  cell: 15,
  /** Top and bottom margin. */
  pad: 4,
  boxWidth: 14,
  boxHeight: 9,
  boxRadius: 1.5,
  /** Modulation links stop this far short of each box's edge. */
  linkInset: 4,
  fontSize: 7,
  /** The letter's baseline offset below the box centre. */
  textDy: 3,
  carrierOpacity: 0.9,
  modulatorOpacity: 0.32,
} as const;

/** A bay whose level is at or under this is drawn faded. */
export const BAY_SILENT_LEVEL = 0.0001;

/**
 * The width a Pulse operator is given when the picker switches it to Pulse at
 * full width (windsor#56): a square. At width 1 a Pulse's two saws cancel.
 */
export const PULSE_START_WIDTH = 0.5;
