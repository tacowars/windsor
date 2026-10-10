import { expect, it } from 'vitest';
import { DEFAULT_RETRO_REVERB, RETRO_REVERB_BOUNDS } from '@windsor/engine';
import { RETRO_REVERB_KNOBS } from './retroReverbTables';

/** Engine fields that have no knob yet; each item that ships one takes its field off this list. */
const NO_KNOB_YET = ['driftRate', 'driftDepth', 'density', 'lowDecay', 'lowCross'];

it('exposes every numerical engine field with the engine range and default', () => {
  expect(RETRO_REVERB_KNOBS.map((k) => k.f).sort()).toEqual(
    Object.keys(RETRO_REVERB_BOUNDS)
      .filter((f) => !NO_KNOB_YET.includes(f))
      .sort(),
  );
  for (const { f, o } of RETRO_REVERB_KNOBS) {
    expect(o.def).toBe(DEFAULT_RETRO_REVERB[f]);
    expect([o.min, o.max]).toEqual(RETRO_REVERB_BOUNDS[f as keyof typeof RETRO_REVERB_BOUNDS]);
  }
});
