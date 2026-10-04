/**
 * The key guide's three sources (windsor#602 decision 5) and where the
 * playhead stands in the region.
 */
import { describe, expect, it } from 'vitest';
import type { RegionStep } from '@windsor/engine';
import { DARK, ghostOf } from './regionPlayhead';
import {
  type RollClock,
  guideTick,
  playingTick,
  pointerTick,
  rollPlayhead,
  standingTick,
} from './rollGuide';

const BAR = 96;

describe('guideTick', () => {
  it('follows the playhead while the song plays in the region, over the pointer', () => {
    expect(guideTick({ playing: 200, pointer: 300, standing: 0 })).toEqual({
      tick: 200,
      source: 'playhead',
    });
  });

  it('follows the pointer over the notes while the region is not playing', () => {
    expect(guideTick({ playing: null, pointer: 300, standing: 40 })).toEqual({
      tick: 300,
      source: 'pointer',
    });
  });

  it('otherwise reads where the playhead stands', () => {
    expect(guideTick({ playing: null, pointer: null, standing: 40 })).toEqual({
      tick: 40,
      source: 'standing',
    });
  });
});

describe('the playhead in the region', () => {
  // Region 2 of the part: bars 9 to 16 of a 16-bar song, on a 3-bar loop.
  const LOOP = 3 * BAR;
  const clock = (
    tick: number,
    at: RegionStep | null,
    over: Partial<RollClock> = {},
  ): RollClock => ({
    regions: [
      { start: 0, duration: 4 * BAR },
      { start: 8 * BAR, duration: 8 * BAR },
    ],
    songTicks: 16 * BAR,
    region: 1,
    regionTicks: 8 * BAR,
    loopTicks: LOOP,
    tick,
    at,
    ...over,
  });
  const live = (step: number): RegionStep => ({ step, live: true });

  it("puts the engine's loop tick on the pass the song is in", () => {
    // Bar 13 is local tick 4 bars: the second pass, a bar in.
    expect(playingTick(clock(12 * BAR, live(BAR)), true)).toBe(LOOP + BAR);
    expect(rollPlayhead(clock(12 * BAR, live(BAR)), true)).toBe(LOOP + BAR);
    // The song wraps: a transport tick past the end reads from bar 1.
    expect(playingTick(clock(16 * BAR + 9 * BAR, live(BAR)), true)).toBe(BAR);
  });

  it('is a ghost on the first pass while the song is elsewhere, and dark while halted', () => {
    const elsewhere = clock(BAR, { step: 40, live: false });
    expect(playingTick(elsewhere, true)).toBeNull();
    expect(rollPlayhead(elsewhere, true)).toBe(ghostOf(40));
    expect(rollPlayhead(clock(12 * BAR, live(BAR)), false)).toBe(DARK);
    expect(rollPlayhead(clock(12 * BAR, null), true)).toBe(DARK);
  });

  it('stands at its spot inside the region, else at the region start', () => {
    expect(standingTick(clock(10 * BAR, live(2 * BAR)))).toBe(2 * BAR);
    expect(standingTick(clock(BAR, { step: BAR, live: false }))).toBe(0);
    expect(standingTick(clock(BAR, null))).toBe(0);
  });

  it('folds the ∞ region’s unwrapped tick into the region', () => {
    const endless = clock(17 * BAR, live(BAR), {
      regions: [{ start: 0, duration: 16 * BAR }],
      region: 0,
      regionTicks: 16 * BAR,
      loopTicks: 16 * BAR,
    });
    expect(playingTick(endless, true)).toBe(BAR);
  });
});

describe('pointerTick', () => {
  it('reads the pointer in ticks, kept inside the region', () => {
    expect(pointerTick(50, 0.5, 8 * BAR)).toBe(100);
    expect(pointerTick(-5, 0.5, 8 * BAR)).toBe(0);
    expect(pointerTick(9999, 0.5, 8 * BAR)).toBe(8 * BAR - 1);
  });
});
