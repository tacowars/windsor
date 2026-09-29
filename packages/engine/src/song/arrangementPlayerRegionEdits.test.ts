/**
 * Live edits with region patterns (windsor#74, epic windsor#70 decision 6):
 * an edit to one region's pattern rebuilds or reconfigures that region's
 * generator only, by the same `generatorSig` split as before, so the other
 * region plays on untouched; an edit to `part.sequencer` reaches every
 * region without its own pattern; a seed edit restarts every region; and a
 * region added or removed moves each generator with its region.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS, FULL_SLOT, withPart } from '../__fixtures__/fullArrangement';
import type { FullPartId } from '../__fixtures__/fullArrangement';
import { rig, type Rig } from '../__fixtures__/playerRig';
import { kinds } from '../__fixtures__/recordingPart';
import { CHORD_PATTERN_A, CHORD_PATTERN_B } from '../__fixtures__/documentCases';
import {
  HALF,
  SONG,
  halves,
  patternOf,
  twoRegionSong,
  windowOf,
} from '../__fixtures__/regionPatternSongs';
import type { Arrangement, PartRegion, RegionPattern } from './arrangement';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { DIVISORS, TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const CHORD_A = CHORD_PATTERN_A as unknown as RegionPattern;
const CHORD_B = CHORD_PATTERN_B as unknown as RegionPattern;
const GRID = patternOf(FULL_PARTS.arp.sequencer);
const KICK = patternOf(FULL_PARTS.kick.sequencer);
const ARP = patternOf({ kind: 'arp', ...DEFAULT_ARP_CONFIG });
const BASS = patternOf({ kind: 'bass', ...DEFAULT_BASS_CONFIG, density: 0.7 });

interface Case {
  readonly kind: string;
  readonly id: FullPartId;
  readonly a: RegionPattern;
  readonly b: RegionPattern;
  /** Region 2's pattern after the edit: a live reconfigure. */
  readonly edit: RegionPattern;
}

/** One two-region part of each kind, and an edit to region 2 that keeps its generator. */
const CASES: readonly Case[] = [
  {
    kind: 'chord',
    id: 'drone',
    a: CHORD_A,
    b: CHORD_B,
    // Four hits a bar at inversion 2.
    edit: {
      ...CHORD_B,
      divisor: BAR / 4,
      steps: [{ kind: 'hit', duration: 1, repeat: 4, inversion: 2, octave: 0 }],
    } as RegionPattern,
  },
  {
    kind: 'grid with lanes',
    id: 'arp',
    a: { ...GRID, lanes: [{ param: 'filter.cutoff', values: [0.5, 0, -0.5, 0] }] },
    b: { ...GRID, lanes: [{ param: 'ops.0.level', values: [0, 0.25, 0, 0.25] }] },
    edit: {
      ...GRID,
      steps: [...FULL_PARTS.arp.sequencer.steps].reverse(),
      lanes: [{ param: 'ops.0.level', values: [-0.5, 0, 0, 0] }],
    },
  },
  {
    kind: 'euclid',
    id: 'kick',
    a: KICK,
    b: { ...KICK, rotate: 3 },
    edit: { ...KICK, rotate: 5, note: 40, pulses: { min: 6, max: 9, start: 7 } },
  },
  {
    kind: 'arp',
    id: 'hat',
    a: ARP,
    b: { ...ARP, style: 'random' } as RegionPattern,
    edit: { ...ARP, style: 'down', octaves: 2 } as RegionPattern,
  },
  {
    kind: 'bass',
    id: 'hat',
    a: BASS,
    b: { ...BASS, register: { octave: 3 } } as RegionPattern,
    edit: { ...BASS, register: { octave: 1 }, density: 0.4 } as RegionPattern,
  },
];

/** The part's regions with region 2's pattern replaced: the partial the console sends. */
const editRegion2 = (r: Rig, id: FullPartId, pattern: RegionPattern): void => {
  const slot = FULL_SLOT[id];
  const regions: PartRegion[] = halves(undefined, pattern);
  const current = r.player.arrangement.parts.find((part) => part.slot === slot)!;
  regions[0] = current.regions[0]!;
  expect(r.player.apply({ parts: { [slot]: { regions } } }).ok).toBe(true);
};

/** Two passes of the song: the untouched song, the song edited after `bars`, and the song written with the edit. */
function perform(song: (b: RegionPattern) => Arrangement, c: Case, bars: number) {
  const plain = rig(song(c.b));
  plain.run(8);
  const edited = rig(song(c.b));
  edited.run(bars);
  editRegion2(edited, c.id, c.edit);
  edited.run(8 - bars);
  const written = rig(song(c.edit));
  written.run(8);
  return { plain: plain.parts[c.id], edited: edited.parts[c.id], written: written.parts[c.id] };
}

describe.each(CASES)('editing region 2 of a $kind part live', (c) => {
  const song = (b: RegionPattern): Arrangement => twoRegionSong(c.id, c.a, b, 7);

  it('from inside region 1: region 1 plays on identical, region 2 plays the edit', () => {
    const { plain, edited, written } = perform(song, c, 1);
    expect(kinds(edited, 'allNotesOff')).toEqual([]);
    expect(windowOf(edited, 0, HALF)).toEqual(windowOf(plain, 0, HALF));
    expect(windowOf(edited, SONG, SONG + HALF)).toEqual(windowOf(plain, SONG, SONG + HALF));
    expect(windowOf(edited, HALF, SONG)).not.toEqual(windowOf(plain, HALF, SONG));
    expect(windowOf(edited, HALF, SONG)).toEqual(windowOf(written, HALF, SONG));
  });

  it('from inside region 2: region 1’s next pass is identical, region 2’s next pass is the edit', () => {
    const { plain, edited, written } = perform(song, c, 3);
    expect(kinds(edited, 'allNotesOff')).toEqual([]);
    expect(windowOf(edited, SONG, SONG + HALF)).toEqual(windowOf(plain, SONG, SONG + HALF));
    const next = [SONG + HALF, 2 * SONG] as const;
    expect(windowOf(edited, ...next)).toEqual(windowOf(written, ...next));
  });
});

