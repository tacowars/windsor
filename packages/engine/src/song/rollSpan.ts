/**
 * How far a Euclid ratchet's roll reaches (windsor#355). Its hits are queued
 * at once, evenly across the step's swung span, so the span stops at the
 * first tick the onset's own region and transport no longer carry on to: the
 * end of the region the hit came from, or the loop's jump back. Past either,
 * the time belongs to a gap, another region or the loop's start. The ∞
 * region and a loop that jumps nothing bound nothing. Pure; `rollSpan.test.ts`.
 */
import { rollSpanSeconds } from '../sequencing/euclidLanes';
import { isInfiniteRegion, regionState, type Region } from '../sequencing/regionClock';
import type { TickLoop } from '../sequencing/scheduler';
import type { Swing } from '../sequencing/swingTables';

export interface RollBoundInput {
  /** The onset's transport tick. */
  readonly tick: number;
  /** The regions of the part the onset played on. */
  readonly regions: readonly Region[];
  readonly songTicks: number;
  readonly loop: TickLoop | null;
}

export interface RollInput extends RollBoundInput {
  /** The step's length in ticks: the span when nothing bounds it. */
  readonly divisor: number;
  readonly secondsPerTick: number;
  readonly swing: Swing;
}

/** Seconds a roll's hits divide: the step's swung span, cut at its region's end or the loop's jump. */
export function rollSeconds(input: RollInput): number {
  const { tick, divisor, secondsPerTick, swing } = input;
  const ticks = Math.min(divisor, rollBoundTicks(input));
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
