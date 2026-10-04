/**
 * An empty roll's loop follows its region's length (windsor#608): an empty
 * roll on a resized region takes the new length up to the cap; a roll with
 * notes, a region with no pattern and another kind's pattern stay as they
 * were; a split fits both halves, and the song-length follow fits an ∞ region.
 */
import { describe, expect, it } from 'vitest';

import type { DocumentPartial, PartRegion, RollSpec } from '@windsor/engine';
import { DEFAULT_GRID_CONFIG, ROLL_LOOP_TICKS_MAX, TICKS_PER_BAR, partAt } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { splitPartRegion } from './partEdits';
import { followSongLength } from './regionModel';
import { fitEmptyRolls, fitFollowedRolls } from './rollRegionFit';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const NOTE = { tick: 0, ticks: BAR / 4, pitch: 60 };

const roll = (loopTicks: number, notes: RollSpec['notes'] = []): RollSpec => ({
  kind: 'roll',
  loopTicks,
  notes,
});
const loopOf = (region: PartRegion | undefined): number | undefined =>
  region?.pattern?.kind === 'roll' ? region.pattern.loopTicks : undefined;

describe('fitEmptyRolls', () => {
  it("fits an empty roll's loop to its trimmed region, and back", () => {
    const before = [{ start: 0, duration: BAR, pattern: roll(BAR) }];
    const longer = fitEmptyRolls([{ ...before[0]!, duration: 3 * BAR }], before);
    expect(loopOf(longer[0])).toBe(3 * BAR);
    const shorter = fitEmptyRolls([{ ...longer[0]!, duration: 2 * BAR }], longer);
    expect(loopOf(shorter[0])).toBe(2 * BAR);
  });

  it('leaves a roll with notes, a region with no pattern and a Grid alone', () => {
    const grid = { ...DEFAULT_GRID_CONFIG, kind: 'grid' } as NonNullable<PartRegion['pattern']>;
    const before: PartRegion[] = [
      { start: 0, duration: BAR, pattern: roll(BAR, [NOTE]) },
      { start: BAR, duration: BAR },
      { start: 2 * BAR, duration: BAR, pattern: grid },
    ];
    const edited = before.map((r) => ({ ...r, duration: r.duration * 2 }));
    expect(fitEmptyRolls(edited, before)).toEqual(edited);
  });

  it('caps the loop at ROLL_LOOP_TICKS_MAX', () => {
    const before = [{ start: 0, duration: BAR, pattern: roll(BAR) }];
    const long = [{ ...before[0]!, duration: ROLL_LOOP_TICKS_MAX + 4 * BAR }];
    expect(loopOf(fitEmptyRolls(long, before)[0])).toBe(ROLL_LOOP_TICKS_MAX);
  });

  it("leaves a region whose length didn't change: a body move keeps its loop", () => {
    const before = [{ start: 0, duration: 4 * BAR, pattern: roll(BAR) }];
    const moved = [{ ...before[0]!, start: 2 * BAR }];
    expect(fitEmptyRolls(moved, before)).toEqual(moved);
  });

  it('fits both empty rolls of a seam roll', () => {
    const before = [
      { start: 0, duration: 2 * BAR, pattern: roll(2 * BAR) },
      { start: 2 * BAR, duration: 2 * BAR, pattern: roll(2 * BAR) },
    ];
    const rolled = [
      { ...before[0]!, duration: 3 * BAR },
      { ...before[1]!, start: 3 * BAR, duration: BAR },
    ];
    expect(fitEmptyRolls(rolled, before).map(loopOf)).toEqual([3 * BAR, BAR]);
  });
});

describe('a split and the song-length follow fit empty rolls', () => {
  it('splits an empty 4-bar roll into two 2-bar loops, and copies a loop with notes', () => {
    const part = (pattern: RollSpec) => ({
      regions: [{ start: 0, duration: 4 * BAR, pattern }],
      sequencer: roll(BAR),
    });
    const empty = splitPartRegion(part(roll(4 * BAR)), 0, 2 * BAR, false);
    expect(empty?.map(loopOf)).toEqual([2 * BAR, 2 * BAR]);
    const noted = splitPartRegion(part(roll(4 * BAR, [NOTE])), 0, 2 * BAR, false);
    expect(noted?.map(loopOf)).toEqual([4 * BAR, 4 * BAR]);
  });

  it('gives an empty roll on an ∞ region an 8-bar loop when the song goes from 4 to 8 bars', () => {
    const model = new DocumentModel(newSong());
    model.merge({ transport: { bars: 4 } });
    const region = { start: 0, duration: 4 * BAR, pattern: roll(4 * BAR) };
    model.merge({
      parts: { 0: { sequencer: roll(BAR), regions: [region] } },
    } as unknown as DocumentPartial);
    const edit: DocumentPartial = { transport: { bars: 8 } } as DocumentPartial;
    const followed = followSongLength(model.doc, edit).partial;
    const fitted = fitFollowedRolls(model.doc, edit, followed);
    const regions = fitted.parts?.[0]?.regions;
    expect(regions?.[0]?.duration).toBe(8 * BAR);
    expect(loopOf(regions?.[0])).toBe(8 * BAR);
    expect(loopOf(partAt(model.doc, 0)?.regions[0])).toBe(4 * BAR);
  });
});
