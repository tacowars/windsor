/**
 * The region edits over the ticket's fixtures (#709 decision 3): add at a
 * bar, resize into a neighbour and past the song, move, split, delete, the
 * ∞ / ⟲ mark, the modifier snap per kind, and a song-length change carrying
 * the whole-song regions and the timeline along (decision 4). Every
 * expectation is an expression of the engine's tick constants.
 */
import { describe, expect, it } from 'vitest';

import type { Region } from '@windsor/engine';
import {
  DEFAULT_BASS_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_GRID_CONFIG,
  PPQ,
  TICKS_PER_BAR,
  partAt,
} from '@windsor/engine';
import { DocumentModel } from './documentModel';
import {
  addRegion,
  deleteRegion,
  dragRegion,
  fitRegions,
  followSongLength,
  moveRegion,
  regionMark,
  resizeRegionEnd,
  resizeRegionStart,
  snapGrain,
  snapTick,
  splitRegion,
} from './regionModel';
import { NEW_SONG_BARS } from './songConstants';
import { newSong } from './songParts';
import { barsChange } from './transportModel';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const region = (start: number, duration: number): Region => ({ start, duration });

describe('regions on a lane', () => {
  it('adds a bar-snapped region on an empty lane at bar 3', () => {
    expect(addRegion([], 2 * BAR + PPQ, SONG)).toEqual([region(2 * BAR, BAR)]);
  });

  it('adds nothing inside a region, past the song, or in a gap with no room', () => {
    expect(addRegion([region(0, SONG)], BAR, SONG)).toBeNull();
    expect(addRegion([], SONG + 1, SONG)).toBeNull();
    expect(addRegion([region(BAR, BAR)], 0, SONG)).toEqual([region(0, BAR), region(BAR, BAR)]);
  });

  it('resizes an end into the next region, clamped to that start', () => {
    const lane = [region(0, BAR), region(3 * BAR, BAR)];
    expect(resizeRegionEnd(lane, 0, 3 * BAR + PPQ, SONG)).toEqual([
      region(0, 3 * BAR),
      region(3 * BAR, BAR),
    ]);
  });

  it('resizes an end past the song end, clamped to it', () => {
    expect(resizeRegionEnd([region(2 * BAR, BAR)], 0, 9 * BAR, SONG)).toEqual([
      region(2 * BAR, 2 * BAR),
    ]);
  });

  it('keeps a region at least a grain long from either edge', () => {
    expect(resizeRegionEnd([region(BAR, BAR)], 0, 0, SONG)).toEqual([region(BAR, BAR)]);
    expect(resizeRegionStart([region(BAR, BAR)], 0, 3 * BAR)).toEqual([region(BAR, BAR)]);
    expect(resizeRegionStart([region(0, BAR), region(2 * BAR, BAR)], 1, 0)).toEqual([
      region(0, BAR),
      region(BAR, 2 * BAR),
    ]);
  });

  it('moves a region keeping its duration, clamped to its neighbours and the song', () => {
    const lane = [region(0, BAR), region(3 * BAR, BAR)];
    expect(moveRegion(lane, 0, 2 * BAR + PPQ, SONG)).toEqual([
      region(2 * BAR, BAR),
      region(3 * BAR, BAR),
    ]);
    expect(moveRegion([region(0, 2 * BAR)], 0, 3 * BAR, SONG)).toEqual([region(2 * BAR, 2 * BAR)]);
  });

  it('splits at a snapped tick inside, the second region starting on it', () => {
    expect(splitRegion([region(0, SONG)], 0, 2 * BAR + PPQ)).toEqual([
      region(0, 2 * BAR),
      region(2 * BAR, 2 * BAR),
    ]);
    expect(splitRegion([region(0, SONG)], 0, 0)).toEqual([region(0, SONG)]);
  });

  it('deletes a region, leaving a gap', () => {
    expect(deleteRegion([region(0, BAR), region(2 * BAR, BAR)], 0)).toEqual([region(2 * BAR, BAR)]);
  });

  it('marks the one whole-song region ∞ and a shorter region at 0 ⟲', () => {
    expect(regionMark([region(0, SONG)], SONG)).toBe('∞');
    expect(regionMark([region(0, SONG - BAR)], SONG)).toBe('⟲');
    expect(regionMark([region(0, 2 * BAR), region(2 * BAR, 2 * BAR)], SONG)).toBe('⟲');
  });
});

