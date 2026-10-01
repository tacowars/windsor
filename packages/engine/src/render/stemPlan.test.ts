/**
 * Which stems a song exports and how they split into passes (windsor#41):
 * parts by slot with the "Sidechain only" ones left out unless asked for,
 * the returns an audible part sends to, and passes as wide as the channel
 * limit and the pass budget allow.
 */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import type { GroupSpec } from '../mixer/mix';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { RENDER_STEM_CHANNELS_MAX, RENDER_STEM_PASS_MAX_SAMPLES } from './renderConstants';
import { passChannels, planStemPasses, stemSources } from './stemPlan';

/** FULL_DOCUMENT with one part's strip changed. */
function withStrip(slot: number, strip: object): ArrangementDocument {
  return {
    ...FULL_DOCUMENT,
    parts: FULL_DOCUMENT.parts.map((part) =>
      part.slot === slot ? { ...part, strip: { ...part.strip, ...strip } } : part,
    ),
  };
}

describe('stemSources', () => {
  it('lists every part by slot, then the returns a part sends to', () => {
    expect(stemSources(FULL_DOCUMENT)).toEqual([
      { kind: 'part', slot: 0, name: 'kick', muted: false },
      { kind: 'part', slot: 1, name: 'hat', muted: false },
      { kind: 'part', slot: 2, name: 'arp', muted: false },
      { kind: 'part', slot: 3, name: 'drone', muted: false },
      { kind: 'return', name: 'a' },
      { kind: 'return', name: 'b' },
    ]);
  });

  it('orders parts by slot whatever the document order', () => {
    const reversed = { ...FULL_DOCUMENT, parts: [...FULL_DOCUMENT.parts].reverse() };
    expect(stemSources(reversed).map((s) => (s.kind === 'part' ? s.slot : s.name))).toEqual([
      0,
      1,
      2,
      3,
      'a',
      'b',
    ]);
  });

  it('skips a "Sidechain only" part unless asked, and its sends feed no return', () => {
    // The hat is the only part sending to Send B.
    const song = withStrip(FULL_SLOT.hat, { output: 'sidechain' });
    const names = (choice = {}): string[] => stemSources(song, choice).map((s) => s.name);
    expect(names()).toEqual(['kick', 'arp', 'drone', 'a']);
    expect(names({ includeMuted: true })).toEqual(['kick', 'hat', 'arp', 'drone', 'a']);
    expect(stemSources(song, { includeMuted: true })[1]).toMatchObject({ muted: true });
  });

  it('lists a muted part, whose sends feed no return (windsor#154)', () => {
    // The hat is the only part sending to Send B.
    const song = withStrip(FULL_SLOT.hat, { mute: true });
    expect(stemSources(song).map((s) => s.name)).toEqual(['kick', 'hat', 'arp', 'drone', 'a']);
    expect(stemSources(song)[1]).toMatchObject({ muted: false });
  });

  it('keeps only the returns a soloed part sends to (windsor#154)', () => {
    const names = (slot: number): string[] =>
      stemSources(withStrip(slot, { solo: true })).map((s) => s.name);
    // The kick sends nothing, the hat only to Send B.
    expect(names(FULL_SLOT.kick)).toEqual(['kick', 'hat', 'arp', 'drone']);
    expect(names(FULL_SLOT.hat)).toEqual(['kick', 'hat', 'arp', 'drone', 'b']);
  });

  it('leaves out a return whose only sender is in a muted group, as playback silences it (windsor#285)', () => {
    // A muted group closes its members' gates, their sends included.
    const base = withStrip(FULL_SLOT.drone, { sends: { a: 0 } });
    const song: ArrangementDocument = {
      ...base,
      groups: [{ id: 1, name: 'Group 1', level: 1, pan: 0, mute: true, inserts: [] }],
      parts: base.parts.map((part) =>
        part.slot === FULL_SLOT.arp
          ? { ...part, strip: { ...part.strip, output: { group: 1 } } }
          : part,
      ),
    };
    const sources = stemSources(song);
    // The arp's stem is its group's, listed though muted (windsor#286).
    expect(sources).toContainEqual({ kind: 'group', id: 1, name: 'Group 1', position: 1 });
    expect(sources).not.toContainEqual(expect.objectContaining({ slot: FULL_SLOT.arp }));
    expect(sources).not.toContainEqual({ kind: 'return', name: 'a' });
  });

  it('leaves out a return nobody sends to', () => {
    const song = withStrip(FULL_SLOT.hat, { sends: { b: 0 } });
    expect(stemSources(song).filter((s) => s.kind === 'return')).toEqual([
      { kind: 'return', name: 'a' },
    ]);
  });
});

/** A group with no inserts, at unity. */
const group = (id: number, name: string, switches: Partial<GroupSpec> = {}): GroupSpec => ({
  id,
  name,
  level: 1,
  pan: 0,
  inserts: [],
  ...switches,
});

