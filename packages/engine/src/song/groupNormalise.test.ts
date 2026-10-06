/**
 * The `groups` section and the group Output (windsor#284; record
 * `2026-10-01-group-buses` decisions 2, 3, 7 and 11): a song's group buses
 * round-trip through normalise and export, every junk value is corrected
 * by path, and a part naming a group the song lacks plays on Master. A
 * group's automation lanes (windsor#614) round-trip with the rest of the
 * song, are read against its own inserts and narrower targets, and leave a
 * song without them as it was.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_BARS } from '../audioConstants';
import { KICK, song } from '../__fixtures__/documentCases';
import { AUTOMATION_LANES } from '../__fixtures__/automationSong';
import { FULL_ARRANGEMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import {
  CAPTURED_KICK,
  GROUP_LANES,
  GROUP_LANES_DOCUMENT,
  GROUP_PHASER,
  groupPhaserTarget,
} from '../__fixtures__/groupAutomationSong';
import { withoutInsertIds } from '../__fixtures__/insertIds';
import { MAX_GROUPS } from '../audioConstants';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { MAX_INSERTS } from '../inserts/insertConstants';
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
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

describe("a group's lanes (windsor#614)", () => {
  const SONG_TICKS = DEFAULT_BARS * TICKS_PER_BAR;
  const rise = (target: string, from = 0.2, to = 1) => ({
    target,
    on: true,
    points: [
      { tick: 0, value: from, bend: 0 },
      { tick: TICKS_PER_BAR, value: to, bend: 0 },
    ],
  });
  /** One group holding the Phaser, with `automation` as written. */
  const withLanes = (automation: unknown, inserts: unknown[] = [GROUP_PHASER]) =>
    makeArrangement(
      grouped([
        { ...DRUMS, inserts, automation },
        { ...MUSIC, inserts: [] },
      ]),
    );
  const lanesOf = (r: ReturnType<typeof makeArrangement>) => r.document.groups?.[0]?.automation;

  it('round-trip with the parts, patches, returns, strips, harmony, sequencers and captured patterns', () => {
    const { first, again } = roundTrip(GROUP_LANES_DOCUMENT);
    expect(first.corrections).toEqual([]);
    expect(first.dangling).toEqual([]);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
    expect(JSON.stringify(again.document)).toBe(JSON.stringify(first.document));
    const doc = first.document;
    expect(doc.groups?.[0]?.automation).toEqual(GROUP_LANES);
    expect(doc.groups?.[0]?.inserts).toEqual([GROUP_PHASER]);
    expect(doc.parts.find((p) => p.slot === FULL_SLOT.hat)?.automation).toEqual(AUTOMATION_LANES);
    const kick = doc.parts.find((p) => p.slot === FULL_SLOT.kick)!;
    expect(kick.sequencer).toMatchObject({ kind: 'euclidean', pattern: CAPTURED_KICK });
    expect(kick.strip.output).toEqual({ group: GROUP_LANES_DOCUMENT.groups![0]!.id });
    expect(doc.harmony).toEqual(FULL_ARRANGEMENT.harmony);
    expect(Object.keys(doc.patches ?? {})).toEqual(Object.keys(GROUP_LANES_DOCUMENT.patches!));
    expect(Object.keys(doc.returns ?? {})).toEqual(['a', 'b']);
  });

  it('leave a song without them byte for byte as it was: no group gains the key', () => {
    const first = makeArrangement(grouped([DRUMS, MUSIC])).document;
    for (const group of first.groups!) {
      expect(Object.keys(group)).toEqual(Object.keys(group).filter((k) => k !== 'automation'));
      expect(group).not.toHaveProperty('automation');
    }
    const empty = withLanes([]);
    expect(empty.corrections).toEqual([]);
    expect(lanesOf(empty)).toBeUndefined();
    const text = JSON.stringify(first);
    expect(JSON.stringify(makeArrangement(JSON.parse(text)).document)).toBe(text);
  });

  it.each([
    ['a send', 'strip.send.a', /a group has no strip\.send\.a lane/],
    ['a voice target', 'voice.filter.cutoff', /a group has no voice\.filter\.cutoff lane/],
    ['a sequencer target', 'seq.gate', /a group has no seq\.gate lane/],
    ['an insert the group does not hold', 'insert.nope.rate', /the group has no insert "nope"/],
  ])('drop a lane on %s, with a correction', (_, target, message) => {
    const r = withLanes([rise('strip.level'), rise(target, 0, 0.5)]);
    expect(lanesOf(r)?.map((l) => l.target)).toEqual(['strip.level']);
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0]).toMatch(/^groups\[0\]\.automation\[1\]\.target: /);
    expect(r.corrections[0]).toMatch(message);
  });

  it('drop a list that is not one, with a correction', () => {
    const r = withLanes({ target: 'strip.level' });
    expect(lanesOf(r)).toBeUndefined();
    expect(r.corrections.join('\n')).toMatch(/groups\[0\]\.automation: .* is not a list of lanes/);
  });

  it("drop the lanes of an insert the group's list no longer holds", () => {
    const r = withLanes([rise('strip.pan', -1, 1), rise(groupPhaserTarget('rate'))], []);
    expect(lanesOf(r)?.map((l) => l.target)).toEqual(['strip.pan']);
    expect(r.corrections).toEqual([
      'groups[0].automation[1].target: the group has no insert "gphase1" — lane dropped',
    ]);
  });

  it("fit to the song's length, and have no cap", () => {
    // A linear pan from hard left over twice the song: centre where the song ends.
    const past = {
      target: 'strip.pan',
      on: true,
      points: [
        { tick: 0, value: -1, bend: 0 },
        { tick: 2 * SONG_TICKS, value: 1, bend: 0 },
      ],
    };
    const fields = INSERT_AUTOMATION_FIELDS.phaser.map((row) =>
      rise(groupPhaserTarget(row.target), row.min, row.max),
    );
    const r = withLanes([past, rise('strip.level'), ...fields]);
    expect(lanesOf(r)).toHaveLength(2 + fields.length);
    expect(lanesOf(r)![0]!.points.at(-1)).toEqual({ tick: SONG_TICKS, value: 0, bend: 0 });
    expect(r.corrections).toEqual([
      `groups[0].automation[0].points: points past the song's end (tick ${SONG_TICKS}) — fitted to it`,
    ]);
  });
});
