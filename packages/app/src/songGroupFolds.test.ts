/**
 * The Song tab's per-group folds (windsor#615's members, windsor#616's
 * lanes) follow the document, not the tab's repaints: a group removed and
 * another added at its id while the tab is hidden (on the Mixer tab) starts
 * at the defaults, members shown and lanes folded.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import { DocumentModel } from './documentModel';
import { addGroupChange, removeGroupChange } from './groupModel';
import { followGroupFolds } from './songFolderModel';

beforeAll(() => loadBuiltIns());

const WHOLE = [{ start: 0, duration: 4 * 96 }];

const group = (id: number, name: string) => ({ id, name, level: 1, pan: 0, inserts: [] });

const SONG = {
  version: ARRANGEMENT_VERSION,
  transport: { bpm: 96, bars: 4 },
  parts: [
    {
      slot: 0,
      name: 'kick',
      preset: 'kick',
      regions: WHOLE,
      sequencer: { kind: 'none' },
      strip: { output: { group: 0 } },
    },
  ],
  groups: [group(0, 'Drums'), group(1, 'Keys')],
};

/** Remove group 0 and add a group, which takes id 0 again, with no repaint between. */
function removeThenAdd(model: DocumentModel): void {
  const removed = removeGroupChange(model.doc, 0);
  if (removed) model.merge(removed);
  expect(model.doc.groups?.map((g) => g.id)).toEqual([1]);
  const added = addGroupChange(model.doc);
  if (added) model.merge(added);
  expect(model.doc.groups?.map((g) => g.id).sort()).toEqual([0, 1]);
}

describe('the group folds follow the document (windsor#616)', () => {
  it('a group reusing a removed group’s id starts with members shown and lanes folded', () => {
    const model = new DocumentModel(SONG);
    const closed = new Set([0, 1]);
    const open = new Set([0, 1]);
    followGroupFolds(model, [closed, open]);
    removeThenAdd(model);
    expect([...closed]).toEqual([1]);
    expect([...open]).toEqual([1]);
  });

  it('keeps a remaining group’s folds through other edits', () => {
    const model = new DocumentModel(SONG);
    const open = new Set([0, 1]);
    followGroupFolds(model, [open]);
    model.merge({ groups: { 1: { name: 'Pads' } } });
    expect([...open]).toEqual([0, 1]);
  });

  it('opening another song resets every group’s folds, even at a shared id', () => {
    const model = new DocumentModel(SONG);
    const closed = new Set([0]);
    const open = new Set([0]);
    followGroupFolds(model, [closed, open]);
    model.open({ ...SONG, groups: [group(0, 'Strings')] });
    expect(model.doc.groups?.map((g) => g.id)).toEqual([0]);
    expect([...closed]).toEqual([]);
    expect([...open]).toEqual([]);
    closed.add(0);
    open.add(0);
    model.merge({ groups: { 0: { name: 'Brass' } } });
    expect([...closed]).toEqual([0]);
    expect([...open]).toEqual([0]);
  });

  it('stops following once unsubscribed', () => {
    const model = new DocumentModel(SONG);
    const open = new Set([0]);
    followGroupFolds(model, [open])();
    removeThenAdd(model);
    expect([...open]).toEqual([0]);
  });
});
