/**
 * One PRNG stream per generator, all derived from a single arrangement seed.
 *
 * The arrangement carries one fixed seed; each generator is given its index in
 * the arrangement and derives its own stream, so re-seeding or re-rolling one
 * part cannot move another (record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §4). The stride is the
 * 32-bit golden ratio, so arrangement seed `s` at index 1 is not the same
 * stream as seed `s + 1` at index 0 -- a plain `seed + index` would make two
 * neighbouring arrangements share a part.
 *
 * `mulberry32` is the repo's one PRNG (`@aotearoa/shared`); nothing here adds
 * another.
 */
import { mulberry32 } from '@aotearoa/shared';

export const GENERATOR_SEED_STRIDE = 0x9e3779b9;

export function generatorSeed(arrangementSeed: number, generatorIndex: number): number {
  return (Math.trunc(arrangementSeed) + Math.trunc(generatorIndex) * GENERATOR_SEED_STRIDE) >>> 0;
}

export type Rng = () => number;

/** The stream for one generator: uniform in [0, 1), deterministic per seed. */
export function generatorRng(arrangementSeed: number, generatorIndex: number): Rng {
  return mulberry32(generatorSeed(arrangementSeed, generatorIndex));
}
