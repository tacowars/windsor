import { expect, it } from 'vitest';
import { DEFAULT_TAPE, TAPE_BOUNDS } from '@windsor/engine';
import { TAPE_CONTROLS, TAPE_KNOBS, TAPE_PAGES } from './tapeTables';
it('uses engine ranges/defaults for every editable tape number and displays the hiss floor as Off', () => {
  expect(TAPE_KNOBS.map((k) => k.f).sort()).toEqual(
    Object.keys(TAPE_BOUNDS)
      .filter((k) => k !== 'seed' && k !== 'wear')
      .sort(),
  );
  for (const { f, o } of TAPE_KNOBS) {
    expect(o.def).toBe(DEFAULT_TAPE[f]);
    expect([o.min, o.max]).toEqual(TAPE_BOUNDS[f as keyof typeof TAPE_BOUNDS]);
  }
  expect(TAPE_KNOBS.find((k) => k.f === 'hiss')!.o.fmt!(TAPE_BOUNDS.hiss[0])).toBe('Off');
});

it('places every Tape knob and control on exactly one page (windsor#175)', () => {
  const knobs = TAPE_PAGES.flatMap((page) => page.knobs);
  expect([...knobs].sort()).toEqual(TAPE_KNOBS.map((k) => k.f).sort());
  expect(new Set(knobs).size).toBe(knobs.length);
  const controls = TAPE_PAGES.flatMap((page) => page.controls);
  expect([...controls].sort()).toEqual([...TAPE_CONTROLS].sort());
  expect(new Set(controls).size).toBe(controls.length);
  expect(TAPE_PAGES.map((page) => page.name)).toEqual(['Tape', 'Motion']);
});
