import { expect, it } from 'vitest';
import { DEFAULT_DELAY, DELAY_BOUNDS } from '@windsor/engine';
import { DELAY_KNOBS } from './delayTables';
it('uses engine ranges and reset values for every delay knob', () => {
  expect(DELAY_KNOBS.map((entry) => entry.f).sort()).toEqual(Object.keys(DELAY_BOUNDS).sort());
  for (const { f, o } of DELAY_KNOBS) {
    expect(o.def).toBe(DEFAULT_DELAY[f]);
    expect([o.min, o.max]).toEqual(DELAY_BOUNDS[f as keyof typeof DELAY_BOUNDS]);
  }
});
