/**
 * `ReverbSpace` restates the parameter list of the plate in `worklet/reverb/`
 * (bundled to `worklet/generated/reverb-processor.js`), which the main thread
 * does not import. These tests are what makes that duplication
 * safe: they fail the moment a parameter is added, renamed, retyped, or given a
 * different default or range on one side only.
 */
import { describe, expect, it } from 'vitest';

import { loadReverb } from '../__fixtures__/reverbHarness';
import { REVERB_SPACE_RANGES } from '../audioConstants';
import { DEFAULT_SPACE, SPACES, SPACE_NAMES, makeSpace } from './reverbSpace';

const loaded = loadReverb();
const byName = new Map(loaded.descriptors.map((d) => [d.name, d]));

/** Parameters the processor owns that are not part of a saved room. */
const NOT_IN_SPACE = new Set(['hold', 'wet', 'dry']);

describe('ReverbSpace mirrors the worklet parameters', () => {
  it('names only parameters the processor declares', () => {
    for (const name of Object.keys(DEFAULT_SPACE)) {
      expect(byName.get(name), `space field ${name}`).toBeDefined();
    }
  });

  it('covers every parameter that belongs to a room', () => {
    const covered = new Set(Object.keys(DEFAULT_SPACE));
    for (const d of loaded.descriptors) {
      if (NOT_IN_SPACE.has(d.name)) continue;
      expect(covered.has(d.name), `parameter ${d.name} is missing from ReverbSpace`).toBe(true);
    }
  });

  it('agrees with the processor on every default', () => {
    for (const [name, value] of Object.entries(DEFAULT_SPACE)) {
      expect(byName.get(name)?.defaultValue, `default for ${name}`).toBe(value);
    }
  });

  it('agrees with the processor on every range (REVERB_SPACE_RANGES, the document clamp)', () => {
    expect(Object.keys(REVERB_SPACE_RANGES).sort()).toEqual(Object.keys(DEFAULT_SPACE).sort());
    for (const [name, [min, max]] of Object.entries(REVERB_SPACE_RANGES)) {
      expect(byName.get(name)?.minValue, `min for ${name}`).toBe(min);
      expect(byName.get(name)?.maxValue, `max for ${name}`).toBe(max);
    }
  });

  it('keeps every parameter k-rate, as the block-rate DSP assumes', () => {
    for (const d of loaded.descriptors) {
      expect(d.automationRate, `automation rate of ${d.name}`).toBe('k-rate');
    }
  });
});

describe('the shipped spaces', () => {
  it('are all in range, so no preset is silently clamped', () => {
    for (const key of SPACE_NAMES) {
      const space = SPACES[key];
      for (const [name, value] of Object.entries(space)) {
        const d = byName.get(name);
        expect(d, `${key}.${name}`).toBeDefined();
        if (!d) continue;
        expect(value, `${key}.${name} below minimum`).toBeGreaterThanOrEqual(d.minValue);
        expect(value, `${key}.${name} above maximum`).toBeLessThanOrEqual(d.maxValue);
      }
    }
  });

  it('are distinct rooms, not copies of one another', () => {
    const seen = new Set(SPACE_NAMES.map((k) => JSON.stringify(SPACES[k])));
    expect(seen.size).toBe(SPACE_NAMES.length);
  });

  it('order by size from the smallest room to the largest', () => {
    expect(SPACES.room.size).toBeLessThan(SPACES.plate.size);
    expect(SPACES.plate.size).toBeLessThan(SPACES.hall.size);
    expect(SPACES.hall.size).toBeLessThan(SPACES.cathedral.size);
  });
});

describe('makeSpace', () => {
  it('fills every field when given nothing', () => {
    expect(Object.keys(makeSpace()).sort()).toEqual(Object.keys(DEFAULT_SPACE).sort());
  });

  it('keeps the defaults it is not given', () => {
    const space = makeSpace({ size: 2.5 });
    expect(space.size).toBe(2.5);
    expect(space.decay).toBe(DEFAULT_SPACE.decay);
  });

  it('returns a fresh object, so editing one room cannot alter another', () => {
    const space = makeSpace();
    space.size = 3;
    expect(DEFAULT_SPACE.size).toBe(1);
  });
});
