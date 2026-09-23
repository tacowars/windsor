/**
 * The strip inserts' tunables (#641): how many a strip may carry, and each
 * kind's ranges and defaults. The logic reads these; the console's knobs read
 * the same numbers, so a range is stated once.
 */

/** Inserts per strip. A song cannot allocate unbounded DSP (#641). */
export const MAX_INSERTS = 8;

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

/* --------------------------------- chorus -------------------------------- */

/** The LFO rate of the first voice, in Hz; the others run at `CHORUS_VOICE_RATIOS` of it. */
export const CHORUS_RATE_MIN_HZ = 0.05;
export const CHORUS_RATE_MAX_HZ = 5;
export const CHORUS_RATE_DEFAULT_HZ = 0.6;
/** How far each voice's delay swings either side of its centre, in milliseconds. */
export const CHORUS_DEPTH_MIN_MS = 0;
export const CHORUS_DEPTH_MAX_MS = 4;
export const CHORUS_DEPTH_DEFAULT_MS = 2;
/**
 * Stereo width: the right channel's LFO runs at `1 − 2·spread` of the left's,
 * so 0 moves both sides together (a narrow chorus) and 1 moves them in
 * opposite directions (the wide one). No `StereoPannerNode`: the strip is
 * stereo, and a balance law on stereo input collapses it (record §4).
 */
export const CHORUS_SPREAD_DEFAULT = 0.7;
/** Wet share: 0 is the dry signal, 1 is the voices alone. */
export const CHORUS_MIX_DEFAULT = 0.5;
/**
 * The voices: each one's delay centre in ms and its LFO rate as a ratio of
 * the Rate knob. Irrational-ish ratios keep the voices from lining up. The
 * count is fixed per kind, so a settings change never re-wires; the centres
 * sit far enough above the depth ceiling that a delay never nears zero.
 */
export const CHORUS_VOICE_CENTRES_MS: readonly number[] = [11, 17];
export const CHORUS_VOICE_RATIOS: readonly number[] = [1, 1.37];
/** The longest a voice's delay line can reach, in seconds: every centre plus the depth ceiling. */
export const CHORUS_DELAY_MAX_SECONDS = 0.05;

/* ------------------------------- the chain ------------------------------- */

/**
 * The ramp either side of a structural insert edit (#652) — an add, a removal
 * or a reorder. Long enough that the step in the waveform is inaudible, short
 * enough that the edit feels immediate; the strip is silent for twice this.
 */
export const INSERT_FADE_SECONDS = 0.012;
