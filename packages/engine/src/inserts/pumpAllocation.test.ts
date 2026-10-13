/**
 * Worklet rules 2 and 7 for the Pump (record `2026-10-13-pump-insert`),
 * measured on V8 as `compressorAllocation.test.ts` measures the compressor:
 * once its paths have run, its render allocates nothing through playing,
 * triggering, every control and the drawn shape moving, the switch, the
 * external key and the scope, and no field of the bundle ever changes its
 * representation. The heap is read with the scope off: a scope post is a
 * structured clone, which only an open card pays for.
 *
 * Tolerance: 16 KiB over the measured quanta, the compressor's.
 */
import { describe, expect, it } from 'vitest';
import type {
  PumpChangeConfig,
  PumpChangeStep,
  PumpInput,
} from '../__fixtures__/pumpChangeScenario';
import {
  expectAllocationFree,
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';

const TOLERANCE_BYTES = 16 * 1024;
const PERIOD = 160;
const QUIET = 16;

/** The processor's parameters, in the order of each row below. */
const NAMES = [
  'lengthMs',
  'depth',
  'sensitivity',
  'holdMs',
  'smoothMs',
  'enabled',
  'external',
  'count',
  'at1',
  'level1',
  'bend1',
  'at2',
  'level2',
  'bend2',
];

/** One step a row: its parameter values, its input and whether the scope is on. */
const STEPS: [number[], PumpInput, boolean][] = [
  [[500, 1, 0.6, 80, 1.5, 1, 0, 4, 0.05, 0.05, 0.6, 0.6, 1, 0], 'stereo', false],
  [[125, 0.8, 1, 10, 0, 1, 1, 4, 0.2, 0.3, -0.5, 0.5, 1, 0.2], 'keyed', true],
  [[60, 1, 0, 500, 10, 1, 0, 3, 0.5, 0.1, 0.9, 1, 1, 0], 'mono', false],
  [[2000, 0.5, 0.4, 40, 3, 1, 1, 4, 0.1, 0, 0, 0.1, 1, -0.9], 'keyed', false],
  [[300, 1, 0.8, 120, 0.04, 0, 0, 4, 0.05, 0.05, 0.6, 0.6, 1, 0], 'stereo', true],
  [[300, 1, 0.8, 120, 2, 1, 0, 2, 0.3, 0.3, 0, 0.7, 0.7, 0], 'none', true],
  [[8000, 0.2, 0.5, 80, 5, 1, 1, 4, 0.9, 0.2, 0.3, 0.95, 0.5, 0.1], 'keyed', true],
  [[5, 1, 0.6, 10, 0, 1, 0, 4, 0.05, 0.05, 0.6, 0.6, 1, 0], 'stereo', false],
];
const CYCLE = STEPS.length * PERIOD;

function probe(): ProbeRun {
  const steps = STEPS.map(([values, input, scope]): PumpChangeStep => ({
    names: NAMES,
    values,
    input,
    scope,
  }));
  const scenarioConfig: PumpChangeConfig = { steps, period: PERIOD, quiet: QUIET };
  return runAllocationProbe(
    {
      bundle: workletBundle('pump-processor.js'),
      rate: 48000,
      params: {},
      options: {},
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: 6 * CYCLE,
      measure: CYCLE,
      scenario: probeScenario('pumpChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('the Pump on V8', () => {
  it('plays, triggers and changes every setting, the shape, the key and the scope without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expectAllocationFree(run, TOLERANCE_BYTES);
  }, 120_000);
});
