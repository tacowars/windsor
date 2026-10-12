/**
 * The plate's Build tables (windsor#761): the multi-tap delay between the
 * input diffusers and the tank, which shapes how the reverb's onset forms.
 * Import-free and scope-free: nothing here reads `sampleRate`, and
 * `plateBuild.ts` reads every value per block.
 *
 * Windsor's own values, voiced by measurement and then by ear
 * (`docs/research/2026-10-12-plate-build/`): with one click in, the wet
 * output's first arrival, the time to its envelope's peak, its energy in the
 * first 20 and 100 ms and its RMS over the first second, against Build in
 * steps of 0.1, for the `hall`, `plate` and default spaces.
 *
 * - **Tap times** are seconds at Build 1, fixed, never following Size (as
 *   `INPUT_DELAYS` do not). Each side's six are spaced unevenly, with gaps
 *   that widen along the line so no two taps beat at one comb spacing, and
 *   the two sides interleave so the halves of the tank hear different
 *   onsets from the one diffused signal. Build stretches every time by
 *   `BUILD_STRETCH_MIN + (1 − BUILD_STRETCH_MIN) × build`: a tenth of the
 *   spread at 0, a dense cluster inside 15 ms, and the whole spread at 1.
 * - **Gain rows** are the tap gains at Build 0, 0.5 and 1, blended linearly
 *   between neighbours. Each row has unit energy (its gains' squares sum to
 *   1), so the tank hears the diffused signal at the level it heard it before
 *   Build: a burst led by the first tap at 0, an even spread at 0.5, and a
 *   swell rising to the last tap at 1. At 0 the first tap carries most of the
 *   energy: six equal-ish taps inside 15 ms comb the feed (a third-octave
 *   band 7 dB down measured), and a dominant first tap holds it to about
 *   ±2.5 dB (`colour.mjs` in the research note).
 * - **Direct levels** are how much of each side's tap sum goes to the wet
 *   output itself, ahead of the tail, at the same rows. They fall to 0 at
 *   Build 1, so a swell has no burst in front of it.
 *
 * `mixer/reverbBuild.test.ts` holds the onset to Build;
 * `mixer/reverbGolden.test.ts` pins the render.
 */

/** Each side's taps: the first half of the tables is the left tank input, the second the right. */
const BUILD_TAPS_PER_SIDE = 6;

/** Seconds at Build 1, left then right. The longest is `BUILD_SPREAD`. */
const BUILD_TAP_TIME = [
  0, 0.0191, 0.0412, 0.0671, 0.0973, 0.1311, 0.0007, 0.0289, 0.0531, 0.0809, 0.1129, 0.149,
];

/** The longest tap at Build 1, seconds: what the Build line is allocated for. */
const BUILD_SPREAD = 0.149;

/** The stretch on every tap time at Build 0; it rises linearly to 1 at Build 1. */
const BUILD_STRETCH_MIN = 0.1;

/**
 * Tap gains at Build 0, 0.5 and 1 (rows evenly spaced over Build), each row
 * left then right, each side of unit energy.
 */
const BUILD_GAIN_ROWS = [
  [0.905, 0.272, 0.217, 0.172, 0.136, 0.109, 0.905, 0.272, 0.217, 0.172, 0.136, 0.109],
  [0.221, 0.319, 0.417, 0.49, 0.49, 0.441, 0.221, 0.319, 0.417, 0.49, 0.49, 0.441],
  [0.048, 0.096, 0.172, 0.307, 0.527, 0.766, 0.048, 0.096, 0.172, 0.307, 0.527, 0.766],
];

/** The tap sum's level at the wet output, at the same rows. */
const BUILD_DIRECT_ROWS = [0.6, 0.15, 0];

/**
 * `build`'s `[default, min, max]`, as the descriptors declare it. The default,
 * 0.1, is the highest step of 0.1 at which the `hall` space (the default send)
 * keeps at least the energy in its first 20 ms that it had before Build, with
 * its first arrival no later: 0.0223 against 0.0098 at 48 kHz. At 0.2 it
 * falls under (0.0093).
 */
const BUILD = [0.1, 0, 1];

export {
  BUILD_TAPS_PER_SIDE,
  BUILD_TAP_TIME,
  BUILD_SPREAD,
  BUILD_STRETCH_MIN,
  BUILD_GAIN_ROWS,
  BUILD_DIRECT_ROWS,
  BUILD,
};
