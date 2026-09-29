import { describe, expect, it } from 'vitest';

import type { Harmony, Region } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { chordForRegion, regionChord, regionChordTick } from './chordRegionChord';
import { chordLabel } from './chordStepModel';
import type { AppCtx } from './context';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
/** C natural minor, one bar each: i | v | VI | iv. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: BAR, degree: 0, size: 3 },
    { start: BAR, duration: BAR, degree: 4, size: 3 },
    { start: 2 * BAR, duration: BAR, degree: 5, size: 3 },
    { start: 3 * BAR, duration: BAR, degree: 3, size: 3 },
  ],
};
/** Two chord regions: bar 1 (under i) and bar 2 (under v). */
const TWO: Region[] = [
  { start: 0, duration: BAR },
  { start: BAR, duration: BAR },
];

const label = (regions: readonly Region[], region: number | undefined, tick: number): string =>
  chordLabel(HARMONY, chordForRegion({ harmony: HARMONY, songTicks: SONG, regions, region, tick }));

describe('the selected region’s chord', () => {
  it('stopped at 1.1.1: region 2 reads its own chord, region 1 the one under the playhead', () => {
    expect(label(TWO, 1, 0)).toBe('G min v');
    expect(label(TWO, 0, 0)).toBe('C min i');
  });

  it('inside the region it follows the playhead, across a harmony boundary', () => {
    const long: Region[] = [{ start: 0, duration: 3 * BAR }];
    expect(label(long, 0, BAR / 2)).toBe('C min i');
    expect(label(long, 0, BAR + 1)).toBe('G min v');
    expect(label(long, 0, 2 * BAR + 1)).toBe('G# maj VI');
  });

  it('outside the region, playing or stopped, it reads the chord at the region’s start', () => {
    expect(label(TWO, 1, BAR / 2)).toBe('G min v');
    expect(label(TWO, 1, 3 * BAR)).toBe('G min v');
    expect(label(TWO, 0, BAR + 1)).toBe('C min i');
    // Past the song end the tick wraps, the way the gate reads it: back inside region 1.
    expect(label(TWO, 0, SONG + 1)).toBe('C min i');
  });

  it('a region starting exactly on a harmony boundary takes the chord that starts there', () => {
    const onBoundary: Region[] = [{ start: 2 * BAR, duration: BAR }];
    expect(
      regionChordTick({
        harmony: HARMONY,
        songTicks: SONG,
        regions: onBoundary,
        region: 0,
        tick: 0,
      }),
    ).toBe(2 * BAR);
    expect(label(onBoundary, 0, 0)).toBe('G# maj VI');
    expect(label(onBoundary, 0, 2 * BAR - 1)).toBe('G# maj VI');
  });

  it('a region spanning three chords reads the first while outside it', () => {
    const three: Region[] = [{ start: BAR, duration: 3 * BAR }];
    expect(label(three, 0, 0)).toBe('G min v');
    expect(label(three, 0, 3 * BAR + 1)).toBe('F min iv');
  });

  it('an empty harmony timeline gives no chord', () => {
    const empty: Harmony = { ...HARMONY, events: [] };
    expect(
      chordForRegion({ harmony: empty, songTicks: SONG, regions: TWO, region: 1, tick: 0 }),
    ).toBeNull();
    expect(
      chordForRegion({ harmony: empty, songTicks: SONG, regions: TWO, region: 0, tick: 0 }),
    ).toBeNull();
  });

  it('an ∞ region always follows the playhead', () => {
    const whole: Region[] = [{ start: 0, duration: SONG }];
    expect(label(whole, 0, 0)).toBe('C min i');
    expect(label(whole, 0, 3 * BAR)).toBe('F min iv');
    expect(label(whole, 0, SONG + BAR)).toBe('G min v');
  });

  it('no region, or one the part no longer has, follows the playhead', () => {
    expect(label(TWO, undefined, BAR)).toBe('G min v');
    expect(label(TWO, 5, 2 * BAR)).toBe('G# maj VI');
  });
});

describe('regionChord', () => {
  it('reads the document, the part’s regions and the audible tick from the context', () => {
    let tick = 0;
    const ctx = {
      model: {
        doc: {
          harmony: HARMONY,
          transport: { bars: 4 },
          parts: [{ slot: 2, regions: TWO }],
        },
      },
      transport: { running: false, position: (): number => tick },
    } as unknown as AppCtx;
    const name = (region: number | undefined): string =>
      chordLabel(HARMONY, regionChord(ctx, 2, region));
    expect(name(1)).toBe('G min v');
    expect(name(0)).toBe('C min i');
    tick = 2 * BAR;
    expect(name(0)).toBe('C min i');
    expect(name(undefined)).toBe('G# maj VI');
  });
});
