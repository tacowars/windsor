/**
 * The strip inserts' tunables (#641): how many a strip may carry, and each
 * kind's ranges and defaults. The logic reads these; the console's knobs read
 * the same numbers, so a range is stated once.
 */

/** Inserts per strip. A song cannot allocate unbounded DSP (#641). */
export const MAX_INSERTS = 2;

/* --------------------------------- drive --------------------------------- */

/** An amplitude in dB as a gain: `Math.exp(dB · this)`, which is 10^(dB / 20). */
export const GAIN_EXPONENT_PER_DB = Math.LN10 / 20;

/** How hard the signal hits the shaper, in dB of gain before it. */
export const DRIVE_GAIN_MIN_DB = 0;
export const DRIVE_GAIN_MAX_DB = 36;
export const DRIVE_GAIN_DEFAULT_DB = 12;
/** The lowpass after the shaper, in Hz: how much of the added fizz is kept. */
export const DRIVE_TONE_MIN_HZ = 500;
export const DRIVE_TONE_MAX_HZ = 16000;
export const DRIVE_TONE_DEFAULT_HZ = 8000;
/** Wet share: 0 is the dry signal, 1 is the shaped signal alone. */
export const DRIVE_MIX_DEFAULT = 1;
/**
 * The level the output compensation holds constant: a sample at this level
 * leaves the shaper at the same level whatever the drive, so turning the knob
 * changes the colour more than the loudness. −12 dBFS.
 */
export const DRIVE_REFERENCE_LEVEL = 0.25;
/** The shaper curve's span, in multiples of full scale, and its size (`tanhCurve.ts`). */
export const DRIVE_CURVE_RANGE = 8;
export const DRIVE_CURVE_POINTS = 4097;
