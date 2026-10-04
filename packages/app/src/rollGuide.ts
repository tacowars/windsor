/**
 * Which tick the Roll's key guide reads its chord at (windsor#602 decision
 * 5), and where the playhead stands in the region, without the DOM.
 *
 * The guide's chord is one of three, in this order: the chord at the
 * playhead while the song plays inside the region; the chord under the
 * pointer while it is over the notes; otherwise the chord where the
 * playhead stands — its spot in the region when it stands inside it, else
 * the region's first tick, the chord the region opens on.
 *
 * The playhead's spot is the performer's (windsor#600): the loop tick the
 * engine's `regionStepAt` answers, bright while the song is inside the
 * region and a ghost while it is not. The roll draws the whole region, so a
 * live playhead goes on the pass of the loop the song is in, which the
 * engine's `regionState` (the gate's own reading) gives; a ghost stands on
 * the first pass.
 */
import type { Region, RegionStep } from '@windsor/engine';
import { regionState } from '@windsor/engine';
import { DARK, ghostOf } from './regionPlayhead';

/** Where the guide's chord came from. */
export type GuideSource = 'playhead' | 'pointer' | 'standing';

/** What the guide chooses between, each in the region's local ticks. */
export interface GuideInput {
  /** The playhead while the song plays inside the region, else null. */
  readonly playing: number | null;
  /** The pointer over the notes, else null. */
  readonly pointer: number | null;
  /** Where the playhead stands (`standingTick`). */
  readonly standing: number;
}

/** The guide's tick and its source. */
export function guideTick(input: GuideInput): { tick: number; source: GuideSource } {
  if (input.playing !== null) return { tick: input.playing, source: 'playhead' };
  if (input.pointer !== null) return { tick: input.pointer, source: 'pointer' };
  return { tick: input.standing, source: 'standing' };
}

/** Which region the roll shows, where the transport is, and what the engine reads there. */
export interface RollClock {
  readonly regions: readonly Region[];
  readonly songTicks: number;
  /** The region's index in the part. */
  readonly region: number;
  /** The region's length in ticks. */
  readonly regionTicks: number;
  /** The loop the region plays. */
  readonly loopTicks: number;
  /** The audible transport tick. */
  readonly tick: number;
  /** The engine's reading of the region at `tick` (`host.regionStepAt`): its loop tick, live or a ghost. */
  readonly at: RegionStep | null;
}

/** Where the playhead stands in the region's local ticks, and whether the song is inside it. */
export interface RollPosition {
  readonly tick: number;
  readonly live: boolean;
}

/**
 * The playhead in the region: the engine's loop tick, on the pass of the
 * loop the song is in. A ghost (the song elsewhere) stands on the first pass.
 */
export function rollPosition(clock: RollClock): RollPosition | null {
  const { at, loopTicks, regionTicks } = clock;
  if (!at || at.step < 0) return null;
  if (!at.live) return { tick: at.step, live: false };
  const state = regionState(clock.regions, clock.songTicks, clock.tick);
  const inside = state.live && state.index === clock.region && regionTicks > 0;
  const local = inside ? state.localTick % regionTicks : at.step;
  const pass = loopTicks > 0 ? Math.floor(local / loopTicks) : 0;
  const tick = pass * loopTicks + at.step;
  return { tick: tick < regionTicks ? tick : at.step, live: true };
}

/** The playhead while the song plays inside the region, else null. */
export function playingTick(clock: RollClock, running: boolean): number | null {
  const position = running ? rollPosition(clock) : null;
  return position?.live ? position.tick : null;
}

/** Where the playhead stands for the guide: its spot inside the region, else the region's start. */
export function standingTick(clock: RollClock): number {
  const position = rollPosition(clock);
  return position?.live ? position.tick : 0;
}

/** The playhead as `regionPlayhead.ts` numbers it: the tick bright, its ghost, or dark while halted. */
export function rollPlayhead(clock: RollClock, running: boolean): number {
  const position = running ? rollPosition(clock) : null;
  if (!position) return DARK;
  return position.live ? position.tick : ghostOf(position.tick);
}

/** The pointer's tick from its x in the notes pane, kept inside the region. */
export const pointerTick = (x: number, pxPerTick: number, regionTicks: number): number =>
  Math.max(0, Math.min(regionTicks - 1, Math.floor(x / pxPerTick)));
