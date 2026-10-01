/**
 * Worklet rules 2 and 7 for the Phaser (windsor#231), measured on V8 rather
 * than read off the source: once its paths have run, its render allocates
 * nothing, through steady playing and parameter changes alike, and no field
 * of the bundle ever changes its representation.
 *
 * Method. As `eqAllocation.test.ts`: `__fixtures__/workletAllocation.ts` runs
 * the shipped bundle in a Node of its own (`workletAllocationProbe.ts`) with
 * `--expose-gc`, a 64 MB young generation and `--trace-generalization`, here
 * driven by `phaserChangeScenario.ts`. The scenario plays a cycle of twelve
 * steps, each a whole setting applied at its first quantum and then held
 * while the controls glide and settle, with a short silence at its end:
 * slow and fast sweeps, low and high centres, depth down to none, feedback of
 * both signs and none, the feedback cut, stereo spread, envelope of both
 * signs, bass keep, dry/wet down to dry, and the insert switched off. The
 * input arrives stereo, mono or with no channels (an inactive source). It
 * warms up with the cycle six times, the load meter on for the first, then
 * reads `used_heap_size` in ten windows over one more cycle, with the meter
 * off (each reading calls `Date.now()` twice, and V8 returns each as a new
 * heap number, 32 bytes a quantum), and counts the collections in it, which
 * must be none, or the reading means nothing.
 *
 * Tolerance: 16 KiB over the 1 920 measured quanta, the EQ's. The eleven
 * readings' own result objects take about 600 bytes each. Before this fix the
 * render boxed about 8 KB a quantum in Node
 * (`docs/research/2026-09-30-load-sampler-allocation/`), which would read
 * about 16 MB here.
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
  PhaserChangeConfig,
  PhaserChangeStep,
  PhaserInput,
} from '../__fixtures__/phaserChangeScenario';
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
  'rate',
  'center',
  'depth',
  'feedback',
  'feedbackCut',
  'stereo',
  'envelope',
  'bassKeep',
  'mix',
  'enabled',
];

/** One step a row: its parameter values and its input. */
const STEPS: [number[], PhaserInput][] = [
  [[0.2, 900, 2, 0.25, 350, 0, 0, 0, 0.5, 1], 'stereo'],
  [[8, 4000, 4, 0.9, 2000, 180, 4, 1, 1, 1], 'stereo'],
  [[0.01, 80, 0, -0.9, 20, 90, -4, 0.5, 0.75, 1], 'stereo'],
  [[1.5, 600, 1.5, 0, 500, 45, 1.5, 0.25, 0.5, 1], 'mono'],
  [[3, 2000, 3, 0.6, 1200, 120, -2, 0, 1, 1], 'none'],
  [[0.5, 300, 2.5, -0.4, 100, 30, 3, 0.8, 0, 1], 'stereo'],
  [[2, 1200, 1, 0.7, 800, 60, 0, 0, 0.6, 0], 'stereo'],
  [[0.8, 450, 2, -0.7, 250, 150, -1, 0.3, 0.9, 1], 'mono'],
  [[5, 3000, 3.5, 0.45, 1600, 180, 2.5, 1, 0.4, 1], 'stereo'],
  [[0.1, 150, 0.5, 0.85, 60, 10, -3.5, 0.6, 0.8, 1], 'stereo'],
  [[4, 2500, 2, -0.2, 900, 75, 0.5, 0.1, 0.3, 1], 'none'],
  [[0.3, 700, 1.25, 0.3, 400, 20, 1, 0.4, 0.7, 1], 'stereo'],
];
const CYCLE = STEPS.length * PERIOD;

function probe(): ProbeRun {
  const steps = STEPS.map(([values, input]): PhaserChangeStep => ({
    names: NAMES,
    values,
    input,
  }));
  const scenarioConfig: PhaserChangeConfig = { steps, period: PERIOD, quiet: QUIET };
  return runAllocationProbe(
    {
      bundle: workletBundle('phaser-processor.js'),
      rate: 48000,
      params: {},
      options: {},
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: 6 * CYCLE,
      measure: CYCLE,
      scenario: probeScenario('phaserChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('the Phaser on V8', () => {
  it('plays and changes every setting and input without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(run.bytes, `by tenths: ${run.windows.join(' ')}`).toBeLessThan(TOLERANCE_BYTES);
  }, 120_000);
});
