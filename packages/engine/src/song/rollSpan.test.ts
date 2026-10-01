/**
 * A ratchet roll's reach (windsor#355): `rollBoundTicks` stops it at its
 * region's end or the loop's jump, whichever comes first, and the ∞ region
 * and a loop that jumps nothing bound nothing; `rollSeconds` is the step's
 * swung span, cut there.
 */
import { describe, expect, it } from 'vitest';

import { rollSpanSeconds } from '../sequencing/euclidLanes';
import { STRAIGHT_SWING } from '../sequencing/swingTables';
import { rollBoundTicks, rollSeconds } from './rollSpan';

const SONG = 384;

describe('rollBoundTicks', () => {
  it('is the ticks left in the onset’s region', () => {
    const regions = [{ start: 0, duration: 20 }];
    expect(rollBoundTicks({ tick: 18, regions, songTicks: SONG, loop: null })).toBe(2);
    expect(rollBoundTicks({ tick: 0, regions, songTicks: SONG, loop: null })).toBe(20);
    // A later iteration of the song: the region is read at `tick mod songTicks`.
    expect(rollBoundTicks({ tick: SONG + 19, regions, songTicks: SONG, loop: null })).toBe(1);
  });

  it('is one for a one-tick region', () => {
    const regions = [{ start: 7, duration: 1 }];
    expect(rollBoundTicks({ tick: 7, regions, songTicks: SONG, loop: null })).toBe(1);
  });

  it('is unbounded in the ∞ region with no loop', () => {
    const regions = [{ start: 0, duration: SONG }];
    expect(rollBoundTicks({ tick: SONG - 1, regions, songTicks: SONG, loop: null })).toBe(Infinity);
  });

  it('is the ticks to the loop’s jump when it comes first', () => {
    const regions = [{ start: 0, duration: SONG }];
    const loop = { start: 24, end: 48, songTicks: SONG };
    expect(rollBoundTicks({ tick: 40, regions, songTicks: SONG, loop })).toBe(8);
    expect(rollBoundTicks({ tick: 47, regions, songTicks: SONG, loop })).toBe(1);
    // A tick before the loop plays on into it; one past its end wraps the song first.
    expect(rollBoundTicks({ tick: 0, regions, songTicks: SONG, loop })).toBe(48);
    expect(rollBoundTicks({ tick: 48, regions, songTicks: SONG, loop })).toBe(SONG);
    const short = [{ start: 24, duration: 20 }];
    expect(rollBoundTicks({ tick: 40, regions: short, songTicks: SONG, loop })).toBe(4);
  });

  it('ignores a loop that jumps nothing', () => {
    const regions = [{ start: 0, duration: SONG }];
    const whole = { start: 0, end: SONG, songTicks: SONG };
    const empty = { start: 24, end: 24, songTicks: SONG };
    expect(rollBoundTicks({ tick: 40, regions, songTicks: SONG, loop: whole })).toBe(Infinity);
    expect(rollBoundTicks({ tick: 20, regions, songTicks: SONG, loop: empty })).toBe(Infinity);
  });
});

describe('rollSeconds', () => {
  const at = { secondsPerTick: 0.01, songTicks: SONG, loop: null, divisor: 6 };

  it('is the whole step where nothing cuts it', () => {
    const regions = [{ start: 0, duration: 24 }];
    const swing = { amount: 66, grid: 16 as const };
    const whole = rollSpanSeconds({ tick: 18, ticks: 6, secondsPerTick: 0.01, swing });
    expect(rollSeconds({ ...at, tick: 18, regions, swing })).toBe(whole);
  });

  it('is the ticks left where the region ends inside the step', () => {
    const regions = [{ start: 0, duration: 20 }];
    expect(rollSeconds({ ...at, tick: 18, regions, swing: STRAIGHT_SWING })).toBeCloseTo(0.02, 15);
  });
});
