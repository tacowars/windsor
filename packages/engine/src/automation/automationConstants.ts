/**
 * The automation lanes' tunables (windsor#341, record
 * `2026-10-01-song-automation-lanes`): the de-click ramp on a vertical step,
 * the sampler's grain and the bend's base. Data only.
 */

/**
 * The linear ramp the player puts on a vertical step (decision 12), in
 * seconds, so a square's edge does not click. A tunable, judged by ear on the
 * player's ticket.
 */
export const AUTOMATION_STEP_RAMP_SECONDS = 0.004;

/** The sampler's default cut through a curved segment, in song ticks (one tick). */
export const AUTOMATION_GRAIN_TICKS = 1;

/**
 * The bend's base: a segment's exponent is `BASE^(−bend · sign(rise))`, so a
 * bend of ±1 is an exponent of 1/5 or 5 and a bend of 0 is a straight line.
 */
export const AUTOMATION_BEND_BASE = 5;
