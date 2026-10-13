/**
 * Advanced Drive's sleep floors and hold (windsor#793, the plate's pattern;
 * `worklet/advancedDrive/driveSleep.ts`). A file of their own, not a row of
 * `advancedDriveConstants.ts`, because the FM part's bundle carries that one
 * whole (its synced voice shares the drive's oversampler), and the voice has
 * no use for these.
 *
 * An input sample within `inputFloor` of 0 is silence, as the plate's
 * `SLEEP_INPUT_FLOOR`; an output within `outputFloor` (about -140 dBFS, the
 * plate's `SLEEP_OUTPUT_FLOOR`) is an inaudible tail. The output is read at the
 * end of each quiet block twice: the block as heard, and the graph's last wet
 * and phase-matched dry samples before the Mix and the switch, so a drive
 * turned to Mix 0 or switched off does not sleep through a ring it still holds.
 *
 * The tail is not a fixed span: a stage's filter at Resonance 12 with its
 * cutoff modulated down rings for seconds, so the tail lasts until the output
 * is under the floor, and then `holdSeconds` more. The hold is about 70 times
 * the oversampler's round trip (65 taps up and 65 down at twice the rate,
 * 0.7 ms at 48 kHz, the only state the output does not show at once) and two
 * periods of the lowest fixed corner (the crossover's 40 Hz), so a ring that a
 * block's end happens to catch near a zero crossing is read at many phases
 * before the drive sleeps.
 */
/**
 * The input floor is for a drive at unity: `driveSleep.ts` divides it by the
 * worst-case linear gain of the current settings (Codex on PR #797), so a
 * drive at +36 dB, three stages at +24 dB and the output at +12 dB needs an
 * input 120 dB quieter to sleep, and wakes on it. `shaperSlope` bounds every
 * curve's slope at any bias (the soft curve's sine, pi/2); `headroom` covers
 * what the bound does not model: the oversamplers' ripple, a crossover band's
 * overshoot and a filter swept while it rings.
 */
export const DRIVE_SLEEP = {
  inputFloor: 1e-9,
  outputFloor: 1e-7,
  holdSeconds: 0.05,
  shaperSlope: Math.PI / 2,
  headroom: 4,
};
