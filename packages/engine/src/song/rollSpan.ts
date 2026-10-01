/**
 * A Euclid ratchet's roll (windsor#355). Its hits are queued at once, spaced
 * evenly across the step's whole swung span (decision 6 of
 * `docs/log/2026-10-01-euclid-lanes-and-ratchets.md`). Where the onset's own
 * region ends or the loop jumps back inside that span, the roll keeps its
 * spacing and drops the hits that would start at or past the boundary, and
 * no hold crosses it: the time beyond belongs to a gap, another region or
 * the loop's start. The ∞ region and a loop that jumps nothing bound
 * nothing. Pure; `rollSpan.test.ts`.
 */
import { rollSpanSeconds } from '../sequencing/euclidLanes';
import { isInfiniteRegion, regionState, type Region } from '../sequencing/regionClock';
import type { TickLoop } from '../sequencing/scheduler';
import type { Swing } from '../sequencing/swingTables';

/** Float noise, in seconds, under which a hit's start counts as on the boundary, and so drops. */
const ON_BOUNDARY_SECONDS = 1e-9;

export interface RollBoundInput {
  /** The onset's transport tick. */
  readonly tick: number;
  /** The regions of the part the onset played on. */
  readonly regions: readonly Region[];
  readonly songTicks: number;
  readonly loop: TickLoop | null;
}

/** What the step asks of its roll. */
export interface RollShape {
  /** The step's length in ticks: the span the roll's spacing divides, bound or not. */
  readonly divisor: number;
  /** The step's ratchet: the roll's `N`. */
  readonly ratchet: number;
  /** The part's hold, in seconds. */
  readonly hold: number;
}

export interface RollInput extends RollBoundInput, RollShape {
  readonly secondsPerTick: number;
  readonly swing: Swing;
}

/** One hit of a roll: seconds after the step's swung time, and seconds held. */
export interface RollHit {
  readonly offset: number;
  readonly held: number;
}

/**
 * The hits a roll plays. Hit `j` starts at `j × spacing`, the spacing being
 * the whole step's swung span over `N`, and sounds only if it starts before
 * the bound. Each is held for `min(hold, spacing, time left to the bound)`.
 * The first always sounds: the onset itself is inside its region.
 */
export function rollHits(input: RollInput): RollHit[] {
  const { tick, divisor, secondsPerTick, swing, ratchet, hold } = input;
  const spacing = rollSpanSeconds({ tick, ticks: divisor, secondsPerTick, swing }) / ratchet;
  const reach = rollReachSeconds(input);
  const hits: RollHit[] = [];
  for (let j = 0; j < ratchet; j++) {
    const offset = j * spacing;
    if (j > 0 && offset >= reach - ON_BOUNDARY_SECONDS) break;
    hits.push({ offset, held: Math.min(hold, spacing, reach - offset) });
  }
  return hits;
}

/** Seconds from the onset's swung time to its bound; Infinity where none falls inside the step. */
export function rollReachSeconds(input: RollInput): number {
  const { tick, divisor, secondsPerTick, swing } = input;
  const ticks = rollBoundTicks(input);
  if (ticks >= divisor) return Infinity;
  return rollSpanSeconds({ tick, ticks, secondsPerTick, swing });
}

/** Ticks from the onset's tick to the first one its roll must not reach; Infinity with no bound. */
export function rollBoundTicks({ tick, regions, songTicks, loop }: RollBoundInput): number {
  return Math.min(ticksToRegionEnd(regions, songTicks, tick), ticksToLoopJump(loop, tick));
}

function ticksToRegionEnd(regions: readonly Region[], songTicks: number, tick: number): number {
  const state = regionState(regions, songTicks, tick);
  if (!state.live || isInfiniteRegion(regions, songTicks)) return Infinity;
  const region = regions[state.index] as Region;
  return region.duration - state.localTick;
}

/**
 * Ticks to the loop's jump: the clock issues the loop's start in place of
 * any tick `end + k * songTicks` (`followingTick`), so the bound is the first
 * such tick after the onset's.
 */
function ticksToLoopJump(loop: TickLoop | null, tick: number): number {
  if (!loop) return Infinity;
  const { start, end, songTicks } = loop;
  const span = end - start;
  if (!(span > 0) || span >= songTicks) return Infinity;
  return ((((end - tick - 1) % songTicks) + songTicks) % songTicks) + 1;
}
