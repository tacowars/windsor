/**
 * A region laid over a lane (record `2026-10-06-song-region-move-copy-paste`):
 * what it covers goes, what it overlaps is trimmed, what it lands inside is
 * cut in two with its pattern on both pieces, the song's end cuts it, and a
 * move or a copy drops it anywhere in the song.
 */
import { describe, expect, it } from 'vitest';

import type { PartRegion, RegionPattern } from '@windsor/engine';
import { DEFAULT_CHORD_CONFIG, PPQ, TICKS_PER_BAR } from '@windsor/engine';
import { dropStart, moveRegionOver, placeRegion } from './regionPlacement';

const BAR = TICKS_PER_BAR;
const SONG = 8 * BAR;
const region = (start: number, duration: number): PartRegion => ({ start, duration });
const chord = (octave: number): RegionPattern => ({
  ...DEFAULT_CHORD_CONFIG,
  kind: 'chord',
  register: { octave },
});
const held = (start: number, duration: number, octave: number): PartRegion => ({
  start,
  duration,
  pattern: chord(octave),
});

describe('placing a region', () => {
  it('lands in a gap untouched, the list sorted and its index named', () => {
    const lane = [region(0, BAR), region(4 * BAR, BAR)];
    expect(placeRegion(lane, region(2 * BAR, BAR), SONG)).toEqual({
      regions: [region(0, BAR), region(2 * BAR, BAR), region(4 * BAR, BAR)],
      index: 1,
    });
  });

  it('removes what it covers and trims what it overlaps at either edge', () => {
    const lane = [region(0, 2 * BAR), region(2 * BAR, BAR), region(3 * BAR, 3 * BAR)];
    const placed = placeRegion(lane, region(BAR, 3 * BAR), SONG);
    expect(placed?.regions).toEqual([
      region(0, BAR),
      region(BAR, 3 * BAR),
      region(4 * BAR, 2 * BAR),
    ]);
    expect(placed?.index).toBe(1);
  });

  it('cuts a region it lands inside in two, both pieces keeping the pattern', () => {
    const placed = placeRegion([held(0, SONG, 3)], held(2 * BAR, BAR, 5), SONG);
    expect(placed?.regions).toEqual([
      held(0, 2 * BAR, 3),
      held(2 * BAR, BAR, 5),
      held(3 * BAR, 5 * BAR, 3),
    ]);
  });

  it("cuts its end at the song's, and refuses a start past it", () => {
    expect(placeRegion([], region(6 * BAR, 4 * BAR), SONG)?.regions).toEqual([
      region(6 * BAR, 2 * BAR),
    ]);
    expect(placeRegion([], region(SONG, BAR), SONG)).toBeNull();
  });
});

describe('moving or copying a region over the lane', () => {
  const lane = [held(0, 2 * BAR, 2), held(2 * BAR, 2 * BAR, 4)];

  it('drops whole inside the song, snapped', () => {
    expect(dropStart(region(0, 2 * BAR), 7 * BAR, SONG)).toBe(6 * BAR);
    expect(dropStart(region(0, 2 * BAR), -BAR, SONG)).toBe(0);
    expect(dropStart(region(0, BAR), 3 * BAR + PPQ, SONG, PPQ)).toBe(3 * BAR + PPQ);
  });

  it('carries a region past its neighbour with its pattern, the neighbour untouched', () => {
    expect(moveRegionOver(lane, 0, 5 * BAR, { songTicks: SONG })).toEqual({
      regions: [held(2 * BAR, 2 * BAR, 4), held(5 * BAR, 2 * BAR, 2)],
      index: 1,
    });
  });

  it('copies with the original kept, and changes nothing dropped where it started', () => {
    expect(moveRegionOver(lane, 0, 4 * BAR, { songTicks: SONG, copy: true })?.regions).toEqual([
      ...lane,
      held(4 * BAR, 2 * BAR, 2),
    ]);
    expect(moveRegionOver(lane, 1, 2 * BAR, { songTicks: SONG, copy: true })).toEqual({
      regions: lane,
      index: 1,
    });
    expect(moveRegionOver(lane, 5, 0, { songTicks: SONG })).toBeNull();
  });

  it('trims the original under a copy that overlaps it, as any region it lands on', () => {
    const copied = moveRegionOver([held(0, 4 * BAR, 2)], 0, 2 * BAR, {
      songTicks: SONG,
      copy: true,
    });
    expect(copied).toEqual({ regions: [held(0, 2 * BAR, 2), held(2 * BAR, 4 * BAR, 2)], index: 1 });
  });
});
