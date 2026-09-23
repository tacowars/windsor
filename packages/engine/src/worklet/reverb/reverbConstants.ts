/**
 * The plate's tunables and topology (#671): Dattorro's table 1 delays, the
 * output taps (table 2, read as delays -- see TAP_TIME), the SIZE, HOLD and
 * diffusion limits, and the sleep floors (#547). Import-free and scope-free:
 * nothing here reads `sampleRate`. Every value is the one the hand-written
 * `reverb-processor.js` carried; `mixer/reverbGolden.test.ts` pins the render
 * they produce, and `__fixtures__/reverbHarness.ts` reads MAX_SIZE,
 * TANK_DELAYS, MAX_PRE_DELAY and the sleep floors by their top-level names.
 */

/* ------------------------------------------------------------------ *
 * Topology (Dattorro table 1; seconds, at his 29.761 kHz reference)
 * ------------------------------------------------------------------ */

/** Largest SIZE, and so the factor every tank buffer is over-allocated by. */
const MAX_SIZE = 4;

/** Pre-tank diffusers. Not scaled by SIZE: input smear is not room size. */
const INPUT_DELAYS = [0.004771345, 0.003595309, 0.012734787, 0.009307483];

/** Tank, as [diffuse, long, diffuse, long] per loop. Lines 4..11. */
const TANK_DELAYS = [
  0.022579886, 0.149625349, 0.060481839, 0.1249958, 0.030509727, 0.141695508, 0.089244313,
  0.106280031,
];

/**
 * Output taps: delay in seconds from where a line is written, which line, and
 * the sign of the sum.
 *
 * These are Dattorro's Table 2 values (at his 29.761 kHz reference: 266, 2974,
 * 1913 ... samples). His notation is `node48_54[266]` -- a delay line spanning
 * node 48 to node 54, indexed from node 48. Node numbers increase along the
 * signal path (node31_33 feeds node33_39, sharing node 33 as output then
 * input), so the index counts from the line's *input*: it is a delay.
 *
 * khoin/DattorroReverbNode reads them from the opposite end, so its tap of 266
 * on a 4217-sample line is a delay of 3950 rather than 266. That inverts the
 * whole output tap structure, which 1.3.6 calls "characteristic of the plate
 * emulation class". `_readTap` reads back from the write head instead.
 */
const TAP_TIME = [
  0.008937872, 0.099929438, 0.064278754, 0.067067639, 0.066866033, 0.006283391, 0.035818689,
  0.011861161, 0.121870905, 0.041262054, 0.08981553, 0.070931756, 0.011256342, 0.004065724,
];
const TAP_LINE = [9, 9, 10, 11, 5, 6, 7, 5, 5, 6, 7, 9, 10, 11];
const TAP_SIGN = [1, 1, -1, 1, -1, -1, -1, 1, 1, -1, 1, -1, -1, -1];

/** First seven taps sum to the left output, the rest to the right. */
const TAPS_PER_SIDE = 7;

const FIRST_TANK_LINE = 4;
const LINE_COUNT = INPUT_DELAYS.length + TANK_DELAYS.length;

/** Shortest a scaled tank line may become, leaving room for the interpolators. */
const MIN_LENGTH = 8;

/** Alternated into the tank each sample so a decaying loop never goes denormal. */
const ANTI_DENORMAL = 1e-20;

/** Decay used by HOLD. Below one so the tank cannot creep towards instability. */
const HOLD_DECAY = 0.9999;

/**
 * Ceiling on the tank all-pass coefficients.
 *
 * The reference node exposes these to 0.999999, where the tank stops decaying
 * and starts growing: measured peak 54 and still climbing after 60 s of silence
 * following a 2 s burst. Dattorro's own values are 0.7 and 0.5 (table 1), and
 * the paper caps decay diffusion 2 at 0.5. 0.8 leaves room to push the sound
 * well past his settings while every combination with decay = 1 still sustains
 * or decays rather than running away.
 */
const MAX_TANK_DIFFUSION = 0.8;

/** Seconds for SIZE and the HOLD input mute to reach their targets. */
const SMOOTH_SECONDS = 0.05;

const MAX_PRE_DELAY = 1;

/** Compensates the fourteen-tap sum, which is well above unity. */
const OUTPUT_TRIM = 0.6;

/**
 * Sleep (#547). An input sample within SLEEP_INPUT_FLOOR of 0 is silence; a wet
 * sample within SLEEP_OUTPUT_FLOOR (about -140 dBFS) is an inaudible tail. Both
 * are read at wet 1 -- the tap sum before the wet gain -- so a plate turned down
 * to wet 0 does not sleep through a tail it still holds. Once both have held for
 * longer than anything can recirculate unseen (the longest tank line at
 * MAX_SIZE, plus the longest pre-delay), the tank is empty to that floor and the
 * plate stops rendering it until the input moves again.
 */
const SLEEP_INPUT_FLOOR = 1e-9;
const SLEEP_OUTPUT_FLOOR = 1e-7;

export {
  MAX_SIZE,
  INPUT_DELAYS,
  TANK_DELAYS,
  TAP_TIME,
  TAP_LINE,
  TAP_SIGN,
  TAPS_PER_SIDE,
  FIRST_TANK_LINE,
  LINE_COUNT,
  MIN_LENGTH,
  ANTI_DENORMAL,
  HOLD_DECAY,
  MAX_TANK_DIFFUSION,
  SMOOTH_SECONDS,
  MAX_PRE_DELAY,
  OUTPUT_TRIM,
  SLEEP_INPUT_FLOOR,
  SLEEP_OUTPUT_FLOOR,
};
