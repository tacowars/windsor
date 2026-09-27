/* eslint-disable no-magic-numbers -- DSP: the mulberry32 and xorshift constants are the algorithms, pinned to the shared copy; the tunables are fmConstants.ts (#654) */
/**
 * The worklet's one random source (#78, #644): `Math.random` unless a seed is
 * supplied, then mulberry32; and the non-zero 32-bit seed each voice's noise
 * and sample-and-hold LFO draw from it. Invariant: allocation free, and the
 * same algorithm line for line as `mulberry32` in
 * `packages/shared/src/terrain/heightmap.ts`. `fmProcessor.test.ts` pins the
 * zero exclusion; every seeded harness render depends on this stream.
 */

/* ------------------------------------------------------------------ *
 * Randomness
 *
 * Three things below are drawn at random: free-running operator start phase,
 * the per-voice noise seed, and `panRandom` jitter. All three go through one
 * source per processor, so a test can pin every one of them at once.
 *
 * The game passes no seed and gets `Math.random`, as before — with one
 * deliberate difference, the zero exclusion in `randomSeed32` below.
 * `processorOptions.seed` swaps in mulberry32 — 32 bits of state, no
 * allocation, and ample for phase and pan jitter. It is deliberately not a
 * simulation-grade generator: nothing here reaches the simulation
 * (docs/design/audio-architecture.md 4), it only has to be reproducible.
 * ------------------------------------------------------------------ */

/**
 * `Math.random`, unless a seed is supplied; then a reproducible mulberry32 --
 * the same algorithm, line for line, as `mulberry32` in
 * `packages/shared/src/terrain/heightmap.ts`, so the repo has one seeded
 * generator rather than two. It is copied rather than imported for the reason
 * at the top of this file: the worklet must stay import-free.
 */
function makeRandom(seed: number | null | undefined): () => number {
  if (seed == null) return Math.random;
  let state = seed >>> 0;
  return function mulberry32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A non-zero xorshift32 seed. Zero is xorshift's fixed point — a voice that
 * drew it would emit dead DC from its noise operator, and hold its sample-and-
 * hold LFO still, for as long as it sounded.
 *
 * **This is the one behavioural change on the unseeded game path.** Before,
 * that zero was kept; now it becomes 1. It is a 2^-32 accident from
 * `Math.random` and was never worth a branch, but a swept seed makes it
 * reachable and reproducible, so it is excluded rather than left to luck.
 * `fmProcessor.test.ts` pins `Math.random` at 0 and asserts a noise operator
 * still oscillates.
 */
function randomSeed32(random: () => number): number {
  return (random() * 0xffffffff) >>> 0 || 1;
}

export { makeRandom, randomSeed32 };
