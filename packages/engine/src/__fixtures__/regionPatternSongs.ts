/**
 * Songs whose regions play their own patterns (windsor#74, epic windsor#70),
 * over `FULL_ARRANGEMENT`: one part in two regions, bars 1–2 and bars 3–4,
 * each with a pattern of its own, plus the reads the player tests compare
 * them by — a part's calls in a window of ticks.
 */
import type { Arrangement, PartRegion, RegionPattern, SequencerSpec } from '../song/arrangement';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import { FULL_ARRANGEMENT, FULL_SONG_TICKS, withPart, type FullPartId } from './fullArrangement';
import type { RecordingPart } from './recordingPart';

/** Where the second region starts: bar 3. */
export const HALF = 2 * TICKS_PER_BAR;
export const SONG = FULL_SONG_TICKS;

/** A pattern as a region holds it: the spec without its seed. */
export function patternOf<S extends SequencerSpec>(spec: S): Omit<S, 'seed'> {
  const pattern: Record<string, unknown> = { ...spec };
  delete pattern.seed;
  return pattern as Omit<S, 'seed'>;
}

/** A part's sequencer: the pattern, with `seed` for a seeded kind. */
export const specOf = (pattern: RegionPattern, seed: number): SequencerSpec =>
  (pattern.kind === 'chord' || pattern.kind === 'none'
    ? pattern
    : { ...pattern, seed }) as SequencerSpec;

/** Bars 1–2 and bars 3–4, playing `a` then `b` (either absent: the part's own sequencer). */
export function halves(a?: RegionPattern, b?: RegionPattern): PartRegion[] {
  return [
    { start: 0, duration: HALF, ...(a ? { pattern: a } : {}) },
    { start: HALF, duration: HALF, ...(b ? { pattern: b } : {}) },
  ];
}

/** `FULL_ARRANGEMENT` with the part on `id` playing `a` in bars 1–2 and `b` in bars 3–4; its own sequencer is `a`. */
export function twoRegionSong(
  id: FullPartId,
  a: RegionPattern,
  b: RegionPattern,
  seed = 0,
): Arrangement {
  return withPart(FULL_ARRANGEMENT, id, { regions: halves(a, b), sequencer: specOf(a, seed) });
}

/** A recording part's call time back to the transport tick it was issued on. */
export const tickOf = (time: number | undefined): number =>
  Math.round(((time ?? 0) * FULL_ARRANGEMENT.transport.bpm * PPQ) / SECONDS_PER_MINUTE);

/** Every timed call (a note or a trigger) the part received on ticks `[from, to)`, as comparable lines. */
export function windowOf(part: RecordingPart, from: number, to: number): string[] {
  return part.calls
    .filter((call) => call.time !== undefined)
    .filter((call) => tickOf(call.time) >= from && tickOf(call.time) < to)
    .map((call) => {
      const { time, ...rest } = call;
      return `@${tickOf(time)} ${JSON.stringify(rest)}`;
    });
}
