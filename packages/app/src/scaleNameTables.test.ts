import { describe, expect, it } from 'vitest';

import { SCALE_NAMES } from '@windsor/engine';
import { SCALE_DISPLAY_NAMES, SCALE_GROUPS } from './scaleNameTables';

describe('the scale names and groups (windsor#721)', () => {
  it('name every scale once, distinctly', () => {
    const names = SCALE_NAMES.map((scale) => SCALE_DISPLAY_NAMES[scale]);
    expect(names.every((name) => name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(SCALE_NAMES.length);
  });

  it('place every scale in exactly one group', () => {
    const grouped = SCALE_GROUPS.flatMap((group) => group.scales);
    expect([...grouped].sort()).toEqual([...SCALE_NAMES].sort());
  });

  it('show the groups in decision 3’s order', () => {
    expect(SCALE_GROUPS.map((g) => [g.label, g.scales.map((s) => SCALE_DISPLAY_NAMES[s])])).toEqual(
      [
        ['Modes', ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'minor', 'locrian']],
        ['Minor', ['harmonic minor', 'melodic minor', 'phrygian dominant']],
        ['Pentatonic', ['major pentatonic', 'minor pentatonic', 'hirajoshi', 'in (miyako-bushi)']],
        ['Blues', ['major blues', 'minor blues']],
        ['Symmetric', ['whole tone']],
      ],
    );
  });
});
