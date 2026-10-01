import { expect, it } from 'vitest';
import { DEFAULT_TAPE, TAPE_BOUNDS, TAPE_CORE_BOUNDS, tapeCoreOf } from '@windsor/engine';
import {
  TAPE_CONTROLS,
  TAPE_CORE_KNOBS,
  TAPE_KNOBS,
  TAPE_OVERSAMPLING_HINT,
  TAPE_OVERSAMPLING_OPTIONS,
  TAPE_PAGES,
  driveReadout,
  tapeCoreReadout,
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
    '2× is lighter on CPU; 4× is cleaner on bright, hard-driven sounds.',
  );
});

it('names the core knobs Bend, Width and Saturation and reads each 0–100 % over its box (windsor#291)', () => {
  expect(TAPE_CORE_KNOBS.map((k) => [k.f, k.label])).toEqual([
    ['drive', 'Bend'],
    ['width', 'Width'],
    ['saturation', 'Saturation'],
  ]);
  for (const { f } of TAPE_CORE_KNOBS) {
    const [min, max] = TAPE_CORE_BOUNDS[f];
    expect(tapeCoreReadout(f, min)).toBe('0%');
    expect(tapeCoreReadout(f, (min + max) / 2)).toBe('50%');
    expect(tapeCoreReadout(f, max)).toBe('100%');
  }
  expect(TAPE_CORE_BOUNDS).toEqual({ drive: [0.05, 1], width: [0.05, 0.85], saturation: [0, 1] });
  // Every model row is inside the box (windsor#315): Vintage's and VHS's Width read in range.
  expect(tapeCoreReadout('width', tapeCoreOf({ ...DEFAULT_TAPE, model: 'vintage' }).width)).toBe(
    '98%',
  );
  expect(tapeCoreReadout('width', tapeCoreOf({ ...DEFAULT_TAPE, model: 'vhs' }).width)).toBe('90%');
  expect(TAPE_PAGES.filter((page) => page.advanced).map((page) => page.name)).toEqual(['Tape']);
});
