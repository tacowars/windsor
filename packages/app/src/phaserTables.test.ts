import { expect, it } from 'vitest';
import { DEFAULT_PHASER, PHASER_BOUNDS } from '@windsor/engine';
import { PHASER_KNOBS } from './phaserTables';

it('exposes every numerical engine field with the engine range and default', () => {
  expect(PHASER_KNOBS.map((k) => k.f).sort()).toEqual(Object.keys(PHASER_BOUNDS).sort());
  for (const { f, o } of PHASER_KNOBS) {
    expect(o.def).toBe(DEFAULT_PHASER[f]);
    expect([o.min, o.max]).toEqual(PHASER_BOUNDS[f as keyof typeof PHASER_BOUNDS]);
  }
});
