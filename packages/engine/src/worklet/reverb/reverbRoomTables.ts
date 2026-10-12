/**
 * The room voicing's tables (windsor#746): its input diffusers, its Build
 * table and its output taps, in the same shapes as the plate voicing's
 * (`reverbVoicingTables.ts`, `reverbBuildTables.ts`, `reverbTapTables.ts`), so
 * the tank's sample loop reads either through the same code. Import-free and
 * scope-free: nothing here reads `sampleRate`.
 *
 * Every value is Windsor's own, chosen by measurement
 * (`docs/research/2026-10-12-plate-room-voicing/`) against the issue's
 * criteria, and is for tacowars's ear on the preview. The room was tuned in
 * the default space (diffusions 0.75, 0.625, 0.7 and 0.5); the note records
 * the diffusions its starting points might take (item 8), which the processor
 * does not apply.
 */

/**
 * L's four diffusers, then R's, seconds at Size 1, scaled by Size's square
 * root (`_applySize`). Around the lengths both chains held before windsor#746,
 * each drawn within ±15 % of its own (`roomSearch.mjs`): of 150 draws, 81 kept
 * windsor#763's side leads and mirror at Build 0 (Size 0.25, 1 and 4, 48 and
 * 44.1 kHz), an early field sparser than the plate voicing's, and T30 within
 * 10 % at Decay 0.5 s, Size 1 and 2 s, Size 4; this is the one with the most
 * to spare (0.25 dB). The square root, not Size itself: scaled linearly the
 * diffusers ring 1.2 s at Size 4, outside the loop, and Decay 1 s at Size 4
 * read +15 % (−1 % under the root).
 */
const ROOM_INPUT_DELAYS = [0.004881, 0.00322, 0.012439, 0.009249];
const ROOM_INPUT_DELAYS_RIGHT = [0.005532, 0.003748, 0.010023, 0.008402];

/**
 * Build (windsor#761's shape): tap times at Build 1, seconds, left then
 * right, spread to 91 ms where the plate's reach 149 ms, so the room swells
 * in sooner (its time to the peak at Size 1 rises 30 → 80 ms over Build,
 * the plate's 0 → 140 ms); the gaps widen along the line and the sides
 * interleave, as the plate's do.
 */
const ROOM_BUILD_TAP_TIME = [
  0, 0.0113, 0.0247, 0.0389, 0.0571, 0.0823, 0.0004, 0.0149, 0.0302, 0.0463, 0.0668, 0.0911,
];
/**
 * Tap gains at Build 0, 0.5 and 1, each row left then right, each side of
 * unit energy: the first tap alone at 0, so the feed is one clean copy and
 * every output tap a distinct reflection, no comb in front of them; falling
 * evenly at 0.5; rising to the last at 1.
 */
const ROOM_BUILD_GAIN_ROWS = [
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [0.617, 0.479, 0.399, 0.33, 0.27, 0.22, 0.617, 0.479, 0.399, 0.33, 0.27, 0.22],
  [0.199, 0.278, 0.357, 0.437, 0.516, 0.546, 0.199, 0.278, 0.357, 0.437, 0.516, 0.546],
];
/**
 * No direct path at any Build: a room's first arrival is its first
 * reflection, an output tap, which follows Size (0.23, 1.2, 4.9 and 19.6 ms at
 * Size 0.05, 0.25, 1 and 4). The plate's burst arrives at 0 whatever the Size.
 */
const ROOM_BUILD_DIRECT_ROWS = [0, 0, 0];

/**
 * The output taps, windsor#766's shape: seconds at Size 1, the tank line each
 * reads, the signed gain; twelve left, then twelve right. Drawn by hand to
 * these rules, then measured:
 * - **Each side owns its half.** Nine of the left's taps read L's half (lines
 *   8 to 11) and nine of the right's R's (4 to 7), so each output weighs 7.75
 *   of |gain| on its own half against 2.5; the three on the other half
 *   (lines 5, 6, 7 on the left, 9, 10, 11 on the right) are reached past
 *   50 ms at Size 1, so the other side hears nothing of an input early.
 * - **Distinct early reflections.** A side's first five taps are one on the
 *   half's input all-pass (line 8 or 4) at about 5 ms, then four on the long
 *   line after it (9 or 5) at irregular gaps to about 68 ms, alternating
 *   sign, 0.75 and 1: a few separate arrivals, not the plate's cluster. At
 *   Size 1, Build 0 the early density is 7 052 samples against the plate
 *   voicing's 7 668.
 * - **Mirrored, not copied.** Each right tap sits within 3 to 9 % of its left
 *   counterpart's time, on the matching line of the other half, so the two
 *   sides' windows carry like energy (the mirror within 0.81 dB at Build 0, Size 1 and
 *   4) without one pattern on both.
 * - **Every tap lies between 1 ms and 95 % of its line at Size 1**
 *   (`mixer/reverbTaps.test.ts` replays them through Size moves).
 */
const ROOM_TAP_TIME = [
  0.0049, 0.0127, 0.0261, 0.0412, 0.0685, 0.0219, 0.0573, 0.0346, 0.083, 0.0973, 0.0448, 0.0726,
  0.0053, 0.0136, 0.0244, 0.0438, 0.0641, 0.0237, 0.0536, 0.0371, 0.0894, 0.1042, 0.0419, 0.0768,
];
const ROOM_TAP_LINE = [
  8, 9, 9, 9, 9, 10, 10, 11, 11, 5, 6, 7, 4, 5, 5, 5, 5, 6, 6, 7, 7, 9, 10, 11,
];
const ROOM_TAP_GAIN = [
  1, -0.75, 0.75, -1, 0.75, -0.75, 1, -1, 0.75, -0.75, 0.75, -1, 1, -0.75, 0.75, -1, 0.75, -0.75, 1,
  -1, 0.75, -0.75, 0.75, -1,
];
/**
 * The trim on the room's tap sum: the plate voicing's, measured to put a
 * centred click's wet RMS over its first second on the plate voicing's,
 * averaged in dB over Build 0, 0.5 and 1 in the default space at 48 kHz
 * (within 0.01 dB; each Build within 0.20 dB). Its own constant, so a retune
 * of either voicing leaves the other's level alone.
 */
const ROOM_OUTPUT_TRIM = 0.4856;

export {
  ROOM_INPUT_DELAYS,
  ROOM_INPUT_DELAYS_RIGHT,
  ROOM_BUILD_TAP_TIME,
  ROOM_BUILD_GAIN_ROWS,
  ROOM_BUILD_DIRECT_ROWS,
  ROOM_TAP_TIME,
  ROOM_TAP_LINE,
  ROOM_TAP_GAIN,
  ROOM_OUTPUT_TRIM,
};