describe('the snap grain', () => {
  const grid7 = { ...DEFAULT_GRID_CONFIG, kind: 'grid' as const, length: 7 };

  it('is a bar without the modifier, whatever the kind', () => {
    expect(snapGrain(grid7, false)).toBe(TICKS_PER_BAR);
    expect(snapGrain(undefined, false)).toBe(TICKS_PER_BAR);
  });

  it('puts an edge of a 7-step 1/16 grid on a step: 42 ticks', () => {
    const grain = snapGrain(grid7, true);
    expect(grain).toBe(grid7.divisor);
    expect(snapTick(7 * grid7.divisor + 1, grain)).toBe(42);
  });

  it('snaps a Chord Player to its divisor and a bass to the beat', () => {
    expect(snapGrain({ ...DEFAULT_CHORD_CONFIG, kind: 'chord' }, true)).toBe(
      DEFAULT_CHORD_CONFIG.divisor,
    );
    expect(snapGrain({ ...DEFAULT_BASS_CONFIG, kind: 'bass' }, true)).toBe(PPQ);
  });
});

describe('a song-length change', () => {
  it('grows every ∞ region with the song and clamps the rest', () => {
    expect(fitRegions([region(0, 4 * BAR)], 6 * BAR, 4 * BAR)).toEqual({
      regions: [region(0, 6 * BAR)],
      changed: true,
    });
    expect(fitRegions([region(0, 6 * BAR)], 4 * BAR, 6 * BAR)).toEqual({
      regions: [region(0, 4 * BAR)],
      changed: true,
    });
    expect(fitRegions([region(3 * BAR, 2 * BAR), region(5 * BAR, BAR)], 4 * BAR, 6 * BAR)).toEqual({
      regions: [region(3 * BAR, BAR)],
      changed: true,
    });
    expect(fitRegions([region(0, BAR)], 6 * BAR, 4 * BAR)).toEqual({
      regions: [region(0, BAR)],
      changed: false,
    });
  });

  it('carries a Bars edit through the new song: the ∞ region and the last event follow, and the report says so', () => {
    const model = new DocumentModel(newSong());
    const grown = NEW_SONG_BARS + 2;
    const { partial, report } = followSongLength(model.doc, barsChange(grown));
    expect(partial.transport?.bars).toBe(grown);
    expect(partial.parts?.[0]).toEqual({ regions: [region(0, grown * BAR)] });
    const events = partial.harmony?.events ?? [];
    const last = events[events.length - 1];
    expect(last && last.start + last.duration).toBe(grown * BAR);
    expect(report).toEqual(['Part 1 regions', 'harmony events']);
    model.merge(partial);
    expect(partAt(model.doc, 0)?.regions).toEqual([region(0, grown * BAR)]);
  });

  it('leaves every other partial, and a Bars edit to the same length, untouched', () => {
    const model = new DocumentModel(newSong());
    const same = barsChange(NEW_SONG_BARS);
    expect(followSongLength(model.doc, same)).toEqual({ partial: same, report: [] });
    const bpm = { transport: { bpm: 100 } };
    expect(followSongLength(model.doc, bpm)).toEqual({ partial: bpm, report: [] });
  });
});

describe("a drag by the pointer's travel (windsor#21)", () => {
  const beat = [region(0, BAR), region(2 * BAR, PPQ)];

  it("changes a widened block's length by the travel, not by where its drawn end sits", () => {
    // The drawn end of a one-beat block widened at the floor sits past its span: a still press there changes nothing.
    expect(dragRegion(beat, { kind: 'resizeEnd', index: 1, deltaTicks: 0 }, SONG, PPQ)).toEqual(
      beat,
    );
    const longer = dragRegion(beat, { kind: 'resizeEnd', index: 1, deltaTicks: PPQ }, SONG, PPQ);
    expect(longer[1]).toEqual(region(2 * BAR, 2 * PPQ));
    const snapped = dragRegion(
      beat,
      { kind: 'resizeEnd', index: 1, deltaTicks: 0.6 * PPQ },
      SONG,
      PPQ,
    );
    expect(snapped[1]).toEqual(region(2 * BAR, 2 * PPQ));
  });

  it('moves the start and the body by the travel too, within the neighbours', () => {
    const regions = [region(0, BAR), region(2 * BAR, BAR)];
    const start = dragRegion(regions, { kind: 'resizeStart', index: 1, deltaTicks: -BAR }, SONG);
    expect(start[1]).toEqual(region(BAR, 2 * BAR));
    const moved = dragRegion(regions, { kind: 'move', index: 1, deltaTicks: 0.4 * BAR }, SONG);
    expect(moved).toEqual(regions);
    expect(dragRegion(regions, { kind: 'move', index: 1, deltaTicks: 5 * BAR }, SONG)[1]).toEqual(
      region(3 * BAR, BAR),
    );
    expect(dragRegion(regions, { kind: 'move', index: 7, deltaTicks: BAR }, SONG)).toEqual(regions);
  });
});
