/**
 * The region edits over the ticket's fixtures (#709 decision 3): add at a
 * bar, resize into a neighbour and past the song, move, split, delete, the
 * ∞ / ⟲ mark, the modifier snap per kind, and a song-length change carrying
 * the whole-song regions and the timeline along (decision 4). Every
 * expectation is an expression of the engine's tick constants. A 7/8 song
 * snaps and draws on its 84-tick bar (windsor#430).
 */
import { describe, expect, it } from 'vitest';

import type { PartRegion, Region, RegionPattern } from '@windsor/engine';
import {
  DEFAULT_BASS_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_GRID_CONFIG,
  PPQ,
  TICKS_PER_BAR,
  partAt,
  ticksPerBar,
} from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { drawRegionChange } from './partEdits';
import {
  addRegion,
  deleteRegion,
  dragRegion,
  drawRegion,
  fitRegions,
  followSongLength,
  moveRegion,
  neighbourIndex,
  regionMark,
  resizeRegionEnd,
  resizeRegionStart,
  rollRegionSeam,
  snapGrain,
  snapTick,
  splitRegion,
} from './regionModel';
import { NEW_SONG_BARS } from './songConstants';
import { newSong } from './songParts';
import { barsChange } from './transportModel';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
/** One bar of 7/8: 84 ticks. */
const SEVEN = ticksPerBar('7/8');
const region = (start: number, duration: number): Region => ({ start, duration });

