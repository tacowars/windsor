/**
 * One PRNG stream per sequencer per region entry (#705, epic #703 decision 16).
 *
 * Every generative sequencer carries its own `seed`; the stream it draws from
 * is `hashSeed(seed, regionIndex)`, minted when the playhead enters a region
 * from outside (`regionClock.ts`), so two regions of the same part play the
 * same pattern with different draws, and a single ∞ region draws one stream
 * for the whole song. The stride is the 32-bit golden ratio, so seed `s` in
 * region 1 is not the stream seed `s + 1` gives region 0 — a plain
 * `seed + index` would make neighbouring seeds share a region.
 *
 * `mulberry32` is the engine's one main-thread PRNG (`mulberry32.ts`); nothing
 * here adds another.
 */
import { mulberry32 } from './mulberry32';

export const GENERATOR_SEED_STRIDE = 0x9e3779b9;

/** The 32-bit stream seed for `seed` at `regionIndex`. */
export function hashSeed(seed: number, regionIndex: number): number {
  return (Math.trunc(seed) + Math.trunc(regionIndex) * GENERATOR_SEED_STRIDE) >>> 0;
}

export type Rng = () => number;

/** The stream for one sequencer in one region: uniform in [0, 1), deterministic per (seed, region). */
export function streamRng(seed: number, regionIndex: number): Rng {
  return mulberry32(hashSeed(seed, regionIndex));
}
