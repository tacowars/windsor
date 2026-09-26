/**
 * The bass card's own tunables (#707): what Reseed draws from, and how a
 * control reads while its pitch mode leaves it unused.
 */

/** Reseed draws a seed in `[0, BASS_RESEED_SPAN)`: the 32-bit range the stream hash keeps. */
export const BASS_RESEED_SPAN = 2 ** 32;

/** A control the current pitch mode ignores stays visible, dimmed and inert. */
export const BASS_DISABLED_OPACITY = '0.35';
