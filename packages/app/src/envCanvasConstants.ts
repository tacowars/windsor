/** The envelope display's drawing tunables (#618). */

/** Margin inside the canvas, in px. */
export const ENV_PAD_PX = 4;
/** The sustain hold drawn between decay and release: a share of the timed total, never shorter than this. */
export const ENV_HOLD_SHARE = 0.28;
export const ENV_HOLD_MIN_S = 0.02;
/** Line segments per envelope stage. */
export const ENV_SEGMENT_POINTS = 26;
/** The sustain guide's dash pattern and the curve's stroke width. */
export const ENV_GUIDE_DASH: readonly number[] = [2, 3];
export const ENV_TRACE_WIDTH = 1.6;
