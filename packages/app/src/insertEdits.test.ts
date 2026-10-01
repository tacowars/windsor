/**
 * The insert list edits (#641) return whole lists, because a list in a
 * partial replaces the document's wholesale; the engine then decides between
 * a param write and a rebuild by comparing kinds. An added insert gets a
 * fresh id, and every other insert keeps its own (windsor#186).
 */
import { describe, expect, it } from 'vitest';

import type { InsertSpec } from '@windsor/engine';
import {
  DEFAULT_DRIVE,
  DEFAULT_ECHO,
  DEFAULT_PLATE_REVERB,
  INSERT_KINDS,
  INSERT_KIND_NAMES,
  MAX_INSERTS,
  createInsertIdSource,
  isInsertId,
  withInsertIds,
} from '@windsor/engine';
import { withoutInsertIds } from '@windsor/engine/__fixtures__/insertIds';
import { addInsert, canAddInsert, moveInsert, removeInsert, setInsertField } from './insertEdits';
import { addInsertAtFront } from './insertEdits';
import { groupKey } from './groupModel';

/** `list` without its ids: the settings alone. */
const bare = (list: readonly InsertSpec[]): unknown[] => withoutInsertIds([...list]);

describe('insert edits', () => {
  it('adds a fresh insert of the kind, and stops at the limit', () => {
    let list = addInsert([], 'drive');
    expect(bare(list)).toEqual([DEFAULT_DRIVE]);
    expect(list[0]).not.toBe(DEFAULT_DRIVE);
    while (canAddInsert(list)) list = addInsert(list, 'drive');
    expect(list).toHaveLength(MAX_INSERTS);
    expect(addInsert(list, 'drive')).toHaveLength(MAX_INSERTS);
  });

  it('gives each added insert a fresh id, unique in its chain, and keeps the others (windsor#186)', () => {
    let list = addInsert([], 'drive');
    while (canAddInsert(list)) list = addInsert(list, 'drive');
    const ids = list.map((spec) => spec.id);
    expect(ids.every(isInsertId)).toBe(true);
    expect(new Set(ids).size).toBe(MAX_INSERTS);
    const shorter = removeInsert(list, 2);
    expect(addInsert(shorter, 'chorus').slice(0, -1)).toEqual(shorter);
    expect(addInsertAtFront(shorter, 'chorus').slice(1)).toEqual(shorter);
  });

  it('draws the id from the source it is given, so a test can pin it', () => {
    const pinned = (): InsertSpec[] => addInsert([], 'drive', 0, createInsertIdSource(7));
    expect(pinned()[0]!.id).toBe(pinned()[0]!.id);
    expect(pinned()[0]!.id).toBe(createInsertIdSource(7).next());
    const clash = { next: (): string => 'taken' };
    expect(addInsert([{ ...DEFAULT_DRIVE, id: 'mine' }], 'drive', 0, clash)[1]!.id).toBe('taken');
  });

  it('fills the ids of a chain the code holds before adding to it', () => {
    const code = [DEFAULT_PLATE_REVERB];
    const next = addInsert(code, 'drive', 'a');
    expect(next[0]).toEqual(withInsertIds(code)[0]);
    expect(next[1]!.id).not.toBe(next[0]!.id);
  });

  it('starts a Plate reverb or an Echo at Mix 1.00 on a send bus, and at its default elsewhere (windsor#172)', () => {
    for (const bus of ['a', 'b'] as const) {
      expect(bare(addInsert([], 'plate', bus))).toEqual([{ ...DEFAULT_PLATE_REVERB, mix: 1 }]);
      expect(bare(addInsert([], 'echo', bus))).toEqual([{ ...DEFAULT_ECHO, mix: 1 }]);
      expect(bare(addInsert([], 'drive', bus))).toEqual([DEFAULT_DRIVE]);
    }
    for (const target of [0, 3, 'master', undefined] as const) {
      expect(bare(addInsert([], 'plate', target))).toEqual([DEFAULT_PLATE_REVERB]);
      expect(bare(addInsert([], 'echo', target))).toEqual([DEFAULT_ECHO]);
    }
    expect(DEFAULT_PLATE_REVERB.mix).toBe(0.3);
    expect(DEFAULT_ECHO.mix).toBe(0.3);
  });

  it('removes by index, leaving the others in order', () => {
    const a = { ...DEFAULT_DRIVE, drive: 3 };
    const b = { ...DEFAULT_DRIVE, drive: 9 };
    expect(removeInsert([a, b], 0)).toEqual([b]);
    expect(removeInsert([a, b], 5)).toEqual([a, b]);
  });

  it('moves an insert one place along the chain, and never off either end (#652)', () => {
    const a = { ...DEFAULT_DRIVE, drive: 3, id: 'a' };
    const b = { ...DEFAULT_DRIVE, drive: 9, id: 'b' };
    const list = [a, b];
    expect(moveInsert(list, 1, -1)).toEqual([b, a]);
    expect(moveInsert(list, 0, 1)).toEqual([b, a]);
    // The ends, and an index the list does not hold, leave the order alone.
    expect(moveInsert(list, 0, -1)).toEqual(list);
    expect(moveInsert(list, 1, 1)).toEqual(list);
    expect(moveInsert(list, 5, -1)).toEqual(list);
    expect(moveInsert(list, -1, 1)).toEqual(list);
    // The input list is never touched.
    expect(list).toEqual([a, b]);
    expect(moveInsert(list, 0, 1)).not.toBe(list);
  });

  it('sets one field on one insert, keeping its id, and leaves the input list alone', () => {
    const list = [DEFAULT_DRIVE, { ...DEFAULT_DRIVE, id: 'two' }];
    const next = setInsertField(list, 1, 'mix', 0.4);
    expect(next).toEqual([DEFAULT_DRIVE, { ...DEFAULT_DRIVE, id: 'two', mix: 0.4 }]);
    expect(list[1]).toEqual({ ...DEFAULT_DRIVE, id: 'two' });
    expect(setInsertField(list, 7, 'mix', 0.4)).toEqual(list);
  });
});

