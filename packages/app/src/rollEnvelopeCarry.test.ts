/**
 * A roll's clip envelopes (windsor#701, epic windsor#699 decision 1) ride
 * along with every edit that rewrites the roll's notes or copies its
 * region: the notes edits, the device's write, a recorded take, a split, a
 * duplicate and an empty roll's loop following its region. None of them
 * reads the envelopes, so each must hand them on untouched.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, MusicPart, RollSequencerConfig } from '@windsor/engine';
import { DIVISORS, TICKS_PER_BAR, partAt, songTicksOf } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { regionPatternChange, sequencerKindChange, splitPartRegion } from './partEdits';
import { duplicateRegion } from './regionClipboard';
import { deleteNotes, moveNotes, setLoop } from './rollEdits';
import { quantiseNotes } from './rollQuantise';
import { fitEmptyRoll } from './rollRegionFit';
import { takeWriteChange } from './rollRecWrite';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const ENVELOPES = [
  {
    target: 'filter.cutoff',
    on: true,
    points: [
      { tick: 0, value: -0.5, bend: 0.25 },
      { tick: BAR, value: 0.5, bend: 0 },
    ],
  },
  { target: 'macros.2.value', on: false, points: [] },
] as const;
const FIRST = { tick: 1, ticks: DIVISORS.sixteenth, pitch: 60 };
const NOTES = [FIRST, { tick: BAR, ticks: DIVISORS.sixteenth, pitch: 64 }];
const ROLL = { kind: 'roll', loopTicks: 2 * BAR, notes: NOTES, envelopes: ENVELOPES };

const part0 = (doc: ArrangementDocument): MusicPart => {
  const part = partAt(doc, 0);
  if (!part) throw new Error('part 0 is gone');
  return part;
};

/** A song whose part 0 is a Roll, its sequencer and its one region's pattern each carrying `ROLL`. */
function rollSong(): DocumentModel {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, 'roll', (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  model.merge({ transport: { bars: 8 } });
  model.merge({
    parts: { 0: { sequencer: ROLL, regions: [{ start: 0, duration: 2 * BAR, pattern: ROLL }] } },
  });
  return model;
}

const envelopesOf = (pattern: unknown): unknown => (pattern as RollSequencerConfig).envelopes;

describe("a roll's envelopes ride along with its edits (windsor#701)", () => {
  it('keeps them through the notes edits, pitch-only included', () => {
    const config = ROLL as unknown as RollSequencerConfig;
    const frame = { loop: 2 * BAR, region: 2 * BAR, snap: DIVISORS.sixteenth };
    const up = moveNotes(config, [0], { dTicks: 0, dRows: 1 }, { ...frame, rows: [60, 61, 64] });
    expect(up.config.notes[0]?.pitch).toBe(61);
    const edits = [
      up.config,
      deleteNotes(config, [0]).config,
      setLoop(config, BAR),
      quantiseNotes(config, [], frame)?.config,
    ];
    for (const edited of edits) expect(edited?.envelopes).toBe(ENVELOPES);
  });

  it("keeps them through the device's write and a recorded take, on a region and the part", () => {
    const model = rollSong();
    const written = regionPatternChange(model.doc, 0, 0, { loopTicks: BAR, notes: [] });
    if (written) model.merge(written);
    expect(part0(model.doc).regions[0]?.pattern).toMatchObject({ loopTicks: BAR, notes: [] });
    const onPart = regionPatternChange(model.doc, 0, undefined, { notes: [] });
    if (onPart) model.merge(onPart);
    const take = takeWriteChange(model.doc, 0, [{ regionIndex: 0, notes: [FIRST] }]);
    if (take) model.merge(take);
    const part = part0(model.doc);
    expect(part.regions[0]?.pattern).toMatchObject({ notes: [FIRST] });
    expect(envelopesOf(part.regions[0]?.pattern)).toEqual(ENVELOPES);
    expect(envelopesOf(part.sequencer)).toEqual(ENVELOPES);
  });

  it("copies them into both halves of a split, a duplicate, and an empty roll's fitted loop", () => {
    const model = rollSong();
    const part = part0(model.doc);
    const halves = splitPartRegion(part, 0, BAR, false);
    expect(halves?.map((r) => envelopesOf(r.pattern))).toEqual([ENVELOPES, ENVELOPES]);
    const placed = duplicateRegion(part, 0, songTicksOf(model.doc));
    expect(envelopesOf(placed?.regions[placed.index]?.pattern)).toEqual(ENVELOPES);
    const empty = { kind: 'roll' as const, loopTicks: BAR, notes: [], envelopes: ENVELOPES };
    const fitted = fitEmptyRoll({ start: 0, duration: 3 * BAR, pattern: empty } as never);
    expect(fitted.pattern).toMatchObject({ loopTicks: 3 * BAR, envelopes: ENVELOPES });
  });
});
