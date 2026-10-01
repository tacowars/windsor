/**
 * A ratchet roll's reach (windsor#355): `rollBoundTicks` stops it at its
 * region's end or the loop's jump, whichever comes first, and the ∞ region
 * and a loop that jumps nothing bound nothing; `rollHits` keeps the whole
 * step's spacing and drops the hits from there on.
 */
import { describe, expect, it } from 'vitest';

import { rollSpanSeconds } from '../sequencing/euclidLanes';
import { STRAIGHT_SWING } from '../sequencing/swingTables';
import { rollBoundTicks, rollHits, type RollHit } from './rollSpan';

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

describe('rollHits', () => {
  const TICK = 0.01;
  const at = {
    secondsPerTick: TICK,
    songTicks: SONG,
    loop: null,
    divisor: 6,
    ratchet: 4,
    hold: 1,
    swing: STRAIGHT_SWING,
  };
  /** The hits as [start tick, held ticks] after the onset. */
  const inTicks = (hits: readonly RollHit[]): Array<[number, number]> =>
    hits.map(({ offset, held }) => [offset / TICK, held / TICK]);
  function expectTicks(hits: readonly RollHit[], expected: Array<[number, number]>): void {
    const actual = inTicks(hits);
    expect(actual).toHaveLength(expected.length);
    actual.forEach(([start, held], i) => {
      expect(start, `hit ${i} start`).toBeCloseTo(expected[i]![0], 9);
      expect(held, `hit ${i} hold`).toBeCloseTo(expected[i]![1], 9);
    });
  }

  it('spans the whole swung step where nothing cuts it', () => {
    const regions = [{ start: 0, duration: 24 }];
    const swing = { amount: 66, grid: 16 as const };
    const whole = rollSpanSeconds({ tick: 18, ticks: 6, secondsPerTick: TICK, swing });
    const hits = rollHits({ ...at, tick: 18, regions, swing });
    expect(hits.map((h) => h.offset)).toEqual([0, 1, 2, 3].map((j) => (j * whole) / 4));
    hits.forEach((h) => expect(h.held).toBe(whole / 4));
  });

  it('keeps the spacing and drops the hits from the region’s end on', () => {
    // Spacing 1.5 ticks; the region ends 2 ticks in, between the 2nd and 3rd hits.
    const regions = [{ start: 0, duration: 20 }];
    expectTicks(rollHits({ ...at, tick: 18, regions }), [
      [0, 1.5],
      [1.5, 0.5],
    ]);
  });

  it('drops a hit that would start exactly on the bound', () => {
    // Steps of 16 ticks, spacing 4; the loop jumps 8 ticks in, on the 3rd hit.
    const regions = [{ start: 0, duration: SONG }];
    const loop = { start: 0, end: 24, songTicks: SONG };
    expectTicks(rollHits({ ...at, divisor: 16, hold: 1, tick: 16, regions, loop }), [
      [0, 4],
      [4, 4],
    ]);
  });

  it('plays only its first hit in a one-tick region when the spacing is longer', () => {
    const regions = [{ start: 7, duration: 1 }];
    expectTicks(rollHits({ ...at, tick: 7, regions }), [[0, 1]]);
  });

  it('holds no hit past the bound, nor past its spacing, nor past the hold', () => {
    const regions = [{ start: 0, duration: 20 }];
    expectTicks(rollHits({ ...at, hold: 0.003, tick: 18, regions }), [
      [0, 0.3],
      [1.5, 0.3],
    ]);
  });
});
