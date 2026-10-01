/**
 * The `groups` section and the group Output (windsor#284; record
 * `2026-10-01-group-buses` decisions 2, 3, 7 and 11): a song's group buses
 * round-trip through normalise and export, every junk value is corrected
 * by path, and a part naming a group the song lacks plays on Master.
 */
import { describe, expect, it } from 'vitest';

import { KICK, song } from '../__fixtures__/documentCases';
import { withoutInsertIds } from '../__fixtures__/insertIds';
import { MAX_GROUPS } from '../audioConstants';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { MAX_INSERTS } from '../inserts/insertConstants';
import { makeArrangement } from './arrangementDocument';

const HAT = { ...KICK, slot: 1, name: 'hat', preset: 'hat' };
const ARP = { ...KICK, slot: 2, name: 'arp', preset: 'saw-arp' };

const DRUMS = {
  id: 3,
  name: 'Drums',
  level: 0.8,
  pan: -0.25,
  mute: false,
  solo: true,
  inserts: [],
};
const MUSIC = {
  id: 0,
  name: 'Music',
  level: 1.5,
  pan: 0.5,
  mute: true,
  inserts: [DEFAULT_CHORUS],
};

/** A song whose kick and hat play into Drums and arp into Music. */
const grouped = (groups: unknown, rest: Record<string, unknown> = {}) =>
  song(
    [
      { ...KICK, strip: { output: { group: 3 } } },
      { ...HAT, strip: { output: { group: 3 }, solo: true } },
      { ...ARP, strip: { output: { group: 0 } } },
    ],
    { groups, ...rest },
  );

const roundTrip = (raw: unknown) => {
  const first = makeArrangement(raw);
  const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
  return { first, again };
};

