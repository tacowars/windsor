/**
 * The one position rule (#705, epic #703 decision 2): where a part is in its
 * regions at a transport tick. Each case is a fixture the ticket names; the
 * song is four bars unless a case says otherwise, and every tick is written
 * as bars of `TICKS_PER_BAR` so the numbers read as the rule, not as magic.
 */
import { describe, expect, it } from 'vitest';

import { NOT_LIVE, isInfiniteRegion, regionState, type Region } from './regionClock';
import { TICKS_PER_BAR } from './scheduler';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const live = (index: number, entryTick: number, localTick: number) => ({
  live: true,
  index,
  entryTick,
  localTick,
});

describe('regionState', () => {
  it('no regions → never live', () => {
    expect(regionState([], SONG, 0)).toEqual(NOT_LIVE);
    expect(regionState([], SONG, 5 * BAR + 3)).toEqual(NOT_LIVE);
  });

  it('one ∞ region over a 4-bar song: tick 5, the wrap at tick 384 and tick 389 all report index 0, entry 0, localTick = tick', () => {
    const inf: Region[] = [{ start: 0, duration: SONG }];
    expect(isInfiniteRegion(inf, SONG)).toBe(true);
    expect(regionState(inf, SONG, 5)).toEqual(live(0, 0, 5));
    expect(regionState(inf, SONG, SONG)).toEqual(live(0, 0, SONG));
    expect(regionState(inf, SONG, SONG + 5)).toEqual(live(0, 0, SONG + 5));
  });

  it('two adjacent regions (bars 1–2, bars 3–4): tick 192 belongs to the second at localTick 0, tick 191 to the first at 191', () => {
    const two: Region[] = [
      { start: 0, duration: 2 * BAR },
      { start: 2 * BAR, duration: 2 * BAR },
    ];
    expect(isInfiniteRegion(two, SONG)).toBe(false);
    expect(regionState(two, SONG, 2 * BAR)).toEqual(live(1, 2 * BAR, 0));
    expect(regionState(two, SONG, 2 * BAR - 1)).toEqual(live(0, 0, 2 * BAR - 1));
  });

  it('a region starting at tick 0 that is not whole-song (bars 1–2 of 4): tick 384 re-enters it', () => {
    const head: Region[] = [{ start: 0, duration: 2 * BAR }];
    expect(isInfiniteRegion(head, SONG)).toBe(false);
    expect(regionState(head, SONG, SONG)).toEqual(live(0, SONG, 0));
    expect(regionState(head, SONG, SONG + 2 * BAR)).toEqual(NOT_LIVE);
  });

  it('a region ending at the song end (bars 3–4): tick 768 is a re-entry at localTick 0 of index 0, not the same region', () => {
    const tail: Region[] = [{ start: 2 * BAR, duration: 2 * BAR }];
    expect(regionState(tail, SONG, SONG - 1)).toEqual(live(0, 2 * BAR, 2 * BAR - 1));
    expect(regionState(tail, SONG, SONG)).toEqual(NOT_LIVE);
    expect(regionState(tail, SONG, 2 * SONG)).toEqual(NOT_LIVE);
    expect(regionState(tail, SONG, 2 * SONG - 2 * BAR)).toEqual(live(0, 2 * SONG - 2 * BAR, 0));
    // Two regions meeting at the song end: tick 768 is the *first* region again, freshly entered.
    const both: Region[] = [
      { start: 0, duration: BAR },
      { start: 2 * BAR, duration: 2 * BAR },
    ];
    expect(regionState(both, SONG, 2 * SONG)).toEqual(live(0, 2 * SONG, 0));
  });

  it('a tick in a gap → not live (an overlap has been clamped away by the normaliser)', () => {
    const gapped: Region[] = [
      { start: 0, duration: BAR },
      { start: 3 * BAR, duration: BAR },
    ];
    expect(regionState(gapped, SONG, BAR)).toEqual(NOT_LIVE);
    expect(regionState(gapped, SONG, 3 * BAR - 1)).toEqual(NOT_LIVE);
    expect(regionState(gapped, SONG, 3 * BAR)).toEqual(live(1, 3 * BAR, 0));
  });

  it('a region beyond the song end never matches, and a zero-length song is never live', () => {
    const beyond: Region[] = [{ start: SONG, duration: BAR }];
    for (const tick of [0, SONG, SONG + 1, 2 * SONG]) {
      expect(regionState(beyond, SONG, tick), String(tick)).toEqual(NOT_LIVE);
    }
    expect(regionState([{ start: 0, duration: 1 }], 0, 0)).toEqual(NOT_LIVE);
  });
});
