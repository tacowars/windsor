/**
 * Worklet rules 2 and 7 for bloom, checked on V8 rather than read off the
 * source: once its paths have run, it renders, changes every control (the
 * switch included), sleeps, wakes, and takes
 * mono and absent input without allocating, and no field of the bundle ever
 * changes its representation.
 *
 * Method, as `filterAllocation.test.ts`: a child Node runs the shipped
 * bundle (`__fixtures__/workletAllocationProbe.ts`, driven by
 * `bloomChangeScenario.ts`) with `--expose-gc` and
 * `--trace-generalization`. A cycle is 512 quanta of stereo noise (which
 * sounds every band) with a control change every 16, then silence until
 * bloom sleeps, 64 quanta asleep, 64 of mono noise (which wakes it) and 64 of
 * no input. The child warms for 48 000 quanta, then reads the heap in ten
 * windows across 8 000. The scenario throws unless the measured run took
 * every path.
 *
 * Tolerance: 16 KiB over the 8 000 quanta; one boxed double a quantum would
 * read 128 KB.
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**
import { describe, expect, it } from 'vitest';
import type { BloomChangeConfig } from '../__fixtures__/bloomChangeScenario';
import {
  expectAllocationFree,
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';

const TOLERANCE_BYTES = 16 * 1024;

describe('bloom on V8', () => {
  it('renders, changes every control, sleeps, wakes and takes mono and absent input for 8 000 quanta without allocating or changing a field representation', () => {
    const scenarioConfig: BloomChangeConfig = { period: 16, loud: 512, inputs: 64 };
    const run = runAllocationProbe(
      {
        bundle: workletBundle('bloom-processor.js'),
        rate: 48000,
        params: {},
        options: {},
        messages: [],
        inputChannels: 2,
        loadQuanta: 0,
        warmup: 48000,
        measure: 8000,
        scenario: probeScenario('bloomChangeScenario.ts'),
        scenarioConfig,
      },
      SYNCHRONOUS_TIERING,
    );
    expect(run.changes).toEqual([]);
    expectAllocationFree(run, TOLERANCE_BYTES);
  }, 300_000);
});
