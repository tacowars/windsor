/**
 * A ratchet's roll: a Euclid step's (windsor#355), and since windsor#366 a
 * Grid or Arp note step's (decision 6 of
 * `docs/log/2026-10-01-sequencer-rack-devices.md`). Its hits are queued at
 * once, spaced evenly across the step's whole swung span (decision 6 of
 * `docs/log/2026-10-01-euclid-lanes-and-ratchets.md`). Where the onset's own
 * region ends or the loop jumps back inside that span, the roll keeps its
 * spacing and drops the hits that would start at or past the boundary, and
 * no hold crosses it: the time beyond belongs to a gap, another region or
 * the loop's start. The ∞ region and a loop that jumps nothing bound
 * nothing. Pure; `rollSpan.test.ts`.
 */
import { rollSpanSeconds } from '../sequencing/euclidLanes';
import { isInfiniteRegion, regionState, type Region } from '../sequencing/regionClock';
import type { MeterBeats } from '../sequencing/meterTables';
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
  /** The fraction of its spacing a hit may be held: an Arp's gate (windsor#366). Absent is 1. */
  readonly gate?: number;
}

export interface RollInput extends RollBoundInput, RollShape {
  readonly secondsPerTick: number;
  readonly swing: Swing;
  /** The song's meter's beats (windsor#429), as the clock swings them; 4/4's when absent. */
  readonly beats?: MeterBeats | undefined;
}

/** One hit of a roll: seconds after the step's swung time, and seconds held. */
export interface RollHit {
  readonly offset: number;
  readonly held: number;
}

/**
 * The hits a roll plays. Hit `j` starts at `j × spacing`, the spacing being
 * the whole step's swung span over `N`, and sounds only if it starts before
 * the bound. Each is held for `min(hold, gate × spacing, time left to the
 * bound)`, the gate 1 unless the shape names one.
 * The first always sounds: the onset itself is inside its region.
 */
export function rollHits(input: RollInput): RollHit[] {
  const { tick, divisor, secondsPerTick, swing, beats, ratchet, hold, gate = 1 } = input;
  const spacing = rollSpanSeconds({ tick, ticks: divisor, secondsPerTick, swing, beats }) / ratchet;
  const slice = spacing * gate;
  const reach = rollReachSeconds(input);
  const hits: RollHit[] = [];
  for (let j = 0; j < ratchet; j++) {
    const offset = j * spacing;
    if (j > 0 && offset >= reach - ON_BOUNDARY_SECONDS) break;
    hits.push({ offset, held: Math.min(hold, slice, reach - offset) });
  }
  return hits;
}

/** Seconds from the onset's swung time to its bound; Infinity where none falls inside the step. */
export function rollReachSeconds(input: RollInput): number {
  const { tick, divisor, secondsPerTick, swing, beats } = input;
  const ticks = rollBoundTicks(input);
  if (ticks >= divisor) return Infinity;
  return rollSpanSeconds({ tick, ticks, secondsPerTick, swing, beats });
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
