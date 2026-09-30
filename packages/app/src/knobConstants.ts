/** The knob widget's tunables (#618): how far a drag or a key press moves it, and its geometry. */

/** Pixels of vertical drag for one full sweep, and the finer share under shift. */
export const DRAG_RANGE_PX = 190;
export const DRAG_RANGE_FINE_PX = 900;
/** One arrow key's share of the sweep, and shift's finer share of it. */
export const KEY_STEP = 0.02;
export const KEY_STEP_FINE = 0.002;

/** The dial: radius, the sweep's two ends in degrees, and the SVG's padding. */
export const KNOB_R = 15;
export const ARC_START = -135;
export const ARC_END = 135;
export const KNOB_PAD_PX = 8;
/**
 * The compact dial (windsor#157): the Song tab's mixer column, in a 40 px
 * row, with its value beside it and no label under it.
 */
export const KNOB_COMPACT_R = 10;
export const KNOB_COMPACT_PAD_PX = 6;
/** The face sits inside the track; the pin stops short of the rim. */
export const FACE_INSET = 3.5;
export const PIN_INSET = 5;
/** An arc shorter than this is not drawn at all (the value sits on zero). */
export const ARC_MIN_DEGREES = 0.4;
/** Degrees in a half turn, for the polar conversion and the large-arc flag. */
export const HALF_TURN_DEGREES = 180;
/** SVG angles start at three o'clock; the dial's start at twelve. */
export const TWELVE_OCLOCK_DEGREES = 90;
/** The floor a log-scaled knob takes below its own minimum, so `log(0)` never happens. */
export const LOG_FLOOR = 1e-6;
/** `aria-valuenow` rounds to this many parts per unit. */
export const ARIA_VALUE_PRECISION = 1000;