describe('the groups section', () => {
  it('round-trips two groups and their members unchanged, with chains of 0, 1 and MAX_INSERTS', () => {
    const full = { ...MUSIC, inserts: Array.from({ length: MAX_INSERTS }, () => DEFAULT_DRIVE) };
    for (const groups of [
      [DRUMS, MUSIC],
      [MUSIC, DRUMS],
      [full, DRUMS],
    ]) {
      const { first, again } = roundTrip(grouped(groups));
      expect(first.corrections).toEqual([]);
      expect(first.dangling).toEqual([]);
      expect(withoutInsertIds({ groups: first.document.groups })).toEqual({ groups });
      expect(first.document.parts.map((part) => part.strip.output)).toEqual([
        { group: 3 },
        { group: 3 },
        { group: 0 },
      ]);
      expect(again.corrections).toEqual([]);
      expect(again.document).toEqual(first.document);
    }
  });

  it('fills a group from DEFAULT_GROUP and leaves mute and solo absent', () => {
    const r = makeArrangement(grouped([{ id: 3, name: 'Drums' }, { id: 0 }]));
    expect(r.corrections).toEqual([]);
    expect(r.document.groups).toEqual([
      { id: 3, name: 'Drums', level: 1, pan: 0, inserts: [] },
      { id: 0, name: 'Group 2', level: 1, pan: 0, inserts: [] },
    ]);
  });

  it('normalises a song with no groups as before, and an empty list to absent', () => {
    const plain = makeArrangement(song([KICK]));
    expect(plain.document).not.toHaveProperty('groups');
    expect(plain.corrections).toEqual([]);
    const empty = makeArrangement(song([KICK], { groups: [] }));
    expect(empty.document).toEqual(plain.document);
    expect(empty.corrections).toEqual([]);
  });

  it('drops a group with a missing, negative, fractional or duplicate id', () => {
    const r = makeArrangement(
      song([KICK], {
        groups: [{ name: 'a' }, { id: -1 }, { id: 1.5 }, { id: '2' }, { id: 4 }, { id: 4 }, 7],
      }),
    );
    expect(r.document.groups).toEqual([{ id: 4, name: 'Group 1', level: 1, pan: 0, inserts: [] }]);
    expect(r.corrections).toEqual([
      'groups[0].id: undefined is not a non-negative integer — group dropped',
      'groups[1].id: -1 is not a non-negative integer — group dropped',
      'groups[2].id: 1.5 is not a non-negative integer — group dropped',
      'groups[3].id: "2" is not a non-negative integer — group dropped',
      'groups[5].id: 4 is already used — group dropped',
      'groups[6]: 7 is not a group — group dropped',
    ]);
  });

  it('corrects junk fields: the name, a clamp, a switch and an unknown key', () => {
    const r = makeArrangement(
      song([KICK], {
        groups: [{ id: 1, name: 9, level: 9, pan: -3, mute: 'yes', solo: 1, sends: { a: 1 } }],
      }),
    );
    expect(r.document.groups).toEqual([
      { id: 1, name: 'Group 1', level: 4, pan: -1, mute: false, solo: false, inserts: [] },
    ]);
    expect(r.corrections).toEqual([
      'groups[0].sends: unknown key dropped',
      'groups[0].name: 9 is not a name — using "Group 1"',
      'groups[0].level: clamped 9 to 4',
      'groups[0].pan: clamped -3 to -1',
      'groups[0].mute: "yes" is not a boolean — using false',
      'groups[0].solo: 1 is not a boolean — using false',
    ]);
    const again = makeArrangement(JSON.parse(JSON.stringify(r.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(r.document);
  });

  it('drops the groups after the eighth', () => {
    const groups = Array.from({ length: MAX_GROUPS + 1 }, (_, id) => ({ id }));
    const r = makeArrangement(song([KICK], { groups }));
    expect(r.document.groups?.map((g) => g.id)).toEqual(
      groups.slice(0, MAX_GROUPS).map((g) => g.id),
    );
    expect(r.corrections).toEqual([
      `groups[${MAX_GROUPS}]: a song holds at most ${MAX_GROUPS} groups — group dropped`,
    ]);
  });

  it('drops a groups section that is not a list', () => {
    const r = makeArrangement(song([KICK], { groups: { 0: DRUMS } }));
    expect(r.document).not.toHaveProperty('groups');
    expect(r.corrections).toEqual([
      `groups: ${JSON.stringify({ 0: DRUMS })} is not a list of groups — dropped`,
    ]);
  });

  it("corrects a compressor's external sidechain on a group to internal", () => {
    const compressor = { kind: 'compressor', sidechain: { track: 0 } };
    const r = makeArrangement(song([KICK], { groups: [{ id: 0, inserts: [compressor] }] }));
    expect(r.document.groups?.[0]?.inserts[0]).toMatchObject({ sidechain: 'internal' });
    expect(r.corrections).toEqual([
      'groups[0].inserts[0].sidechain: a group keys from its own input — internal',
    ]);
  });
});

describe('the group Output', () => {
  it('loads a part naming a missing group on Master, with a correction and a dangling entry', () => {
    const r = makeArrangement(grouped([DRUMS]));
    expect(r.usable).toBe(true);
    expect(r.document.parts.map((part) => part.strip.output)).toEqual([
      { group: 3 },
      { group: 3 },
      'master',
    ]);
    expect(r.dangling).toEqual(['parts.2.strip.output: no group 0 is defined']);
    expect(r.corrections).toEqual(['parts.2.strip.output: no group 0 is defined — Master']);
  });

  it('loads a group Output with no groups section on Master', () => {
    const r = makeArrangement(song([{ ...KICK, strip: { output: { group: 0 } } }]));
    expect(r.usable).toBe(true);
    expect(r.document.parts[0]?.strip.output).toBe('master');
    expect(r.dangling).toEqual(['parts.0.strip.output: no group 0 is defined']);
  });

  it('corrects a junk group Output to Master, and drops an unknown key beside the id', () => {
    for (const output of [{ group: -1 }, { group: 0.5 }, { group: '0' }, {}, ['master'], 3]) {
      const r = makeArrangement(song([{ ...KICK, strip: { output } }], { groups: [DRUMS] }));
      expect(r.document.parts[0]?.strip.output, JSON.stringify(output)).toBe('master');
      expect(r.corrections).toEqual(['parts[0].strip.output: invalid output — Master']);
    }
    const extra = makeArrangement(
      song([{ ...KICK, strip: { output: { group: 3, bus: 1 } } }], { groups: [DRUMS] }),
    );
    expect(extra.document.parts[0]?.strip.output).toEqual({ group: 3 });
    expect(extra.corrections).toEqual(['parts[0].strip.output.bus: unknown key dropped']);
  });
});
