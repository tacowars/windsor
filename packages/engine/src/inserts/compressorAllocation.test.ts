/**
 * Worklet rules 2 and 7 for the Compressor (windsor#229), measured on V8
 * rather than read off the source: once its paths have run, its render
 * allocates nothing, through steady playing and parameter changes alike, and
 * no field of the bundle ever changes its representation.
 *
 * Method. As `eqAllocation.test.ts`: `__fixtures__/workletAllocation.ts` runs
 * the shipped bundle in a Node of its own (`workletAllocationProbe.ts`) with
 * `--expose-gc`, a 64 MB young generation and `--trace-generalization`, here
 * driven by `compressorChangeScenario.ts`. The scenario plays a cycle of
 * sixteen steps, each a whole setting applied at its first quantum and then
 * held while the controls glide and settle, with a short silence at its end:
 * every attack, release (Auto included) and ratio, the detector highpass off
 * and on, range down to none, makeup, dry/wet down to dry, bypass, and the
 * external key with a key and without one. The program arrives stereo, mono
 * or with no channels (an inactive source), and the gain-reduction meter is on
 * for about half the steps. It warms up with the cycle six times, the load
 * meter on for the first, then reads `used_heap_size` in ten windows over one
 * more cycle, with the meter off (each reading calls `Date.now()` twice, and
 * V8 returns each as a new heap number, 32 bytes a quantum), and counts the
 * collections in it, which must be none, or the reading means nothing.
 *
 * Tolerance: 16 KiB over the 2 560 measured quanta, the EQ's. The eleven
 * readings' own result objects take about 600 bytes each. Before this fix the
 * render boxed five doubles a sample, about 10 KB a quantum in Node
 * (`docs/research/2026-09-30-load-sampler-allocation/`), which would read
 * about 26 MB here.
 *
 * Representation: a failure is any generalisation from the bundle, or from no
 * named script, that changes a field's representation (`s`, `d`, `h`, `t`),
 * at any time in the run (`__fixtures__/generalizationTrace.ts`).
 *
 * What this does not cover: the first runs of a path V8 has not optimised yet,
 * which box, as the EQ's research README describes.
 */
import { describe, expect, it } from 'vitest';
import type {
  CompressorChangeConfig,
  CompressorChangeStep,
  CompressorInput,
} from '../__fixtures__/compressorChangeScenario';
import {
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
  'threshold',
  'makeup',
  'attack',
  'ratio',
  'release',
  'highpass',
  'range',
  'mix',
  'enabled',
  'external',
];

/** One step a row: its parameter values, its input and whether the meter is on. */
const STEPS: [number[], CompressorInput, boolean][] = [
  [[-12, 0, 10, 4, 0, 0, 60, 1, 1, 0], 'stereo', false],
  [[-31.5, 4.5, 0.01, 10, 0.1, 0, 60, 1, 1, 0], 'stereo', true],
  [[-20, 0, 0.1, 2, 0.2, 120, 24, 1, 1, 0], 'stereo', true],
  [[-8, 12, 0.3, 4, 0.4, 650, 9.5, 0.35, 1, 0], 'mono', false],
  [[-40, 24, 1, 10, 0.6, 0, 60, 1, 1, 1], 'keyed', true],
  [[-25, 3, 3, 2, 0.8, 90, 3, 0.5, 1, 1], 'keyed', false],
  [[-12, 0, 30, 4, 1.2, 0, 0, 1, 1, 0], 'stereo', true],
  [[-18, 6, 10, 4, 0, 250, 60, 0, 1, 0], 'stereo', false],
  [[-18, 6, 0.01, 10, 0, 0, 60, 1, 0, 0], 'stereo', true],
  [[-30, 2, 0.1, 4, 0.2, 0, 60, 1, 1, 1], 'stereo', false],
  [[-12, 0, 1, 2, 0, 1000, 40, 0.75, 1, 0], 'none', true],
  [[-36, 9, 0.3, 10, 0.1, 0, 60, 1, 1, 0], 'stereo', false],
  [[-6, 0, 3, 4, 1.2, 40, 12, 1, 1, 1], 'keyed', true],
  [[-22, 1.5, 30, 2, 0.4, 0, 60, 0.2, 1, 0], 'mono', true],
  [[-40, 0, 0.01, 10, 0, 0, 60, 1, 1, 0], 'stereo', false],
  [[-15, 3, 10, 4, 0.8, 300, 20, 1, 1, 0], 'stereo', true],
];
const CYCLE = STEPS.length * PERIOD;

function probe(): ProbeRun {
  const steps = STEPS.map(([values, input, meter]): CompressorChangeStep => ({
    names: NAMES,
    values,
    input,
    meter,
  }));
  const scenarioConfig: CompressorChangeConfig = { steps, period: PERIOD, quiet: QUIET };
  return runAllocationProbe(
    {
      bundle: workletBundle('compressor-processor.js'),
      rate: 48000,
      params: {},
      options: {},
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: 6 * CYCLE,
      measure: CYCLE,
      scenario: probeScenario('compressorChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('the Compressor on V8', () => {
  it('plays and changes every setting, input and the meter without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(run.bytes, `by tenths: ${run.windows.join(' ')}`).toBeLessThan(TOLERANCE_BYTES);
  }, 120_000);
});
