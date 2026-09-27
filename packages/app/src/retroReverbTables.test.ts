import { expect, it } from 'vitest';
import {
  DEFAULT_RETRO_REVERB,
  RETRO_REVERB_BOUNDS,
} from '../../../packages/client/src/audio/index-for-editor';
import { RETRO_REVERB_KNOBS } from './retroReverbTables';

it('exposes every numerical engine field with the engine range and default', () => {
  expect(RETRO_REVERB_KNOBS.map((k) => k.f).sort()).toEqual(
    Object.keys(RETRO_REVERB_BOUNDS).sort(),
  );
  for (const { f, o } of RETRO_REVERB_KNOBS) {
    expect(o.def).toBe(DEFAULT_RETRO_REVERB[f]);
    expect([o.min, o.max]).toEqual(RETRO_REVERB_BOUNDS[f as keyof typeof RETRO_REVERB_BOUNDS]);
  }
});
