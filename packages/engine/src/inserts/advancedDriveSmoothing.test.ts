/** Compare the shipped optimized processor to the same DSP with the original full loop. */
import { expect, it } from 'vitest';
import { advancedDriveParams, loadAdvancedDrive } from '../__fixtures__/advancedDriveHarness';
import type { AdvancedDriveProcessorLike } from '../__fixtures__/advancedDriveHarness';
import { ADVANCED_DRIVE_PARAMETERS } from './advancedDriveParameters';
import { ADVANCED_DRIVE_PRESETS } from './advancedDrivePresetTables';
import { DRIVE_DSP as C, DRIVE_ROUTES, DRIVE_SHAPERS } from './advancedDriveConstants';

type Params = Record<string, Float32Array>;
interface ReferenceProcessor extends AdvancedDriveProcessorLike {
  dsp: {
    activeCount: number;
    activeKeys: string[];
    configure(params: Params, frames: number): void;
  };
}
function fullLoopReference(rate: number, params: Params): AdvancedDriveProcessorLike {
  const reference = loadAdvancedDrive(rate, params) as ReferenceProcessor;
  const configure = reference.dsp.configure.bind(reference.dsp);
  const keys = ADVANCED_DRIVE_PARAMETERS.map((p) => p.name).filter(
    (key) => !/^(route|wave)$|_(shaper|filter|pre|enabled|shaping|filtering)$/.test(key),
  );
  reference.dsp.configure = (p, frames): void => {
    configure(p, frames);
    for (let i = 0; i < keys.length; i++) reference.dsp.activeKeys[i] = keys[i]!;
    reference.dsp.activeCount = keys.length;
  };
  return reference;
}

function edit(params: Params, block: number): void {
  const step = block / 12;
  params.route![0] = step % DRIVE_ROUTES.length;
  params.wave![0] = step % 5;
  params.enabled![0] = step % 3 ? 1 : 0;
  params.mix![0] = (step % 3) / 2;
  params.bpm![0] = step % 2 ? 60 : 180;
  params.sync![0] = step % 2;
  params.tone![0] = step % 2 ? 12 : -12;
  for (let s = 0; s < 3; s++) {
    params[`s${s}_shaper`]![0] = (step + s) % DRIVE_SHAPERS.length;
    params[`s${s}_amount`]![0] = step % 2;
    params[`s${s}_bias`]![0] = step % 2 ? -1 : 1;
    params[`s${s}_envAmount`]![0] = step % 2 ? -0.8 : 0.8;
    params[`s${s}_lfoAmount`]![0] = step % 2 ? -0.8 : 0.8;
    params[`s${s}_envCutoff`]![0] = step % 2 ? -5 : 5;
    params[`s${s}_lfoCutoff`]![0] = step % 2 ? -5 : 5;
    params[`s${s}_filtering`]![0] = step % 2;
    params[`s${s}_filter`]![0] = (step + s) % 5;
    params[`s${s}_pre`]![0] = step % 2;
    params[`s${s}_enabled`]![0] = (step + s) % 3 ? 1 : 0;
  }
}

function compare(rate: number, params: Params, dynamic: boolean): void {
  const optimized = loadAdvancedDrive(rate, params);
  const reference = fullLoopReference(rate, params);
  const input = [[new Float32Array(128), new Float32Array(128)]];
  const a = [[new Float32Array(128), new Float32Array(128)]];
  const b = [[new Float32Array(128), new Float32Array(128)]];
  let mismatches = 0;
  const blocks = dynamic ? 1100 : 24;
  for (let block = 0; block < blocks; block++) {
    if (dynamic && block < 480 && block % 12 === 0) edit(params, block);
    for (let i = 0; i < 128; i++) {
      const frame = block * 128 + i;
      const silent = dynamic && block >= 480 && block < 1000;
      input[0]![0]![i] = silent ? 0 : 0.3 * Math.sin(frame * 0.057);
      input[0]![1]![i] = silent ? 0 : 0.2 * Math.sin(frame * 0.091);
    }
    optimized.process(input, a, params);
    reference.process(input, b, params);
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < 128; i++) {
        if (!Object.is(a[0]![c]![i], b[0]![c]![i]) || !Number.isFinite(a[0]![c]![i])) mismatches++;
      }
  }
  expect(mismatches).toBe(0);
}

it.each([44100, 48000, 96000])(
  'preserves output through live changes, settling and resumed input at %i Hz',
  (rate) => compare(rate, advancedDriveParams(), true),
  20000,
);

it.each(ADVANCED_DRIVE_PRESETS)('preserves the settled $id preset sample for sample', (preset) => {
  compare(48000, advancedDriveParams(preset.settings), false);
});

