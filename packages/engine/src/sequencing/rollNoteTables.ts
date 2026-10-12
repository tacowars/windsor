/**
 * A Roll note's tunables (windsor#753, record
 * `2026-10-12-roll-note-accent-and-ratchet`). Data only, and import-free, so
 * the Roll's config stays on the generators' pure side
 * (`generatorBoundary.test.ts`).
 */

/**
 * The shortest note a ratchet plays on: a 1/32, 3 ticks at 24 PPQ (decision
 * 6). The normaliser clears a ratchet from a shorter note, and the lane
 * draws its Rat cell disabled.
 */
export const ROLL_RATCHET_MIN_TICKS = 3;
