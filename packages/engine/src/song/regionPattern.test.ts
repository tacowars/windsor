/**
 * `regionPattern` (windsor#73): a region's own pattern with the part's seed,
 * or the part's `sequencer` for a region without one, an index that names no
 * region, and a pattern left behind by a kind change.
 */
import { describe, expect, it } from 'vitest';

import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { CHORD_PATTERN_B, REGION_PATTERN_CHORD, song } from '../__fixtures__/documentCases';
import type { MusicPart, RegionPattern, SequencerSpec } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { regionPattern } from './regionPattern';

const BAR = TICKS_PER_BAR;

const GRID_PART: SequencerSpec = {
  kind: 'grid',
  divisor: 6,
  steps: [{ kind: 'rest' }],
  length: 1,
  skipChance: 0,
  accentVelocity: 1,
  accentMod: 0,
  register: { octave: 2 },
  seed: 41,
  lanes: [],
};

const GRID_PATTERN: RegionPattern = {
  kind: 'grid',
  divisor: 12,
  steps: [{ kind: 'tie' }, { kind: 'rest' }],
  length: 2,
  skipChance: 0.5,
  accentVelocity: 0.8,
  accentMod: 0.2,
  register: { octave: 3 },
  lanes: [],
};

const part = (regions: MusicPart['regions'], sequencer: SequencerSpec = GRID_PART): MusicPart => ({
  slot: 0,
  name: 'grid',
  preset: 'p',
  velocity: 1,
  regions,
  sequencer,
});

describe('regionPattern (windsor#73)', () => {
  it("returns a seeded region's pattern with the part's seed", () => {
    const p = part([
      { start: 0, duration: BAR },
      { start: BAR, duration: BAR, pattern: GRID_PATTERN },
    ]);
    expect(regionPattern(p, 1)).toStrictEqual({ ...GRID_PATTERN, seed: 41 });
  });

  it("returns an unseeded kind's pattern as it is, with no seed added", () => {
    const { document } = makeArrangement(song([REGION_PATTERN_CHORD]));
    const chords = document.parts[0]!;
    expect(regionPattern(chords, 1)).toStrictEqual(CHORD_PATTERN_B);
    expect(regionPattern(chords, 1)).not.toHaveProperty('seed');
  });

  it("falls back to the part's sequencer for a region without a pattern", () => {
    const p = part([{ start: 0, duration: BAR }]);
    expect(regionPattern(p, 0)).toBe(GRID_PART);
  });

  it("falls back to the part's sequencer for an index that names no region", () => {
    const p = part([{ start: 0, duration: BAR, pattern: GRID_PATTERN }]);
    expect(regionPattern(p, 1)).toBe(GRID_PART);
    expect(regionPattern(p, -1)).toBe(GRID_PART);
    expect(regionPattern(part([]), 0)).toBe(GRID_PART);
  });

  it('plays the part, not a pattern of another kind left behind by a kind change', () => {
    const none: SequencerSpec = { kind: 'none' };
    const p = part([{ start: 0, duration: BAR, pattern: GRID_PATTERN }], none);
    expect(regionPattern(p, 0)).toBe(none);
  });
});
