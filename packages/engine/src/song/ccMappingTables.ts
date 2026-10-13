/**
 * MIDI CC mapping's shared tables (windsor#780, record
 * `2026-10-13-midi-cc-mapping` decisions 5 and 11). They sit in the engine,
 * not the console's `midiConstants.ts` as decision 11 says, because both the
 * song normaliser and the console's learn read the ignored list; the console
 * takes them through `@windsor/engine`.
 */

/** A 7-bit controller's top value: CC 0..127 spreads over a mapping's range (decision 5). */
export const CC_DATA_MAX = 127;

/** The controllers that keep their jobs or are not knobs, never mapped (decision 11). */
export const CC_MAPPING_IGNORED: ReadonlySet<number> = new Set([
  // The mod wheel and sustain keep their jobs.
  1, 64,
  // Bank select, MSB and LSB.
  0, 32,
  // Data entry, MSB and LSB, then data increment and decrement and NRPN and RPN select.
  6, 38, 96, 97, 98, 99, 100, 101,
  // The channel mode messages.
  120, 121, 122, 123, 124, 125, 126, 127,
]);
