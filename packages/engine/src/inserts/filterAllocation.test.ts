/**
 * Worklet rules 2 and 7 for the Filter insert (windsor#622 decision 8),
 * measured on V8 rather than read off the source: once its paths have run,
 * its render allocates nothing, through steady playing, sweeps and changes
 * alike, and no field of the bundle ever changes its representation.
 *
 * Method. As `phaserAllocation.test.ts`: `__fixtures__/workletAllocation.ts`
 * runs the shipped bundle in a Node of its own
 * (`workletAllocationProbe.ts`) with `--expose-gc`, a 64 MB young
 * generation and `--trace-generalization`, here driven by
 * `filterChangeScenario.ts`. The scenario plays a cycle of steps, each a
 * whole setting applied at its first quantum and then held, with a short
 * silence at its end (the rest, then the wake): every mode at both slopes,
 * resonant and open, the mix at both ends and between, the insert switched
 * off and on again, and cutoff sweeps up and down in an SVF mode and in
 * Acid. The input arrives stereo, mono or with no channels. It warms up
 * with the cycle twenty times, the load meter on for the first, then reads
 * `used_heap_size` in ten windows over one more cycle with the meter off,
 * and counts the collections in it, which must be none.
 *
 * Why twenty, where the Phaser warms six: two of the Acid paths run rarely
 * in the cycle, `Ladder.quiet` only in an Acid step's silent tail and
 * `tuneLadder`'s Reso branch only at a step's first quantum, so V8 reaches
 * their optimised code late. With `--trace-opt` after six cycles,
 * `Ladder.quiet` is first compiled inside the measured run, and
 * `tuneLadder`, deoptimised when its Reso branch first ran, is not yet
 * compiled again; until then they box a few doubles a quantum in the Acid
 * steps (20 KB in one measured tenth at six cycles, 6 KB at twelve). From
 * sixteen every tenth reads the same 616 bytes, the readings' own.
 *
 * Tolerance: 16 KiB over the measured quanta, the Phaser's and the EQ's.
 *
 * Representation: a failure is any generalisation from the bundle, or from
 * no named script, that changes a field's representation, at any time in
 * the run (`__fixtures__/generalizationTrace.ts`).
 */
import { describe, expect, it } from 'vitest';
import type {
  FilterChangeConfig,
  FilterChangeStep,
  FilterInput,
} from '../__fixtures__/filterChangeScenario';
import {
  expectAllocationFree,
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';

const TOLERANCE_BYTES = 16 * 1024;
const PERIOD = 120;
const QUIET = 24;
const WARM_CYCLES = 20;

/** The processor's parameters, in the order of each row below. */
const NAMES = ['mode', 'slope24', 'cutoff', 'resonance', 'mix', 'enabled'];

/** One step a row: mode (lowpass 0 … acid 4), slope, cutoff, Reso, mix, on; its input; its sweep. */
const STEPS: [number[], FilterInput, [number, number]?][] = [
  [[0, 0, 18000, 0.707, 1, 1], 'stereo'],
  [[0, 1, 800, 6, 1, 1], 'stereo', [80, 12000]],
  [[1, 0, 300, 2, 0.6, 1], 'mono'],
  [[1, 1, 2000, 9, 1, 1], 'stereo'],
  [[2, 0, 1200, 12, 1, 1], 'none'],
  [[2, 1, 600, 4, 0.3, 1], 'stereo'],
  [[3, 0, 3000, 0.5, 1, 1], 'stereo'],
  [[3, 1, 5000, 3, 0, 1], 'mono'],
  [[4, 0, 500, 0.5, 1, 1], 'stereo'],
  [[4, 1, 900, 10, 0.8, 1], 'stereo', [10000, 40]],
  [[4, 0, 2500, 12, 1, 0], 'stereo'],
  [[0, 0, 150, 8, 1, 1], 'stereo'],
  [[0, 0, 4000, 1, 1, 0], 'mono'],
  [[4, 0, 18000, 6, 1, 1], 'stereo'],
];
const CYCLE = STEPS.length * PERIOD;

function probe(): ProbeRun {
  const steps = STEPS.map(([values, input, sweep]): FilterChangeStep => ({
    names: NAMES,
    values,
    input,
    ...(sweep ? { sweep } : {}),
  }));
  const scenarioConfig: FilterChangeConfig = { steps, period: PERIOD, quiet: QUIET };
  return runAllocationProbe(
    {
      bundle: workletBundle('filter-processor.js'),
      rate: 48000,
      params: {},
      options: {},
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: WARM_CYCLES * CYCLE,
      measure: CYCLE,
      scenario: probeScenario('filterChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('the Filter insert on V8', () => {
  it('plays, sweeps and changes every setting and input without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expectAllocationFree(run, TOLERANCE_BYTES);
  }, 120_000);
});
