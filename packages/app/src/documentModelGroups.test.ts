/**
 * The console's document state merges the group list by id (windsor#284),
 * as it merges the part list by slot: a fragment edits one group, `null`
 * removes it, a whole group at a free id is appended, and the list keeps its
 * order. Beside `documentModel.test.ts`, which is at its line limit.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION, partAt } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { loadBuiltIns } from './builtInLibrary';

beforeAll(() => loadBuiltIns());

const WHOLE = [{ start: 0, duration: 4 * 96 }];

const SONG = {
  version: ARRANGEMENT_VERSION,
  transport: { bpm: 96, bars: 4 },
  harmony: { root: 2, scale: 'dorian' },
  parts: [
    {
      slot: 0,
      name: 'kick',
      preset: 'kick',
      regions: WHOLE,
      sequencer: { kind: 'none' },
      strip: { output: { group: 3 } },
    },
    { slot: 2, name: 'arp', preset: 'saw-arp', regions: WHOLE, sequencer: { kind: 'none' } },
  ],
};

describe('an id-addressed group merge (windsor#284)', () => {
  const group = (id: number, name: string) => ({ id, name, level: 1, pan: 0, inserts: [] });
  const grouped = () => {
    const model = new DocumentModel({ ...SONG, groups: [group(3, 'Drums'), group(1, 'Keys')] });
    expect(model.corrections).toEqual([]);
    return model;
  };
  const ids = (model: DocumentModel) => model.doc.groups?.map((g) => g.id);

  it('edits one group by id and keeps the rest and their members', () => {
    const model = grouped();
    model.merge({ groups: { 3: { mute: true } } });
    expect(model.doc.groups).toEqual([{ ...group(3, 'Drums'), mute: true }, group(1, 'Keys')]);
    expect(partAt(model.doc, 0)?.strip.output).toEqual({ group: 3 });
    expect(model.corrections).toEqual([]);
  });

  it('removes a group at null, leaving groups absent once the last goes', () => {
    const model = grouped();
    model.merge({ groups: { 1: null } });
    expect(ids(model)).toEqual([3]);
    model.merge({ groups: { 3: null, 8: { level: 0.5 } } });
    expect(model.doc.groups).toBeUndefined();
  });

  it('appends a whole group at a free id, and edits parts and groups together', () => {
    const model = grouped();
    model.merge({
      groups: { 6: group(6, 'Pads'), 1: { pan: -0.5 } },
      parts: { 2: { velocity: 0.4 } },
    });
    expect(ids(model)).toEqual([3, 1, 6]);
    expect(model.doc.groups?.[1]?.pan).toBe(-0.5);
    expect(partAt(model.doc, 2)?.velocity).toBe(0.4);
    expect(partAt(model.doc, 0)?.strip.output).toEqual({ group: 3 });
  });
});
