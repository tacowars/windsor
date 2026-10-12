/**
 * The plate's tunables and topology (#671): Dattorro's table 1 delays, the
 * SIZE, HOLD and diffusion limits, Decay in seconds and the low band's ranges (windsor#748),
 * and the sleep floors (#547). The output taps and the trim on their sum are
 * `reverbTapTables.ts` (windsor#766). Import-free and scope-free:
 * nothing here reads `sampleRate`. Every value before windsor#748's is the
 * one the hand-written `reverb-processor.js` carried;
 * `mixer/reverbGolden.test.ts` pins the render
 * they produce, and `__fixtures__/reverbHarness.ts` reads MAX_SIZE,
 * TANK_DELAYS, MAX_PRE_DELAY and the sleep floors by their top-level names.
 */

/* ------------------------------------------------------------------ *
 * Topology (Dattorro table 1; seconds, at his 29.761 kHz reference)
 * ------------------------------------------------------------------ */

/** Largest SIZE, and so the factor every tank buffer is over-allocated by. */
const MAX_SIZE = 4;

/**
 * Pre-tank diffusers, lines 0..3: the left input's chain. Not scaled by SIZE:
 * input smear is not room size.
 */
const INPUT_DELAYS = [0.004771345, 0.003595309, 0.012734787, 0.009307483];

/**
 * The right input's diffusers (windsor#763), lines 12..15, after the tank so
 * the tank keeps its numbers. Windsor's own lengths, chosen by measurement
 * (`docs/research/2026-10-12-plate-stereo-input/`): each a little off its
 * left counterpart, so the two chains decorrelate a centred source without
 * changing how fast either one smears. Not scaled by SIZE, as INPUT_DELAYS
 * are not.
 */
const INPUT_DELAYS_RIGHT = [0.005312, 0.003825, 0.011459, 0.008022];

/** Tank, as [diffuse, long, diffuse, long] per loop. Lines 4..11. */
const TANK_DELAYS = [
  0.022579886, 0.149625349, 0.060481839, 0.1249958, 0.030509727, 0.141695508, 0.089244313,
  0.106280031,
];

const FIRST_TANK_LINE = 4;
/** One past the tank's last line, and the right input's first diffuser (windsor#763). */
const TANK_LINE_END = FIRST_TANK_LINE + TANK_DELAYS.length;
const LINE_COUNT = INPUT_DELAYS.length + TANK_DELAYS.length + INPUT_DELAYS_RIGHT.length;

/** Shortest a scaled tank line may become, leaving room for the interpolators. */
const MIN_LENGTH = 8;

/** Alternated into the tank each sample so a decaying loop never goes denormal. */
const ANTI_DENORMAL = 1e-20;

/** Decay used by HOLD. Below one so the tank cannot creep towards instability. */
const HOLD_DECAY = 0.9999;

/**
 * Decay is an RT60 in seconds (windsor#748), and the low band's multiplier and
 * crossover: each `[default, min, max]`, as the descriptors declare them.
 * DECAY's default is the measured T30 of the plate's old default (decay gain
 * 0.7 at Size 1): `docs/research/2026-10-12-plate-decay-seconds/`. Its top,
 * 60 s, is tacowars's (record `2026-10-12-plate-decay-in-seconds`): the old
 * feedback gain had no time ceiling, and its longest spaces rang about 30 s.
 */
const DECAY_SECONDS = [3.35, 0.2, 60];
const LOW_DECAY = [1, 0.25, 4];
const LOW_CROSS = [300, 80, 10000];

/**
 * 60 dB as a natural log of amplitude, 3 ln 10: a segment `L` samples long
 * takes the gain exp(−RT60_LOG × L / (Decay × rate)), which is
 * 10^(−3L / (Decay × rate)), so a signal loses 60 dB over Decay seconds
 * whichever segments it spends them in.
 */
const RT60_LOG = 3 * Math.LN10;

/**
 * Each tank line's gain point under HOLD, lines 4 to 11: the long lines (5, 7,
 * 9, 11) take HOLD_DECAY, where the old feedback gain sat, and the all-pass
 * lines (4, 6, 8, 10) pass their loop untouched, as they did before Decay
 * became a time. So a held tank renders as it did.
 */
const HOLD_GAINS = [1, HOLD_DECAY, 1, HOLD_DECAY, 1, HOLD_DECAY, 1, HOLD_DECAY];

/** Highest one-pole cutoff, as a fraction of the sample rate: below Nyquist with a margin. */
const CUTOFF_CEILING = 0.49;

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
  INPUT_DELAYS_RIGHT,
  TANK_DELAYS,
  FIRST_TANK_LINE,
  TANK_LINE_END,
  LINE_COUNT,
  MIN_LENGTH,
  ANTI_DENORMAL,
  HOLD_DECAY,
  DECAY_SECONDS,
  LOW_DECAY,
  LOW_CROSS,
  RT60_LOG,
  HOLD_GAINS,
  CUTOFF_CEILING,
  MAX_TANK_DIFFUSION,
  SMOOTH_SECONDS,
  MAX_PRE_DELAY,
  SLEEP_INPUT_FLOOR,
  SLEEP_OUTPUT_FLOOR,
};
