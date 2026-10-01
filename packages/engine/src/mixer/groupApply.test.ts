/**
 * A `groups` partial read against the live ids (windsor#285 decision 5):
 * `null` at a live id removes, a whole group at a free id adds, a fragment
 * at a live id edits; more than `MAX_GROUPS` refuses the whole partial; and
 * the edits land with the document's clamps, junk reported by path.
 */
import { describe, expect, it } from 'vitest';

import { MAX_GROUPS, MIX_LEVEL_MAX } from '../audioConstants';
import { DEFAULT_COMPRESSOR } from '../inserts/compressorSpec';
import type { InsertSpec } from '../inserts/insertRegistry';
import { applyGroupsLive, planGroupsLive } from './groupApply';
import type { GroupBus } from './groupBus';
import type { GroupSpec } from './mix';

const group = (id: number, name = `Group ${id}`): GroupSpec => ({
  id,
  name,
  level: 1,
  pan: 0,
  inserts: [],
});

/** A bus that records what lands on it. */
function stubBus(id: number): GroupBus & { calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  const record =
    (name: string) =>
    (value: unknown): void => {
      calls.push([name, value]);
    };
  return {
    id,
    spec: group(id),
    calls,
    setName: record('name'),
    setLevel: record('level'),
    setPan: record('pan'),
    setMute: record('mute'),
    setSolo: record('solo'),
    setInserts: record('inserts'),
  } as unknown as GroupBus & { calls: [string, unknown][] };
}

describe('planGroupsLive', () => {
  it('reads removals, additions and edits, and reports what names nothing', () => {
    const plan = planGroupsLive(new Set([1, 2]), {
      1: null,
      2: { level: 0.5 },
      4: { ...group(4, 'Drums'), level: 9 },
      5: { level: 0.2 },
      6: null,
      x: { id: 'x' },
      7: 'junk',
    });
    expect(plan.removed).toEqual([1]);
    expect([...plan.edits]).toEqual([[2, { level: 0.5 }]]);
    // The new group is the normaliser's: the level clamped, silently.
    expect(plan.added).toEqual([{ ...group(4, 'Drums'), level: MIX_LEVEL_MAX }]);
    expect(plan.ignored).toEqual(['groups.5', 'groups.6', 'groups.7', 'groups.x']);
    expect(plan.error).toBeUndefined();
  });

  it('reports what the normaliser dropped from a new group under its id', () => {
    const plan = planGroupsLive(new Set(), {
      3: { id: 3, name: 'Kit', colour: 'red', mute: 'yes' },
    });
    expect(plan.added).toEqual([{ ...group(3, 'Kit'), mute: false }]);
    expect(plan.ignored).toEqual(expect.arrayContaining(['groups.3.colour', 'groups.3.mute']));
  });

  it('refuses a partial that would leave more than MAX_GROUPS, and allows one that swaps', () => {
    const live = new Set(Array.from({ length: MAX_GROUPS }, (_, i) => i));
    const ninth = planGroupsLive(live, { 20: group(20) });
    expect(ninth.error).toBe(`groups: a song holds at most ${MAX_GROUPS} groups`);
    expect(ninth.added).toEqual([]);
    const swap = planGroupsLive(live, { 0: null, 20: group(20) });
    expect(swap.error).toBeUndefined();
    expect(swap.added.map((g) => g.id)).toEqual([20]);
  });

  it('reads nothing from an absent partial and reports a junk one', () => {
    expect(planGroupsLive(new Set([1]), undefined).ignored).toEqual([]);
    expect(planGroupsLive(new Set([1]), [1]).ignored).toEqual(['groups']);
  });
});

describe('applyGroupsLive', () => {
  it('lands each named field with the document clamps, and reports junk and unknown keys', () => {
    const bus = stubBus(2);
    const ignored = applyGroupsLive(
      new Map([[2, bus]]),
      new Map([
        [
          2,
          {
            name: 'Kit',
            level: 9,
            pan: -3,
            mute: true,
            solo: 'no',
            colour: 1,
            id: 5,
          },
        ],
      ]),
    );
    expect(bus.calls).toEqual([
      ['name', 'Kit'],
      ['level', MIX_LEVEL_MAX],
      ['pan', -1],
      ['mute', true],
    ]);
    expect(ignored).toEqual(['groups.2.colour', 'groups.2.id', 'groups.2.solo']);
  });

  it('lands a chain as a bus does: a compressor keyed from outside is keyed from the group', () => {
    const bus = stubBus(2);
    const keyed = { ...DEFAULT_COMPRESSOR, sidechain: { track: 0 } } as InsertSpec;
    const ignored = applyGroupsLive(new Map([[2, bus]]), new Map([[2, { inserts: [keyed] }]]));
    const [[call, specs]] = bus.calls as [[string, InsertSpec[]]];
    expect(call).toBe('inserts');
    expect(specs[0]).toMatchObject({ kind: 'compressor', sidechain: 'internal' });
    expect(ignored).toEqual(['groups.2.inserts[0].sidechain']);
  });

  it('reports an edit for a group that is not live', () => {
    expect(applyGroupsLive(new Map(), new Map([[4, { level: 1 }]]))).toEqual(['groups.4']);
  });
});
