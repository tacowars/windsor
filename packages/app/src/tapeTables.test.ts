import { expect, it } from 'vitest';
import { DEFAULT_TAPE, TAPE_BOUNDS } from '@windsor/engine';
import {
  TAPE_CONTROLS,
  TAPE_KNOBS,
  TAPE_OVERSAMPLING_HINT,
  TAPE_OVERSAMPLING_OPTIONS,
  TAPE_PAGES,
  driveReadout,
} from './tapeTables';
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

it('reads Drive out as the gain the core receives, in signed dB (windsor#246)', () => {
  const drive = TAPE_KNOBS.find((k) => k.f === 'drive')!;
  expect(drive.o.fmt!(TAPE_BOUNDS.drive[0])).toBe('-12.0 dB');
  expect(drive.o.fmt!(0)).toBe('0.0 dB');
  expect(drive.o.fmt!(TAPE_BOUNDS.drive[1])).toBe('+12.0 dB');
  expect(driveReadout(TAPE_BOUNDS.drive[1] / 2)).toBe('+6.0 dB');
  expect(driveReadout(-0.001)).toBe('0.0 dB');
});

it('offers 2× and 4× beside Tape type with the audition hint (windsor#246)', () => {
  expect(TAPE_OVERSAMPLING_OPTIONS).toEqual([
    ['2', '2×'],
    ['4', '4×'],
  ]);
  const controls = TAPE_PAGES[0]!.controls;
  expect(controls.indexOf('oversampling')).toBe(controls.indexOf('model') + 1);
  expect(TAPE_OVERSAMPLING_HINT).toBe(
    'Audition only: 2× costs less CPU; 4× is cleaner on bright, hard-driven sounds. One of these will be removed after the audition.',
  );
});
