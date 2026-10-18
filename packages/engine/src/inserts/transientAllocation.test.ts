/**
 * Worklet rules 2 and 7 for the Transient (record
 * `2026-10-18-transient-insert`), measured on V8 as
 * `compressorAllocation.test.ts` measures the compressor: once its paths
 * have run, its render allocates nothing through playing, every control
 * moving, the switch going off and on, the input arriving stereo, mono or
 * with no channels, the meter, and the sleep and the wake each step's
 * silence brings, and no field of the bundle ever changes its representation.
 * The heap is read with the meter off for the last step: a meter post is a
 * structured clone, which only an open card pays for.
 *
 * The run's timing row is a fast one (`processorOptions.timing`, the tests'
 * door), so each step's closing silence is long enough to sleep: the shipped
 * row's tail is seconds long. The rows differ only in their poles and the
 * window's length, which take the same code.
 *
 * Tolerance: 16 KiB over the measured quanta, the compressor's.
 */
import { describe, expect, it } from 'vitest';
import type {
  TransientChangeConfig,
  TransientChangeStep,
  TransientInput,
} from '../__fixtures__/transientChangeScenario';
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
const QUIET = 48;
/** A fast row: its tail, 2 ms × ln(1/floor) and the window, is about 20 quanta. */
const TIMING = { holdMs: 2, fReleaseMs: 1, aAttackMs: 2, sReleaseMs: 2 };

/** The processor's parameters, in the order of each row below. */
const NAMES = ['attack', 'sustain', 'output', 'mix', 'enabled'];

/** One step a row: its parameter values, its input and whether the meter is on. */
const STEPS: [number[], TransientInput, boolean][] = [
  [[0, 0, 0, 1, 1], 'stereo', false],
  [[15, 0, 0, 1, 1], 'stereo', true],
  [[-15, 24, 6, 1, 1], 'mono', true],
  [[10, -12, -3, 0.5, 1], 'stereo', false],
  [[-8, 12, -20, 0, 1], 'none', true],
  [[15, -24, 0, 1, 0], 'stereo', true],
  [[0, -24, 6, 0.8, 1], 'stereo', true],
  [[-15, -24, -20, 0.25, 1], 'mono', false],
  [[12.5, 20.5, 1.5, 0.7, 1], 'stereo', false],
];
const CYCLE = STEPS.length * PERIOD;

function probe(): ProbeRun {
  const steps = STEPS.map(([values, input, meter]): TransientChangeStep => ({
    names: NAMES,
    values,
    input,
    meter,
  }));
  const scenarioConfig: TransientChangeConfig = { steps, period: PERIOD, quiet: QUIET };
  return runAllocationProbe(
    {
      bundle: workletBundle('transient-processor.js'),
      rate: 48000,
      params: {},
      options: { timing: TIMING },
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: 6 * CYCLE,
      measure: CYCLE,
      scenario: probeScenario('transientChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('the Transient on V8', () => {
  it('plays, sleeps, wakes and changes every setting, the switch, the input and the meter without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expectAllocationFree(run, TOLERANCE_BYTES);
  }, 120_000);
});