describe('addInsertAtFront (windsor#173)', () => {
  it("puts addInsert's fresh insert at index 0 and keeps the rest in order", () => {
    const a = { ...DEFAULT_DRIVE, drive: 3, id: 'a' };
    const b = { ...DEFAULT_DRIVE, drive: 9, id: 'b' };
    const list = [a, b];
    const next = addInsertAtFront(list, 'drive');
    expect(bare(next)).toEqual(bare([addInsert([], 'drive')[0]!, a, b]));
    expect(next.slice(1)).toEqual([a, b]);
    expect(next[0]).not.toBe(DEFAULT_DRIVE);
    expect(list).toEqual([a, b]);
  });

  it('starts every kind at its part defaults on a group, so a Plate reverb starts at Mix 0.30 (windsor#287)', () => {
    const target = groupKey(3);
    for (const kind of INSERT_KIND_NAMES) {
      expect(bare(addInsert([], kind, target))).toEqual([INSERT_KINDS[kind].defaults]);
      expect(bare(addInsertAtFront([], kind, target))).toEqual([INSERT_KINDS[kind].defaults]);
    }
    expect(bare(addInsert([], 'plate', target))).toEqual([DEFAULT_PLATE_REVERB]);
    expect(DEFAULT_PLATE_REVERB.mix).toBe(0.3);
  });

  it('adds the first insert to an empty chain, as addInsert does', () => {
    expect(addInsertAtFront([], 'drive', 0, createInsertIdSource(3))).toEqual(
      addInsert([], 'drive', 0, createInsertIdSource(3)),
    );
  });

  it('starts a Plate reverb or an Echo at Mix 1.00 at the front of a send bus (windsor#172)', () => {
    const drive = { ...DEFAULT_DRIVE, drive: 3, id: 'd' };
    for (const bus of ['a', 'b'] as const) {
      expect(bare(addInsertAtFront([drive], 'plate', bus))).toEqual(
        bare([{ ...DEFAULT_PLATE_REVERB, mix: 1 }, drive]),
      );
      expect(bare(addInsertAtFront([drive], 'echo', bus))[0]).toEqual({ ...DEFAULT_ECHO, mix: 1 });
    }
    for (const target of [0, 'master', undefined] as const)
      expect(bare(addInsertAtFront([drive], 'plate', target))[0]).toEqual(DEFAULT_PLATE_REVERB);
  });

  it('leaves a full chain as it was', () => {
    let list = addInsert([], 'drive');
    while (canAddInsert(list)) list = addInsert(list, 'drive');
    const full = list.map((spec, i) => ({ ...spec, mix: i / MAX_INSERTS }));
    expect(addInsertAtFront(full, 'chorus')).toEqual(full);
  });
});
