/* eslint-disable no-magic-numbers -- the mulberry32 constants are the algorithm, not tunables; the worklet's copy in worklet/fm/prng.ts is pinned to this one by its test */
/**
 * The engine's one seeded PRNG on the main thread: mulberry32, 32 bits of
 * state, uniform in [0, 1). The generators draw their per-region streams from
 * it (`generatorSeed.ts`). The FM worklet carries the same algorithm line for
 * line in `worklet/fm/prng.ts`, copied because the worklet stays import-free;
 * `prng.test.ts` holds the two equal.
 *
 * Forked from Aotearoa204's `packages/shared/src/terrain/heightmap.ts`, whose
 * stream it reproduces exactly, so a song's seeds play the same notes in both.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
