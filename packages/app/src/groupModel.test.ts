/**
 * The Groups section's rules (windsor#287; record `2026-10-01-group-buses`
 * decisions 2, 3, 6 and 7): Add group names and numbers the next group,
 * a rename, a route and Remove are each one undo step, Remove sends the
 * members back to Master, and undo walks every step back.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ArrangementDocument } from '@windsor/engine';
import { ARRANGEMENT_VERSION, DEFAULT_GROUP, MAX_GROUPS, partAt } from '@windsor/engine';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import { loadBuiltIns } from './builtInLibrary';
import { settleGestures } from './gestureHooks';
import {
  GROUPS_FULL_TITLE,
  NO_MEMBERS,
  addGroup,
  addGroupChange,
  canAddGroup,
  groupIdOfKey,
  groupKey,
  groupMembers,
  groupSwitchLabel,
  groupsOf,
  memberSlots,
  membersLine,
  nextGroupId,
  nextGroupName,
  outputOfValue,
  outputValue,
  removeGroup,
  removeGroupChange,
  renameGroup,
  renameGroupChange,
  toggleGroupSwitch,
} from './groupModel';
import { insertChange, insertsOf, isBusTarget, isGroupTarget } from './insertTarget';
import { addInsert } from './insertEdits';
import { setStripOutput } from './songMixerModel';

beforeAll(() => loadBuiltIns());
afterEach(() => settleGestures());

const WHOLE = [{ start: 0, duration: 4 * 96 }];
const part = (slot: number, name: string, preset: string) => ({
  slot,
  name,
  preset,
  regions: WHOLE,
  sequencer: { kind: 'none' },
});

/** Hats at slot 4, Kick at 0 and Snare at 1: listed out of slot order on purpose. */
const SONG = {
  version: ARRANGEMENT_VERSION,
  transport: { bpm: 96, bars: 4 },
  harmony: { root: 2, scale: 'dorian' },
  parts: [part(4, 'Hats', 'kick'), part(0, 'Kick', 'kick'), part(1, 'Snare', 'kick')],
};

const group = (id: number, name: string) => ({ id, name, ...DEFAULT_GROUP });
const open = (groups: unknown[] = []) => openGestureConsole({ ...SONG, groups });
const outputAt = (doc: ArrangementDocument, slot: number) => partAt(doc, slot)?.strip.output;

describe('the next group', () => {
  it('is named at the lowest free number and numbered one past the largest id', () => {
    const ctx = open();
    expect(nextGroupName(ctx.model.doc)).toBe('Group 1');
    expect(nextGroupId(ctx.model.doc)).toBe(1);
    const gapped = open([group(7, 'Group 2'), group(2, 'Drums'), group(3, 'Group 1')]);
    expect(nextGroupName(gapped.model.doc)).toBe('Group 3');
    expect(nextGroupId(gapped.model.doc)).toBe(8);
  });

  it('is appended at the defaults, and refused once the song holds MAX_GROUPS', () => {
    const ctx = open([group(4, 'Drums')]);
    expect(addGroupChange(ctx.model.doc)).toEqual({ groups: { 5: group(5, 'Group 1') } });
    while (canAddGroup(ctx.model.doc)) expect(addGroup(ctx)).toBe(true);
    expect(groupsOf(ctx.model.doc)).toHaveLength(MAX_GROUPS);
    expect(addGroupChange(ctx.model.doc)).toBeNull();
    expect(addGroup(ctx)).toBe(false);
    expect(GROUPS_FULL_TITLE).toBe('A song can have 8 groups');
  });
});

describe('a group’s key', () => {
  it('encodes a group so it never reads as master, sidechain, a slot or a bus', () => {
    expect(groupKey(3)).toBe('group:3');
    expect(groupIdOfKey('group:3')).toBe(3);
    for (const key of ['master', 'sidechain', '3', 'a', 'group:', 'group:-1', 'group:1.5']) {
      expect(groupIdOfKey(key)).toBeNull();
    }
  });

  it('round-trips every Output through the select’s value', () => {
    for (const output of ['master', 'sidechain', { group: 0 }, { group: 12 }] as const) {
      expect(outputOfValue(outputValue(output))).toEqual(output);
    }
    expect(outputOfValue('junk')).toBe('master');
  });
});

describe('the members line', () => {
  it('lists the parts routed to the group in slot order', () => {
    const ctx = open([group(1, 'Drums'), group(2, 'Keys')]);
    for (const slot of [4, 1, 0]) setStripOutput(ctx, slot, { group: 1 });
    expect(memberSlots(ctx.model.doc, 1)).toEqual([0, 1, 4]);
    expect(membersLine(groupMembers(ctx.model.doc, 1))).toBe('Kick, Snare, Hats');
    expect(membersLine(groupMembers(ctx.model.doc, 2))).toBe(NO_MEMBERS);
    expect(NO_MEMBERS).toBe('No part plays here yet');
  });
});

