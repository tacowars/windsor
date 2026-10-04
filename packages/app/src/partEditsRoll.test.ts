/**
 * A Roll part's regions (windsor#601, epic windsor#596): set from one ∞
 * region, the part has none, through one live partial; its first drawn
 * region gets an empty roll as long as the region, capped at
 * `ROLL_LOOP_TICKS_MAX`; a region drawn beside another and both halves of a
 * split copy that region's roll, notes and loop.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, Meter, MusicPart } from '@windsor/engine';
import {
  BARS_MAX,
  DIVISORS,
  ROLL_LOOP_TICKS_MAX,
  TICKS_PER_BAR,
  partAt,
  ticksPerBar,
} from '@windsor/engine';
import { DocumentModel } from './documentModel';
import {
  drawRegionChange,
  drawStrokeChange,
  sequencerKindChange,
  splitPartRegion,
} from './partEdits';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;

const part0 = (doc: ArrangementDocument): MusicPart => {
  const part = partAt(doc, 0);
  if (!part) throw new Error('part 0 is gone');
  return part;
};

describe('a Roll part draws its first region and each region keeps its own roll (windsor#601)', () => {
  /** A new song in `meter`, its part 0 set to Roll through the live kind change. */
  function rollSong(meter?: Meter, bars = 8): DocumentModel {
    const model = new DocumentModel(newSong(meter));
    const before = part0(model.doc);
    const partial = sequencerKindChange(model.doc, 0, 'roll', (raw) => model.preview(raw));
    // One partial carries the cleared region and the new sequencer: one undo step takes back both.
    expect(partial?.parts?.[0]).toMatchObject({ regions: [], sequencer: { kind: 'roll' } });
    expect(before.regions).toHaveLength(1);
    if (partial) model.merge(partial);
    expect(part0(model.doc).regions).toEqual([]);
    model.merge({ transport: { bars } });
    return model;
  }

  it("gives a drawn first region an empty roll over the region's length, in the song's meter", () => {
    const model = rollSong('7/8');
    const bar = ticksPerBar('7/8');
    const preview = (raw: unknown): ArrangementDocument => model.preview(raw);
    const stroke = { from: 0, to: 3 * bar - 1, modifier: false };
    const drawn = drawStrokeChange(model.doc, 0, stroke, preview);
    expect(drawn?.regions[0]).toMatchObject({ start: 0, duration: 3 * bar });
    expect(drawn?.regions[0]?.pattern).toEqual({ kind: 'roll', loopTicks: 3 * bar, notes: [] });
    const clicked = drawRegionChange(model.doc, 0, 0, preview);
    expect(clicked?.regions[0]?.pattern).toMatchObject({ loopTicks: bar });
  });

  it('caps a first loop longer than the roll allows at ROLL_LOOP_TICKS_MAX', () => {
    const model = rollSong('5/4', BARS_MAX);
    const whole = { from: 0, to: BARS_MAX * ticksPerBar('5/4') - 1, modifier: false };
    const drawn = drawStrokeChange(model.doc, 0, whole, (raw) => model.preview(raw));
    expect(drawn?.regions[0]?.duration).toBeGreaterThan(ROLL_LOOP_TICKS_MAX);
    expect(drawn?.regions[0]?.pattern).toMatchObject({ loopTicks: ROLL_LOOP_TICKS_MAX });
  });

  it('copies a neighbour roll, notes and loop, into a drawn region and both halves of a split', () => {
    const model = rollSong();
    const notes = [{ tick: 0, ticks: DIVISORS.sixteenth, pitch: 60 }];
    const pattern = { kind: 'roll', loopTicks: 2 * BAR, notes };
    model.merge({ parts: { 0: { regions: [{ start: 0, duration: 2 * BAR, pattern }] } } });
    const preview = (raw: unknown): ArrangementDocument => model.preview(raw);
    const beside = drawRegionChange(model.doc, 0, 3 * BAR, preview);
    expect(beside?.regions[1]?.pattern).toEqual(part0(model.doc).regions[0]?.pattern);
    expect(beside?.regions[1]?.pattern).toMatchObject({ loopTicks: 2 * BAR, notes });
    const halves = splitPartRegion(part0(model.doc), 0, BAR, false);
    expect(halves?.[0]?.pattern).toMatchObject({ loopTicks: 2 * BAR, notes });
    expect(halves?.[1]?.pattern).toEqual(halves?.[0]?.pattern);
  });
});