/** `document` with `groups`, and each part in `members` routed to the group id it names. */
function grouped(
  groups: GroupSpec[],
  members: Readonly<Record<number, number>>,
  document: ArrangementDocument = FULL_DOCUMENT,
): ArrangementDocument {
  return {
    ...document,
    groups,
    parts: document.parts.map((part) =>
      members[part.slot] === undefined
        ? part
        : { ...part, strip: { ...part.strip, output: { group: members[part.slot]! } } },
    ),
  };
}

describe('stemSources with group buses (windsor#286)', () => {
  const DRUMS = group(4, 'Drums');
  const KEYS = group(0, 'Keys');

  it('lists the ungrouped parts, then each group with a member in list order, then the returns', () => {
    const song = grouped([DRUMS, KEYS], {
      [FULL_SLOT.kick]: 4,
      [FULL_SLOT.hat]: 4,
      [FULL_SLOT.drone]: 0,
    });
    expect(stemSources(song)).toEqual([
      { kind: 'part', slot: FULL_SLOT.arp, name: 'arp', muted: false },
      { kind: 'group', id: 4, name: 'Drums', position: 1 },
      { kind: 'group', id: 0, name: 'Keys', position: 2 },
      { kind: 'return', name: 'a' },
      { kind: 'return', name: 'b' },
    ]);
  });

  it('gives a member no stem of its own, whatever includeMuted says', () => {
    const song = grouped([DRUMS], { [FULL_SLOT.kick]: 4 });
    for (const choice of [{}, { includeMuted: true }]) {
      expect(stemSources(song, choice).map((s) => s.name)).toEqual([
        'hat',
        'arp',
        'drone',
        'Drums',
        'a',
        'b',
      ]);
    }
  });

  it('gives an empty group no stem, and still counts its place', () => {
    const song = grouped([group(2, 'Empty'), DRUMS], { [FULL_SLOT.kick]: 4 });
    expect(stemSources(song).filter((s) => s.kind === 'group')).toEqual([
      { kind: 'group', id: 4, name: 'Drums', position: 2 },
    ]);
  });

  it('lists a muted or soloed-out group, which renders silent', () => {
    const muted = grouped([group(4, 'Drums', { mute: true })], { [FULL_SLOT.kick]: 4 });
    expect(stemSources(muted).map((s) => s.name)).toContain('Drums');
    const soloing = withStrip(FULL_SLOT.arp, { solo: true });
    const soloedOut = grouped([DRUMS], { [FULL_SLOT.kick]: 4 }, soloing);
    expect(stemSources(soloedOut).map((s) => s.name)).toContain('Drums');
  });

  it('keeps the returns a soloed group sends to through its members', () => {
    // The hat, in the soloed Drums, is the only part sending to Send B.
    const song = grouped([group(4, 'Drums', { solo: true })], { [FULL_SLOT.hat]: 4 });
    expect(stemSources(song).filter((s) => s.kind === 'return')).toEqual([
      { kind: 'return', name: 'b' },
    ]);
  });

  it('gives a part naming a group the song lacks its own stem, as it plays on Master', () => {
    const song = grouped([], { [FULL_SLOT.kick]: 9 });
    expect(stemSources(song)).toEqual(stemSources(FULL_DOCUMENT));
  });

  it('plans exactly the stems of today for a song with an empty group list', () => {
    expect(stemSources({ ...FULL_DOCUMENT, groups: [] })).toEqual(stemSources(FULL_DOCUMENT));
  });
});

describe('planStemPasses', () => {
  it('renders up to 15 stems beside the master in one 32-channel pass', () => {
    expect(RENDER_STEM_CHANNELS_MAX).toBe(32);
    expect(planStemPasses(10, 48000)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(planStemPasses(15, 48000)).toHaveLength(1);
    expect(planStemPasses(16, 48000)).toEqual([Array.from({ length: 15 }, (_, i) => i), [15]]);
    expect(passChannels(15)).toBe(32);
  });

  it('renders the master alone when there is no stem', () => {
    expect(planStemPasses(0, 48000)).toEqual([[]]);
  });

  it('narrows the passes for a long song, within the budget', () => {
    // A 4-minute song at 48 kHz: 22 channels would pass the budget.
    const frames = 4 * 60 * 48000;
    const passes = planStemPasses(10, frames);
    expect(passes.length).toBeGreaterThan(1);
    const widest = Math.max(...passes.map((p) => passChannels(p.length)));
    expect(widest * frames).toBeLessThanOrEqual(RENDER_STEM_PASS_MAX_SAMPLES);
    expect(passes.flat()).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });

  it('refuses when not even one stem fits beside the master', () => {
    expect(() => planStemPasses(1, 100, { maxChannels: 3, maxSamples: 1e9 })).toThrow(RangeError);
    expect(() => planStemPasses(1, 100, { maxChannels: 32, maxSamples: 399 })).toThrow(RangeError);
    expect(planStemPasses(1, 100, { maxChannels: 32, maxSamples: 400 })).toEqual([[0]]);
  });
});
