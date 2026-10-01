/**
 * The solo rule over parts and group buses (windsor#284; record
 * `2026-10-01-group-buses` decision 6): one pure rule, so playback and a
 * render agree about who is heard and which group is open.
 */
import { describe, expect, it } from 'vitest';

import type { ChannelStrip, GroupSpec } from './mix';
import { DEFAULT_GROUP, DEFAULT_STRIP } from './mix';
import { groupOf, isGroupOpen, isHeard, isSoloing } from './soloRule';

const strip = (fields: Partial<ChannelStrip> = {}): ChannelStrip => ({
  ...DEFAULT_STRIP,
  ...fields,
});
const group = (id: number, fields: Partial<GroupSpec> = {}): GroupSpec => ({
  ...DEFAULT_GROUP,
  id,
  name: `Group ${id + 1}`,
  ...fields,
});

/** A small song: two drums in group 0, a bass in group 1, a lead on Master. */
interface Scene {
  readonly strips: Record<string, ChannelStrip>;
  readonly groups: readonly GroupSpec[];
}

function scene(
  edits: Partial<Record<string, Partial<ChannelStrip>>> = {},
  groupEdits: Partial<Record<number, Partial<GroupSpec>>> = {},
): Scene {
  const outputs: Record<string, NonNullable<ChannelStrip['output']>> = {
    kick: { group: 0 },
    snare: { group: 0 },
    bass: { group: 1 },
    lead: 'master',
  };
  return {
    strips: Object.fromEntries(
      Object.entries(outputs).map(([name, output]) => [name, strip({ output, ...edits[name] })]),
    ),
    groups: [group(0, groupEdits[0]), group(1, groupEdits[1])],
  };
}

/** Who is heard, and which groups are open, in `s`. */
function hearing(s: Scene): { heard: string[]; open: number[] } {
  const strips = Object.values(s.strips);
  const soloing = isSoloing(strips, s.groups);
  return {
    heard: Object.entries(s.strips)
      .filter(([, value]) => isHeard(value, soloing, s.groups))
      .map(([name]) => name),
    open: s.groups.filter((g) => isGroupOpen(g, strips, soloing)).map((g) => g.id),
  };
}

describe('the solo rule with group buses', () => {
  it('hears everyone and opens every group when nothing is soloed', () => {
    expect(hearing(scene())).toEqual({ heard: ['kick', 'snare', 'bass', 'lead'], open: [0, 1] });
  });

  it('counts a soloed group as soloing every member, and solos everything else out', () => {
    const s = scene({}, { 0: { solo: true } });
    expect(isSoloing(Object.values(s.strips), s.groups)).toBe(true);
    expect(hearing(s)).toEqual({ heard: ['kick', 'snare'], open: [0] });
  });

  it("keeps a soloed member's group open and solos its siblings out", () => {
    expect(hearing(scene({ snare: { solo: true } }))).toEqual({ heard: ['snare'], open: [0] });
  });

  it('silences a muted group even when a member is soloed', () => {
    expect(hearing(scene({ snare: { solo: true } }, { 0: { mute: true } }))).toEqual({
      heard: [],
      open: [],
    });
  });

  it('silences the members of a muted group and leaves the rest alone', () => {
    expect(hearing(scene({}, { 1: { mute: true } }))).toEqual({
      heard: ['kick', 'snare', 'lead'],
      open: [0],
    });
  });

  it('never hears a Sidechain-only part, soloed or not', () => {
    const s = scene({ lead: { output: 'sidechain', solo: true } });
    expect(hearing(s).heard).toEqual([]);
    expect(hearing(scene({ lead: { output: 'sidechain' } })).heard).toEqual([
      'kick',
      'snare',
      'bass',
    ]);
  });

  it('hears nothing when the only solo is on an empty group', () => {
    const s: Scene = { ...scene(), groups: [...scene().groups, group(5, { solo: true })] };
    expect(hearing(s)).toEqual({ heard: [], open: [5] });
  });

  it('plays a song with no groups exactly as before', () => {
    const strips = [
      strip({ solo: true }),
      strip(),
      strip({ mute: true }),
      strip({ output: 'sidechain' }),
    ];
    expect(strips.map((value) => isHeard(value, isSoloing(strips), []))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    const plain = [strip(), strip({ mute: true }), strip({ output: 'master' })];
    expect(plain.map((value) => isHeard(value, isSoloing(plain), []))).toEqual([true, false, true]);
  });

  it('finds a strip its group by id, and none for Master, Sidechain or a missing id', () => {
    const groups = [group(3), group(7)];
    expect(groupOf(strip({ output: { group: 7 } }), groups)?.id).toBe(7);
    expect(groupOf(strip({ output: { group: 4 } }), groups)).toBeUndefined();
    expect(groupOf(strip({ output: 'master' }), groups)).toBeUndefined();
    expect(groupOf(strip({ output: 'sidechain' }), groups)).toBeUndefined();
    expect(groupOf(strip(), groups)).toBeUndefined();
  });
});