describe('a rename', () => {
  it('is trimmed, and an empty or unchanged name changes nothing', () => {
    const ctx = open([group(1, 'Group 1')]);
    expect(renameGroupChange(ctx.model.doc, 1, '  Drums ')).toEqual({
      groups: { 1: { name: 'Drums' } },
    });
    expect(renameGroupChange(ctx.model.doc, 1, '   ')).toBeNull();
    expect(renameGroupChange(ctx.model.doc, 1, 'Group 1')).toBeNull();
    expect(renameGroupChange(ctx.model.doc, 9, 'Drums')).toBeNull();
    const label = ctx.undoLabel;
    expect(renameGroup(ctx, 1, '')).toBe(false);
    expect(ctx.undoLabel).toBe(label);
  });
});

describe('Remove', () => {
  it('sends every member to Master and removes the group in one partial', () => {
    const ctx = open([group(1, 'Drums'), group(2, 'Keys')]);
    setStripOutput(ctx, 0, { group: 1 });
    setStripOutput(ctx, 4, { group: 1 });
    setStripOutput(ctx, 1, { group: 2 });
    expect(removeGroupChange(ctx.model.doc, 1)).toEqual({
      groups: { 1: null },
      parts: { 0: { strip: { output: 'master' } }, 4: { strip: { output: 'master' } } },
    });
    expect(removeGroupChange(ctx.model.doc, 9)).toBeNull();
  });

  it('is one undo step, and one undo brings the group and the routing back', () => {
    const ctx = open([group(1, 'Drums')]);
    setStripOutput(ctx, 0, { group: 1 });
    setStripOutput(ctx, 1, { group: 1 });
    const before = ctx.model.doc;
    expect(removeGroup(ctx, 1)).toBe(true);
    expect(ctx.undoLabel).toBe('Remove Drums');
    expect(ctx.model.doc.groups).toBeUndefined();
    expect(outputAt(ctx.model.doc, 0)).toBe('master');
    expect(outputAt(ctx.model.doc, 1)).toBe('master');
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc).toEqual(before);
  });
});

describe('a drum bus, step by step', () => {
  it('makes each step one undo, and undo walks every step back', () => {
    const ctx = open();
    const start = ctx.model.doc;
    expect(addGroup(ctx)).toBe(true);
    expect(ctx.undoLabel).toBe('Add Group 1');
    expect(renameGroup(ctx, 1, 'Drums')).toBe(true);
    expect(setStripOutput(ctx, 0, { group: 1 })).toBe(true);
    expect(setStripOutput(ctx, 1, { group: 1 })).toBe(true);
    expect(toggleGroupSwitch(ctx, 1, 'mute')).toBe(true);
    expect(ctx.undoLabel).toBe(groupSwitchLabel('mute', 'Drums'));
    expect(ctx.model.doc.groups).toEqual([{ ...group(1, 'Drums'), mute: true }]);
    expect(groupMembers(ctx.model.doc, 1)).toEqual(['Kick', 'Snare']);
    const steps = [
      (doc: ArrangementDocument) => doc.groups?.[0]?.mute === undefined,
      (doc: ArrangementDocument) => outputAt(doc, 1) === undefined,
      (doc: ArrangementDocument) => outputAt(doc, 0) === undefined,
      (doc: ArrangementDocument) => doc.groups?.[0]?.name === 'Group 1',
      (doc: ArrangementDocument) => doc.groups === undefined,
    ];
    for (const undone of steps) {
      expect(ctx.undo()).toBe(true);
      expect(undone(ctx.model.doc)).toBe(true);
    }
    expect(ctx.model.doc).toEqual(start);
  });
});

describe('a group’s chain as an insert target', () => {
  it('reads and writes groups.<id>.inserts, and is never a slot or a send bus', () => {
    const ctx = open([group(1, 'Drums'), group(2, 'Keys')]);
    const target = groupKey(2);
    expect(isGroupTarget(target)).toBe(true);
    expect(isBusTarget(target)).toBe(false);
    for (const other of [0, 'master', 'a', 'b'] as const) expect(isGroupTarget(other)).toBe(false);
    const chain = addInsert(addInsert([], 'compressor', target), 'tape', target);
    expect(insertChange(target, chain)).toEqual({ groups: { 2: { inserts: chain } } });
    expect(ctx.change(insertChange(target, chain)).ok).toBe(true);
    expect(insertsOf(ctx, target).map((spec) => spec.kind)).toEqual(['compressor', 'tape']);
    expect(insertsOf(ctx, groupKey(1))).toEqual([]);
    expect(insertsOf(ctx, groupKey(9))).toEqual([]);
  });
});
