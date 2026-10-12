/**
 * The plate's tank modulation tables (windsor#764): the four modulated
 * all-passes, each point's seed, the length of each point's sequence of
 * draws, and how a draw becomes a knot and a segment's width.
 * Import-free and scope-free: nothing here reads `sampleRate`, and
 * `plateModulation.ts` reads every value.
 *
 * Windsor's own values (`docs/research/2026-10-12-plate-modulation/`).
 */

/** The tank lines the modulation moves: both all-passes of each loop. */
const MOD_LINES = [4, 6, 8, 10];

/**
 * One fixed seed per point, the same in every plate, for `fm/prng.ts`'s
 * generator. Arbitrary, distinct and non-zero; no two points share a sequence.
 */
const MOD_SEEDS = [0x2f6b1a4d, 0x7c19e3b5, 0x4ad3c217, 0x13e58f69];

/**
 * Draws held per point, a power of two. A point takes two draws a segment
 * (its knot and its width) and makes two segments a cycle on average, so at
 * the top rate, 8 Hz, it takes 32 draws a second and its sequence comes round
 * after about 2^15 / 32 = 1 024 s: past the ten minutes in which it must not
 * repeat. `mixer/reverbModulation.test.ts` sums the drawn widths to check it.
 * All four points' draws together are 512 KB of `Float32Array`, drawn once a
 * scope and shared by every plate in it.
 */
const MOD_DRAW_LENGTH = 2 ** 15;

/**
 * Where a point turns: a rising point's next knot is drawn from the upper
 * half of its range, a falling point's from the lower, so every knot turns
 * it round and a segment spans half the range on average.
 */
const MOD_HALF = 0.5;

/**
 * A segment's width, in half-periods at `modRate`, is drawn from
 * `MOD_WIDTH_MIN` to `MOD_WIDTH_MIN + 1`: 1 on average, so the source's
 * average rate is `modRate`, and never so short that two knots crowd.
 */
const MOD_WIDTH_MIN = 0.5;

/**
 * A moving point's mean place in its range: its knots are drawn evenly from
 * each half in turn and it glides symmetrically between them, so on average
 * its read is this share of its depth shorter than its line.
 */
const MOD_MEAN = 0.5;

export { MOD_MEAN, MOD_LINES, MOD_SEEDS, MOD_DRAW_LENGTH, MOD_HALF, MOD_WIDTH_MIN };
