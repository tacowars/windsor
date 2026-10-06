/**
 * The Song tab's part lane folds (`openParts`, by slot) follow the
 * document, as the group folds do (windsor#620): another song, or a new
 * part on a removed part's slot, starts with its lanes folded.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION, removePartChange } from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import { DocumentModel } from './documentModel';
import { addPartChange } from './partEdits';
import { followGroupFolds } from './songFolderModel';

beforeAll(() => loadBuiltIns());

const WHOLE = [{ start: 0, duration: 4 * 96 }];

const part = (slot: number, name: string) => ({
  slot,
  name,
  preset: 'kick',
  regions: WHOLE,
  sequencer: { kind: 'none' },
});

const SONG = {
  version: ARRANGEMENT_VERSION,
  transport: { bpm: 96, bars: 4 },
  parts: [part(0, 'kick'), part(1, 'snare'), part(2, 'hat')],
};

/** A model whose part folds `open` follow it, with the given slots open. */
function following(slots: number[]): { model: DocumentModel; open: Set<number> } {
  const model = new DocumentModel(SONG);
  const open = new Set(slots);
  followGroupFolds(model, [], [open]);
  return { model, open };
}

/** Remove the part on `slot` by a merge, as the Remove button does. */
function removePart(model: DocumentModel, slot: number): void {
  const partial = removePartChange(model.doc, slot);
  if (partial) model.merge(partial);
  expect(model.doc.parts.map((p) => p.slot)).not.toContain(slot);
}

describe('the part lane folds follow the document (windsor#620)', () => {
  it('opening another song folds every part, even at a shared slot', () => {
    const { model, open } = following([0]);
    model.open({ ...SONG, parts: [part(0, 'bass')] });
    expect(model.doc.parts.map((p) => p.slot)).toEqual([0]);
    expect([...open]).toEqual([]);
  });

  it('a removed part’s slot leaves the set, and a new part there starts folded', () => {
    const { model, open } = following([0, 2]);
    removePart(model, 2);
    expect([...open]).toEqual([0]);
    const added = addPartChange(model.doc, (raw) => model.preview(raw));
    expect(added?.slot).toBe(2);
    if (added) model.merge(added.partial);
    expect(model.doc.parts.map((p) => p.slot)).toContain(2);
    expect([...open]).toEqual([0]);
  });

  it('keeps a part’s fold through a rename or a region edit', () => {
    const { model, open } = following([1]);
    model.merge({ parts: { 1: { name: 'clap' } } });
    model.merge({ parts: { 1: { regions: [{ start: 0, duration: 96 }] } } });
    expect(model.doc.parts.find((p) => p.slot === 1)?.name).toBe('clap');
    expect([...open]).toEqual([1]);
  });

  it('an undone removal brings the part back folded', () => {
    const { model, open } = following([2]);
    const before = model.doc;
    removePart(model, 2);
    model.replace(before);
    expect(model.doc.parts.map((p) => p.slot)).toContain(2);
    expect([...open]).toEqual([]);
  });
});
