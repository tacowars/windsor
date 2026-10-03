/**
 * Where a part is in its regions at a transport tick (#705, epic #703
 * decisions 2, 5 and 17) — the one position rule every performer and the
 * console's playhead read.
 *
 * A part's `regions` say where in the song it is live; the song is
 * `songTicks` long and the transport's absolute tick never wraps, so the
 * lookup is `tick mod songTicks`. Inside a region the part's pattern runs on
 * `localTick`, the ticks since the playhead *entered* it, and its stream is
 * minted at that entry (`hashSeed(seed, index)`). A single region covering
 * the whole song is **∞**: free-running, entered once at tick 0 and never
 * again — the song wrap is not an entry — so `entryTick` is 0 and
 * `localTick` is the transport tick for every tick, and an odd-length line
 * drifts freely across chord changes and song loops. Every other region is
 * re-entered on every song iteration.
 *
 * Pure: regions in, a position out. Regions arrive normalised — sorted,
 * non-overlapping, inside the song — but the walk tolerates anything.
 */

export interface Region {
  /** Absolute song tick the region starts on, in `[0, songTicks)`. */
  readonly start: number;
  /** Ticks the region lasts; its end is `start + duration`, exclusive. */
  readonly duration: number;
}

export type RegionState =
  | { readonly live: false }
  | {
      readonly live: true;
      /** Index into `regions`. */
      readonly index: number;
      /** Absolute transport tick of this iteration's entry into the region. */
      readonly entryTick: number;
      /** Ticks since that entry: the pattern's position. */
      readonly localTick: number;
    };

export const NOT_LIVE: RegionState = { live: false };

/** True for the one region that covers the whole song: the free-running case. */
export function isInfiniteRegion(regions: readonly Region[], songTicks: number): boolean {
  const only = regions.length === 1 ? regions[0] : undefined;
  return only !== undefined && only.start === 0 && only.duration >= songTicks;
}

/** The part's state at `tick`: silent, or live in one region with its local position. */
export function regionState(
  regions: readonly Region[],
  songTicks: number,
  tick: number,
): RegionState {
  if (regions.length === 0 || !(songTicks > 0)) return NOT_LIVE;
  if (isInfiniteRegion(regions, songTicks)) {
    return { live: true, index: 0, entryTick: 0, localTick: tick };
  }
  const songTick = ((tick % songTicks) + songTicks) % songTicks;
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index] as Region;
    const localTick = songTick - region.start;
    if (localTick >= 0 && localTick < region.duration) {
      return { live: true, index, entryTick: tick - localTick, localTick };
    }
  }
  return NOT_LIVE;
}

/**
 * Region `index`'s own position at `tick`, whether or not the playhead is in
 * it (windsor#97): the ticks since the region last started, counted on the
 * song's cycle, `(songTick - start) mod songTicks`. Inside the region it is
 * `regionState`'s `localTick`, so the two never disagree there; outside, it
 * carries on from the last start as if the region were still sounding, and
 * falls back to 0 on the tick the region starts again, which is the entry
 * the performer restarts on. The ∞ region is the transport tick, as in
 * `regionState`. A loop's jump moves the transport tick, and this follows
 * it the way the gate does. Null for an index naming no region, or a song
 * of no length.
 */
export function regionPhase(
  regions: readonly Region[],
  songTicks: number,
  index: number,
  tick: number,
): number | null {
  const region = regions[index];
  if (region === undefined || !(songTicks > 0)) return null;
  if (isInfiniteRegion(regions, songTicks)) return tick;
  return (((tick - region.start) % songTicks) + songTicks) % songTicks;
}

/**
 * The region that started last on or before `tick` on the song's cycle
 * (windsor#508, windsor#518): the smallest `regionPhase` wins, the first on
 * a tie, so it is the region holding the tick while one does and, in a gap,
 * the one before it. -1 with no region, or a song of no length. A canon
 * reads its leader's line from this region (`PartBinding.figureAt`), and
 * the Figure device shows the same one.
 */
export function lastStartedRegion(
  regions: readonly Region[],
  songTicks: number,
  tick: number,
): number {
  let last = -1;
  let since = Infinity;
  for (let index = 0; index < regions.length; index++) {
    const phase = regionPhase(regions, songTicks, index, tick);
    if (phase !== null && phase < since) {
      since = phase;
      last = index;
    }
  }
  return last;
}