describe('an edit that rebuilds one region’s generator', () => {
  const grid = (divisor: number): Arrangement =>
    twoRegionSong('arp', GRID, { ...GRID, skipChance: 0.5, divisor } as RegionPattern, 7);
  const sixteenths = { ...GRID, skipChance: 0.5, divisor: DIVISORS.sixteenth } as RegionPattern;

  it('a divisor change in region 2 while region 1 plays cuts nothing and leaves region 1 alone', () => {
    const plain = rig(grid(12));
    plain.run(8);
    const edited = rig(grid(12));
    edited.run(1);
    editRegion2(edited, 'arp', sixteenths);
    edited.run(7);
    const written = rig(grid(DIVISORS.sixteenth));
    written.run(8);
    expect(kinds(edited.parts.arp, 'allNotesOff')).toEqual([]);
    expect(windowOf(edited.parts.arp, 0, HALF)).toEqual(windowOf(plain.parts.arp, 0, HALF));
    expect(windowOf(edited.parts.arp, HALF, SONG)).toEqual(windowOf(written.parts.arp, HALF, SONG));
  });

  it('the same change while region 2 plays restarts the part once, and region 1 still plays on', () => {
    const plain = rig(grid(12));
    plain.run(8);
    const edited = rig(grid(12));
    edited.run(3);
    editRegion2(edited, 'arp', sixteenths);
    edited.run(5);
    expect(kinds(edited.parts.arp, 'allNotesOff')).toHaveLength(1);
    const pass2 = [SONG, SONG + HALF] as const;
    expect(windowOf(edited.parts.arp, ...pass2)).toEqual(windowOf(plain.parts.arp, ...pass2));
  });
});

describe('the part’s sequencer, its seed and its regions', () => {
  it('an edit to part.sequencer reaches a region without its own pattern and not one with', () => {
    const song = withPart(FULL_ARRANGEMENT, 'drone', { regions: halves(CHORD_A) });
    const plain = rig(song);
    plain.run(4);
    const edited = rig(song);
    const { drone } = FULL_SLOT;
    expect(edited.player.apply({ parts: { [drone]: { sequencer: { gate: 0.25 } } } }).ok).toBe(
      true,
    );
    edited.run(4);
    expect(windowOf(edited.parts.drone, 0, HALF)).toEqual(windowOf(plain.parts.drone, 0, HALF));
    expect(windowOf(edited.parts.drone, HALF, SONG)).not.toEqual(
      windowOf(plain.parts.drone, HALF, SONG),
    );
  });

  it('a seed edit restarts every region: the part is cut and plays what the new seed writes', () => {
    const skips = { ...GRID, skipChance: 0.5 } as RegionPattern;
    const edited = rig(twoRegionSong('arp', skips, skips, 7));
    edited.run(1);
    const { arp } = FULL_SLOT;
    expect(edited.player.apply({ parts: { [arp]: { sequencer: { seed: 8 } } } }).ok).toBe(true);
    edited.run(7);
    const written = rig(twoRegionSong('arp', skips, skips, 8));
    written.run(8);
    expect(kinds(edited.parts.arp, 'allNotesOff')).toHaveLength(1);
    // Past the tick region 1 lets go of whatever its restarted stream held.
    expect(windowOf(edited.parts.arp, HALF + 1, 2 * SONG)).toEqual(
      windowOf(written.parts.arp, HALF + 1, 2 * SONG),
    );
  });

  it('removing region 1 while region 2 plays keeps region 2’s generator: nothing restarts', () => {
    const skips = { ...GRID, skipChance: 0.5 } as RegionPattern;
    const song = twoRegionSong('arp', GRID, skips, 7);
    const plain = rig(song);
    plain.run(4);
    const edited = rig(song);
    edited.run(3);
    const { arp } = FULL_SLOT;
    const second = halves(undefined, skips)[1]!;
    expect(edited.player.apply({ parts: { [arp]: { regions: [second] } } }).ok).toBe(true);
    edited.run(1);
    expect(kinds(edited.parts.arp, 'allNotesOff')).toEqual([]);
    expect(windowOf(edited.parts.arp, HALF, SONG)).toEqual(windowOf(plain.parts.arp, HALF, SONG));
  });

  it('the first edit that gives the playing region its own pattern keeps the held chord', () => {
    const song = withPart(FULL_ARRANGEMENT, 'drone', { regions: halves() });
    const r = rig(song);
    r.run(1);
    for (let i = 0; i < BAR / 2; i++) r.transport.advance(r.transport.transportSeconds);
    const held = kinds(r.parts.drone, 'noteOn').length;
    const { drone } = FULL_SLOT;
    // The console's first edit: a full copy of the sequencer, with the change.
    const regions = halves({
      ...patternOf(FULL_PARTS.drone.sequencer),
      gate: 0.5,
    } as RegionPattern);
    expect(r.player.apply({ parts: { [drone]: { regions } } }).ok).toBe(true);
    const offsBefore = kinds(r.parts.drone, 'noteOffByNote').length;
    for (let i = 0; i < BAR / 2 - 1; i++) r.transport.advance(r.transport.transportSeconds);
    expect(kinds(r.parts.drone, 'allNotesOff')).toEqual([]);
    expect(kinds(r.parts.drone, 'noteOffByNote')).toHaveLength(offsBefore);
    expect(kinds(r.parts.drone, 'noteOn')).toHaveLength(held);
  });
});
