/**
 * The scheduler's own tunables (windsor#14).
 *
 * `TICK_STAMP_RING` is how many recently issued tick stamps the scheduler
 * keeps for `audibleTick`. The look-ahead queue holds far fewer: 0.12 s at
 * 300 BPM and 75% swing is under 30 ticks. The ring is sized for a test's
 * multi-second look-ahead too. Past it, `audibleTick` falls back to reading
 * the running tempo and swing back from the queue's head.
 */
export const TICK_STAMP_RING = 1024;
