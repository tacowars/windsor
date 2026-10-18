/**
 * The Transient insert's follower timing (record `2026-10-18-transient-insert`
 * decision 5): three rows, chosen by ear. The shipped row is a named constant,
 * never a spec field or a knob. The DSP takes its row as a parameter that
 * defaults to the shipped one, and `processorOptions.timing` overrides it for
 * the tests and the listen only.
 *
 * - `holdMs`: the window the peak detector takes its maximum over. It sets
 *   the lowest note the detector rides without ripple, about `1/(2·hold)`
 *   (42 Hz for `tight`, 25 Hz for `medium`, 20 Hz for `loose`), and how late
 *   a short hit's decay starts to count as sustain.
 * - `fReleaseMs`: the follower's release from the peak (its rise is instant).
 * - `aAttackMs`: how fast the attack reference catches the follower up; the
 *   onset shape lasts about this long.
 * - `sReleaseMs`: how slowly the sustain reference lets go; the decay shape
 *   grows as the follower falls faster than it.
 */

export interface TransientTiming {
  readonly holdMs: number;
  readonly fReleaseMs: number;
  readonly aAttackMs: number;
  readonly sReleaseMs: number;
}

export const TRANSIENT_TIMINGS = {
  tight: { holdMs: 12, fReleaseMs: 5, aAttackMs: 8, sReleaseMs: 200 },
  medium: { holdMs: 20, fReleaseMs: 10, aAttackMs: 15, sReleaseMs: 400 },
  loose: { holdMs: 25, fReleaseMs: 20, aAttackMs: 30, sReleaseMs: 800 },
} as const satisfies Record<string, TransientTiming>;

export type TransientTimingName = keyof typeof TRANSIENT_TIMINGS;

/** The row that ships until tacowars's listen picks one. */
export const TRANSIENT_SHIPPED_TIMING: TransientTimingName = 'medium';
