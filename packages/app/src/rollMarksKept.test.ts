/**
 * Every Roll edit keeps a note's accent and ratchet (windsor#754, from
 * Codex's P1 on windsor#756): a velocity drag, a move, a resize, a delete
 * of another note, the write's settle, Quantise, a take merged in and
 * written, a knob on the roll, and a region copied, pasted or duplicated.
 * An edit that rebuilt a note field by field would drop both.
 */
import type { ArrangementDocument, RollNote, RollSequencerConfig } from '@windsor/engine';
import { TICKS_PER_BAR, partAt, regionPattern } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { DocumentModel } from './documentModel';
import { regionPatternChange } from './partEdits';
import { copyRegion, duplicateRegion, pasteRegion } from './regionClipboard';
import { deleteNotes, moveNotes, resizeNotes, setVelocity, settle } from './rollEdits';
import { quantiseNotes } from './rollQuantise';
import { takeWriteChange } from './rollRecWrite';
import { mergeTake } from './rollTake';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const FRAME = { loop: BAR, region: BAR, snap: 6 };
/** A marked note, then a plain one. */
const MARKED: RollNote = {
  tick: 12,
  ticks: 12,
  pitch: 60,
  velocity: 0.7,
  accent: true,
  ratchet: 3,
};
const PLAIN: RollNote = { tick: 48, ticks: 6, pitch: 64 };
const ROLL: RollSequencerConfig = { loopTicks: BAR, notes: [MARKED, PLAIN] };

const marksOf = (note: RollNote | undefined): unknown => ({
  accent: note?.accent,
  ratchet: note?.ratchet,
});
const KEPT = { accent: true, ratchet: 3 };

/** A one-part song whose one region plays `ROLL`. */
function song(): ArrangementDocument {
  const raw = newSong();
  const part = {
    ...(raw.parts as Record<string, unknown>[])[0],
    slot: 0,
    sequencer: { kind: 'roll', loopTicks: BAR, notes: [] },
    regions: [{ start: 0, duration: BAR, pattern: { kind: 'roll', ...ROLL } }],
  };
  const transport = { ...(raw.transport as object), bars: 4 };
  return new DocumentModel({ ...raw, transport, parts: [part] }).doc;
}

/** Region `index`'s notes in `doc`. */
function notesIn(doc: ArrangementDocument, index = 0): readonly RollNote[] {
  const part = partAt(doc, 0);
  const pattern = part ? regionPattern(part, index) : undefined;
  return pattern?.kind === 'roll' ? pattern.notes : [];
}

describe('the roll’s edits keep a note’s accent and ratchet', () => {
  it('a velocity drag', () => {
    const notes = setVelocity(ROLL, [0], 0.4).notes;
    expect(notes[0]).toEqual({ ...MARKED, velocity: 0.4 });
    expect(setVelocity(ROLL, [0], 1).notes[0]).toEqual({
      tick: 12,
      ticks: 12,
      pitch: 60,
      accent: true,
      ratchet: 3,
    });
  });

  it('a move', () => {
    const edit = moveNotes(ROLL, [0], { dTicks: 6, dRows: -1 }, { ...FRAME, rows: [61, 60] });
    expect(edit.config.notes[0]).toMatchObject({ tick: 18, pitch: 61, ...KEPT });
  });

  it('a resize', () => {
    const { edit } = resizeNotes(ROLL, [0], 6, { ...FRAME, anchor: 0 });
    expect(edit.config.notes[0]).toMatchObject({ ticks: 18, ...KEPT });
  });

  it('a delete of another note', () => {
    expect(marksOf(deleteNotes(ROLL, [1]).config.notes[0])).toEqual(KEPT);
  });

  it('the settle a write goes through, trimming a note that runs into the next', () => {
    const over: RollSequencerConfig = {
      ...ROLL,
      notes: [MARKED, { ...PLAIN, tick: 18, pitch: 60 }],
    };
    const settled = settle({ config: over, selected: [] }).config.notes[0];
    expect(settled).toMatchObject({ ticks: 6, ...KEPT });
  });

  it('Quantise', () => {
    const off: RollSequencerConfig = { ...ROLL, notes: [{ ...MARKED, tick: 13 }, PLAIN] };
    expect(quantiseNotes(off, [], FRAME)?.config.notes[0]).toMatchObject({ tick: 12, ...KEPT });
  });

  it('a recorded take merged in beside it', () => {
    const merged = mergeTake(ROLL, [{ tick: 0, ticks: 6, pitch: 67 }]).config.notes;
    expect(marksOf(merged.find((note) => note.pitch === 60))).toEqual(KEPT);
  });
});

describe('the song keeps a note’s accent and ratchet', () => {
  it('as the document is normalised', () => {
    expect(marksOf(notesIn(song())[0])).toEqual(KEPT);
  });

  it('through a take written into the region', () => {
    const doc = song();
    const partial = takeWriteChange(doc, 0, [
      { regionIndex: 0, notes: [{ tick: 0, ticks: 6, pitch: 67 }] },
    ]);
    const model = new DocumentModel(doc);
    model.merge(partial);
    expect(marksOf(notesIn(model.doc).find((note) => note.pitch === 60))).toEqual(KEPT);
  });

  it('through a knob on the roll', () => {
    const doc = song();
    const model = new DocumentModel(doc);
    model.merge(regionPatternChange(doc, 0, 0, { accentVelocity: 0.5 }));
    const part = partAt(model.doc, 0);
    const pattern = part ? regionPattern(part, 0) : undefined;
    expect(pattern).toMatchObject({ kind: 'roll', accentVelocity: 0.5 });
    expect(marksOf(notesIn(model.doc)[0])).toEqual(KEPT);
  });

  it('through a region copied and pasted, or duplicated', () => {
    const part = partAt(song(), 0);
    if (!part) throw new Error('no part');
    const clip = copyRegion(part, 0);
    expect(clip?.pattern?.kind === 'roll' && marksOf(clip.pattern.notes[0])).toEqual(KEPT);
    const pasted = clip ? pasteRegion(part, clip, 2 * BAR, 4 * BAR) : null;
    const landed = pasted && 'regions' in pasted ? pasted.regions[pasted.index] : undefined;
    expect(landed?.pattern?.kind === 'roll' && marksOf(landed.pattern.notes[0])).toEqual(KEPT);
    const dup = duplicateRegion(part, 0, 4 * BAR);
    const copy = dup?.regions[dup.index];
    expect(copy?.pattern?.kind === 'roll' && marksOf(copy.pattern.notes[0])).toEqual(KEPT);
  });
});
