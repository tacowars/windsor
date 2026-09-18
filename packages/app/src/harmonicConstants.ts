/** The User-wave harmonic editor's tunables (#618). */

/** The bar counts offered, Operator-style, fewest first. */
export const HARMONIC_COUNTS = [16, 32, 64] as const;
export type HarmonicCount = (typeof HARMONIC_COUNTS)[number];
/** Preview samples per cycle of the highest offered harmonic. */
export const PREVIEW_OVERSAMPLE = 8;
/** The cycle preview's vertical margin, in px. */
export const CYCLE_PAD_PX = 4;