describe('regions on a lane', () => {
  it('adds a bar-snapped region on an empty lane at bar 3', () => {
    expect(addRegion([], 2 * BAR + PPQ, SONG)).toEqual([region(2 * BAR, BAR)]);
  });

  it("draws a 7/8 song's region on its 84-tick bar, a bar long", () => {
    expect(SEVEN).toBe(84);
    const model = new DocumentModel(newSong('7/8'));
    model.merge({ parts: { 0: { regions: [] } } });
    const drawn = drawRegionChange(model.doc, 0, 2 * SEVEN + PPQ, (raw) => model.preview(raw));
    expect(drawn?.regions).toEqual([region(2 * SEVEN, SEVEN)]);
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

  it("is a bar without the modifier, whatever the kind: the song's bar", () => {
    expect(snapGrain(grid7, false)).toBe(TICKS_PER_BAR);
    expect(snapGrain(undefined, false)).toBe(TICKS_PER_BAR);
    expect(snapGrain(grid7, false, SEVEN)).toBe(SEVEN);
    const lane = [region(0, SEVEN), region(2 * SEVEN, SEVEN)];
    const moved = dragRegion(
      lane,
      { kind: 'move', index: 1, deltaTicks: 0.6 * SEVEN },
      8 * SEVEN,
      SEVEN,
    );
    expect(moved[1]).toEqual(region(3 * SEVEN, SEVEN));
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

describe('a region carries its pattern through every edit (windsor#75)', () => {
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

  it('keeps it through a move, a resize at either edge and a drag', () => {
    const lane = [held(0, BAR, 2), held(2 * BAR, BAR, 5)];
    expect(moveRegion(lane, 1, 3 * BAR, SONG)[1]).toEqual(held(3 * BAR, BAR, 5));
    expect(resizeRegionEnd(lane, 0, 2 * BAR, SONG)[0]).toEqual(held(0, 2 * BAR, 2));
    expect(resizeRegionStart(lane, 1, BAR)[1]).toEqual(held(BAR, 2 * BAR, 5));
    const drag = { kind: 'move', index: 0, deltaTicks: BAR } as const;
    expect(dragRegion(lane, drag, SONG)[0]).toEqual(held(BAR, BAR, 2));
  });

  it("gives both halves of a split the region's own pattern, or the fill when it had none", () => {
    expect(splitRegion([held(0, SONG, 4)], 0, 2 * BAR)).toEqual([
      held(0, 2 * BAR, 4),
      held(2 * BAR, 2 * BAR, 4),
    ]);
    expect(splitRegion([region(0, SONG)], 0, 2 * BAR, BAR, chord(1))).toEqual([
      held(0, 2 * BAR, 1),
      held(2 * BAR, 2 * BAR, 1),
    ]);
    expect(splitRegion([region(0, SONG)], 0, 2 * BAR)).toEqual([
      region(0, 2 * BAR),
      region(2 * BAR, 2 * BAR),
    ]);
  });

  it('takes the pattern away with a deleted region and keeps it through a song-length change', () => {
    expect(deleteRegion([held(0, BAR, 1), held(2 * BAR, BAR, 2)], 0)).toEqual([
      held(2 * BAR, BAR, 2),
    ]);
    expect(fitRegions([held(0, SONG, 3)], 6 * BAR, SONG).regions).toEqual([held(0, 6 * BAR, 3)]);
    expect(fitRegions([held(BAR, 3 * BAR, 3)], 2 * BAR, SONG).regions).toEqual([held(BAR, BAR, 3)]);
  });

  it("keeps the other regions' patterns when one is added", () => {
    expect(addRegion([held(0, BAR, 2)], 2 * BAR, SONG)).toEqual([
      held(0, BAR, 2),
      region(2 * BAR, BAR),
    ]);
  });

  it('names the region a drawn one copies: the nearest before it, else the nearest after', () => {
    const lane = [region(BAR, BAR), region(4 * BAR, BAR), region(6 * BAR, BAR)];
    expect(neighbourIndex(lane, 5 * BAR)).toBe(1);
    expect(neighbourIndex(lane, 3 * BAR)).toBe(0);
    expect(neighbourIndex(lane, 0)).toBe(0);
    expect(neighbourIndex(lane.slice(1), 0)).toBe(0);
    expect(neighbourIndex([], 0)).toBe(-1);
  });
});

describe('a seam, a short region and a drawn stretch (windsor#551)', () => {
  const LONG = 16 * BAR;
  const grains = { grain: BAR, step: PPQ };

  it('rolls a seam: one region grows, the other shrinks, the ones beyond stay', () => {
    const lane = [region(0, 4 * BAR), region(4 * BAR, 4 * BAR), region(10 * BAR, 4 * BAR)];
    expect(rollRegionSeam(lane, 0, 5 * BAR + PPQ, grains)).toEqual([
      region(0, 5 * BAR),
      region(5 * BAR, 3 * BAR),
      region(10 * BAR, 4 * BAR),
    ]);
    expect(rollRegionSeam(lane, 0, 0, grains)[0]).toEqual(region(0, BAR));
    expect(rollRegionSeam(lane, 0, LONG, grains)[1]).toEqual(region(7 * BAR, BAR));
    expect(rollRegionSeam(lane, 1, 9 * BAR, grains)).toEqual(lane);
  });

  it("rolls a pair shorter than two bars on the part's step, and not below two steps", () => {
    const pair = [region(0, BAR / 2), region(BAR / 2, BAR / 2)];
    expect(rollRegionSeam(pair, 0, PPQ / 3, grains)).toEqual([
      region(0, PPQ),
      region(PPQ, 3 * PPQ),
    ]);
    const tiny = [region(0, PPQ / 2), region(PPQ / 2, PPQ / 2)];
    expect(rollRegionSeam(tiny, 0, PPQ, grains)).toEqual(tiny);
  });

  it('never trims or rolls a region shorter than the grain smaller, but grows it on the grid', () => {
    const beat = [region(BAR, PPQ)];
    expect(resizeRegionEnd(beat, 0, BAR + PPQ / 2, LONG)).toEqual(beat);
    expect(resizeRegionEnd(beat, 0, 1.6 * BAR, LONG)).toEqual([region(BAR, BAR)]);
    expect(resizeRegionStart(beat, 0, BAR + PPQ)).toEqual(beat);
    expect(resizeRegionStart(beat, 0, 0.4 * BAR)).toEqual([region(0, BAR + PPQ)]);
    const pair = [region(0, PPQ), region(PPQ, 4 * BAR)];
    expect(rollRegionSeam(pair, 0, 0, grains)).toEqual(pair);
    expect(rollRegionSeam(pair, 0, BAR + 1, grains)[0]).toEqual(region(0, BAR));
  });

  it('draws from the press to the pointer either way, snapped outward to the grain', () => {
    expect(drawRegion([], BAR + PPQ, 3 * BAR + PPQ, LONG)).toEqual([region(BAR, 3 * BAR)]);
    expect(drawRegion([], 3 * BAR + PPQ, BAR + PPQ, LONG)).toEqual([region(BAR, 3 * BAR)]);
    expect(drawRegion([], 2 * BAR + PPQ, 2 * BAR + PPQ + 1, LONG)).toEqual([region(2 * BAR, BAR)]);
    expect(drawRegion([], BAR + PPQ, BAR + 2.5 * PPQ, LONG, PPQ)).toEqual([
      region(BAR + PPQ, 2 * PPQ),
    ]);
  });

  it('clamps a drawn region to its gap, a gap under a bar and the last gap to the song end', () => {
    const lane = [region(0, BAR), region(3 * BAR, BAR)];
    expect(drawRegion(lane, 1.5 * BAR, 10 * BAR, LONG)?.[1]).toEqual(region(BAR, 2 * BAR));
    expect(drawRegion(lane, 1.5 * BAR, -BAR, LONG)?.[1]).toEqual(region(BAR, BAR));
    expect(drawRegion(lane, 4 * BAR + PPQ, 99 * BAR, LONG)?.[2]).toEqual(region(4 * BAR, 12 * BAR));
    const narrow = [region(0, BAR), region(BAR + 2 * PPQ, BAR)];
    expect(drawRegion(narrow, BAR + PPQ, BAR + PPQ + 1, LONG)?.[1]).toEqual(region(BAR, 2 * PPQ));
    expect(drawRegion(lane, BAR / 2, 2 * BAR, LONG)).toBeNull();
    expect(drawRegion(lane, LONG, 2 * LONG, LONG)).toBeNull();
  });
});
