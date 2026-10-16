/**
 * The CPU meter's tunables (windsor#13): how often it redraws, how long an
 * overrun flashes, how often an overrun may toast, and how long a cold start
 * settles before one may.
 */

/** One reading per this many milliseconds: about 4 Hz on the shared frame loop. */
export const CPU_METER_INTERVAL_MS = 250;

/** How long the meter stays red after the underrun count rises. */
export const CPU_METER_FLASH_MS = 1000;

/** At most one overrun toast per this many milliseconds, however many arrive. */
export const CPU_METER_TOAST_GAP_MS = 5000;

/**
 * How long after a cold start (a new system, or the first ▶ on it) a rise in
 * either underrun count neither flashes nor toasts (windsor#835): building a
 * system and the first play's untiered code miss deadlines that say nothing
 * about the song's steady cost.
 */
export const CPU_METER_SETTLE_MS = 2000;

/** The load at which the bar is full; above it the meter reads as over budget. */
export const CPU_METER_FULL_PCT = 100;

/** The largest percentage the label spells out; anything above reads `>999%`. */
export const CPU_METER_MAX_LABEL_PCT = 999;