interface SmoothingDsp {
  controls: Record<string, number>;
  targets: Record<string, number>;
  activeKeys: string[];
  activeCount: number;
  smooth: number;
  configure(params: Record<string, Float32Array>, frames: number): void;
  update(left: number, right: number): void;
}
const continuous = ADVANCED_DRIVE_PARAMETERS.map((p) => p.name).filter(
  (key) => !/^(route|wave)$|_(shaper|filter|pre|enabled|shaping|filtering)$/.test(key),
);
function setup(rate = 48000) {
  const params = advancedDriveParams();
  const { dsp } = loadAdvancedDrive(rate, params) as unknown as { dsp: SmoothingDsp };
  return { params, dsp };
}

it('starts settled and reuses fixed-capacity storage across no-op and edited blocks', () => {
  const { dsp, params } = setup();
  const storage = dsp.activeKeys;
  expect(dsp.activeCount).toBe(0);
  for (let block = 0; block < 4; block++) {
    dsp.configure(params, 128);
    expect(dsp.activeCount).toBe(0);
    dsp.update(0, 0);
  }
  for (const key of continuous) params[key]![0]! += 0.125;
  dsp.configure(params, 128);
  expect(dsp.activeKeys.slice(0, dsp.activeCount)).toEqual(continuous);
  expect(dsp.activeKeys).toBe(storage);
  expect(dsp.activeKeys).toHaveLength(continuous.length);
  // Discrete stage switches and route changes never enter the smoothing list.
  params.route![0] = 3;
  params.s0_enabled![0] = 0;
  dsp.configure(params, 128);
  expect(dsp.activeKeys.slice(0, dsp.activeCount)).toEqual(continuous);
});

it('does not write settled controls during a sample update', () => {
  const { dsp, params } = setup();
  dsp.configure(params, 128);
  // A regression to the old full loop throws even though its numbers would match.
  Object.freeze(dsp.controls);
  expect(() => dsp.update(0, 0)).not.toThrow();
});

it.each([0.5, 1, 2])('preserves snap behavior at %s times the threshold', (multiple) => {
  const { dsp, params } = setup();
  params.sensitivity![0] = multiple * C.silence;
  dsp.configure(params, 128);
  let expected = 0;
  for (let i = 0; i < 128; i++) {
    const target = params.sensitivity![0]!;
    expected += dsp.smooth * (target - expected);
    if (Math.abs(expected - target) < C.silence) expected = target;
    dsp.update(0, 0);
    expect(dsp.controls.sensitivity).toBe(expected);
  }
});

it('keeps a mid-block settled key until the next block and reactivates it on an edit', () => {
  const { dsp, params } = setup();
  const storage = dsp.activeKeys;
  params.sensitivity![0] = C.silence / 2;
  dsp.configure(params, 128);
  dsp.update(0, 0);
  expect(dsp.controls.sensitivity).toBe(params.sensitivity![0]);
  expect(dsp.activeCount).toBe(1);
  dsp.configure(params, 128);
  expect(dsp.activeCount).toBe(0);
  params.sensitivity![0] = 12;
  dsp.configure(params, 128);
  expect(dsp.activeKeys.slice(0, dsp.activeCount)).toEqual(['sensitivity']);
  dsp.update(0, 0);
  expect(dsp.controls.sensitivity).toBeLessThan(12);
  expect(dsp.activeKeys).toBe(storage);
});

it.each([0, -0])('preserves a target zero sign when starting from %s', (initial) => {
  const { dsp, params } = setup();
  dsp.controls.sensitivity = initial;
  params.sensitivity![0] = -initial;
  dsp.configure(params, 128);
  expect(dsp.activeCount).toBe(1);
  dsp.update(0, 0);
  expect(Object.is(dsp.controls.sensitivity, -initial)).toBe(true);
  dsp.configure(params, 128);
  expect(dsp.activeCount).toBe(0);
});

it.each([44100, 48000, 96000])(
  'matches the independent original recurrence through retargeting at %i Hz',
  (rate) => {
    const { dsp, params } = setup(rate);
    const original = { ...dsp.controls };
    for (let block = 0; block < 12; block++) {
      // Every continuous control, including the first and last, moves in both directions.
      if (block % 3 === 0)
        for (const key of continuous) params[key]![0]! += block % 2 ? -0.125 : 0.125;
      dsp.configure(params, 128);
      for (let i = 0; i < 128; i++) {
        for (const key of continuous) {
          const target = params[key]![0]!;
          original[key]! += dsp.smooth * (target - original[key]!);
          if (Math.abs(original[key]! - target) < C.silence) original[key] = target;
        }
        dsp.update(0, 0);
        expect(dsp.controls).toEqual(original);
      }
    }
  },
);
