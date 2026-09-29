import { expect, it } from 'vitest';
import { DEFAULT_TAPE, TAPE_BOUNDS } from '@windsor/engine';
import { TAPE_KNOBS } from './tapeTables';
it('uses engine ranges/defaults for every editable tape number and displays the hiss floor as Off', () => {
  expect(TAPE_KNOBS.map((k) => k.f).sort()).toEqual(
    Object.keys(TAPE_BOUNDS)
      .filter((k) => k !== 'seed')
      .sort(),
  );
  for (const { f, o } of TAPE_KNOBS) {
    expect(o.def).toBe(DEFAULT_TAPE[f]);
    expect([o.min, o.max]).toEqual(TAPE_BOUNDS[f as keyof typeof TAPE_BOUNDS]);
  }
  expect(TAPE_KNOBS.find((k) => k.f === 'hiss')!.o.fmt!(TAPE_BOUNDS.hiss[0])).toBe('Off');
});
