/**
 * Worklet rules 2 and 7 for Tape (windsor#228), measured on V8 rather than
 * read off the source: once its paths have run, its render allocates
 * nothing, at 2x and at 4x, through a live switch between them, Mix and
 * bypass, and its parameter changes, and no field of the bundle ever changes
 * its representation.
 *
 * Method. As `eqAllocation.test.ts`: `__fixtures__/workletAllocation.ts` runs
 * the shipped bundle in a Node of its own (`workletAllocationProbe.ts`) with
 * `--expose-gc`, a 64 MB young generation and `--trace-generalization`, and
 * V8 compiling on the main thread (`SYNCHRONOUS_TIERING`), so the tier the
 * render has reached when the heap is read does not depend on the machine's
 * load. Three runs:
 *
 * - The steady render at the defaults, stereo noise in, at 2x and at 4x: the
 *   research's single-insert scenario (`b-tape`) in Node, warmed for 32 000
 *   quanta.
 * - `tapeChangeScenario.ts`'s cycle of twelve steps, each a whole setting
 *   applied at its first quantum and then held while the controls glide and
 *   settle, with a short silence at its end: the core switched between 2x
 *   and 4x (both ways, and with the insert off), every model, Drive across
 *   its range, Bias, the Wear macro and the split dials (wow, flutter and
 *   dropouts up to 100), both rates, hiss above its floor and at it, trim,
 *   a new seed, Mix down to dry and the insert switched off and on. The
 *   input arrives stereo, mono or with no channels (an inactive source). It
 *   warms up with the cycle twelve times, the load meter on for the first:
 *   after six, V8 compiled the block's `configure` to its top tier inside
 *   the measured cycle, whose code read about 3.5 KB in one window.
 *
 * Each reads `used_heap_size` in ten windows over its measured run with the
 * load meter off (each reading calls `Date.now()` twice, and V8 returns each
 * as a new heap number, 32 bytes a quantum), and counts the collections in
 * it, which must be none, or the reading means nothing.
 *
 * Tolerance: 16 KiB over each measured run, the EQ's. The eleven readings'
 * own result objects take 616 bytes each, and each run reads 6 160 bytes,
 * those alone. Before this fix the steady render read 14 339 bytes a quantum
 * at either factor (11.47 MB in each window of 800 quanta), and its trace
 * named 49 representation changes: seven heap numbers a sample, from the
 * samples passed to and returned from `tick` and `channel`, and from
 * `left?.[i] ?? 0`, a sample or undefined, which V8 holds boxed. After the
 * render's own, the cycle found three paths that allocate only on a change:
 * the controls read by a store keyed by name (a boxed value a control a
 * block), the dropout roll and a factor switch's reconfiguration, both too
 * rare for V8 to optimise, so run in its lower tiers.
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
  TapeChangeConfig,
  TapeChangeStep,
  TapeInput,
} from '../__fixtures__/tapeChangeScenario';
import {
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';
import type { ProbeConfig } from '../__fixtures__/workletAllocationProbe';

const TOLERANCE_BYTES = 16 * 1024;
const PERIOD = 160;
const QUIET = 16;
/**
 * The steady runs' warm-up: with 16 000 quanta, V8 compiled the block's
 * `configure` paths to their top tier inside the measured run at 4x, whose
 * code read about 11 KB in one window.
 */
const STEADY_WARMUP = 32000;
const STEADY_MEASURE = 8000;

/** The processor's parameters, in the order of each row below. */
const NAMES = [
  'oversampling',
  'model',
  'drive',
  'bias',
  'wear',
  'split',
  'wow',
  'flutter',
  'dropouts',
  'wowRate',
  'flutterRate',
  'hiss',
  'trim',
  'mix',
  'seed',
  'enabled',
];

/** One step a row: its parameter values and its input. */
const STEPS: [number[], TapeInput][] = [
  [[2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 7, -70, 0, 1, 1, 1], 'stereo'],
  [[4, 0, 0, 0, 0, 0, 0, 0, 0, 1, 7, -70, 0, 1, 1, 1], 'stereo'],
  [[4, 1, 12.5, 40, 60, 0, 0, 0, 0, 1, 7, -40, -3.5, 1, 1, 1], 'stereo'],
  [[2, 2, -8.3, -70, 60, 1, 30, 70, 100, 0.3, 12, -20, 6, 0.6, 1, 1], 'mono'],
  [[4, 6, 32, 15, 0, 1, 100, 10, 50, 2.5, 19, -55, 0, 0, 1, 1], 'stereo'],
  [[2, 6, 32, 15, 0, 1, 100, 10, 50, 2.5, 19, -55, 0, 1, 1, 0], 'stereo'],
  [[4, 3, 20, 15, 100, 0, 0, 0, 0, 0.05, 1, -30, 0, 1, 12345, 0], 'none'],
  [[4, 3, 20, 15, 100, 0, 0, 0, 0, 0.05, 1, -30, 0, 1, 12345, 1], 'stereo'],
  [[2, 4, -32, 100, 35, 0, 0, 0, 0, 3, 20, -16, -24, 0.3, 777, 1], 'stereo'],
  [[2, 5, 4.4, -100, 0, 1, 5, 5, 5, 1, 7, -70, 24, 1, 777, 1], 'none'],
  [[4, 0, 5.5, 0, 0, 1, 50, 50, 0, 0.7, 4, -65, 0, 0.9, 1, 1], 'mono'],
  [[2, 1, 3.3, 10, 20, 0, 0, 0, 0, 1, 7, -70, 0, 1, 1, 1], 'stereo'],
];
const CYCLE = STEPS.length * PERIOD;

function base(): Omit<ProbeConfig, 'warmup' | 'measure'> {
  return {
    bundle: workletBundle('tape-processor.js'),
    rate: 48000,
    params: {},
    options: {},
    messages: [],
    inputChannels: 2,
    loadQuanta: 0,
  };
}

function run(scenarioConfig: TapeChangeConfig, warmup: number, measure: number): ProbeRun {
  return runAllocationProbe(
    {
      ...base(),
      warmup,
      measure,
      scenario: probeScenario('tapeChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

/**
 * One step held throughout, no silence: the probe's steady render, through
 * the scenario so that the warm-up ends with its heap reads (the probe's own
 * code for them read about 7 KB in the eighth window without them).
 */
function steady(oversampling: number): ProbeRun {
  const step: TapeChangeStep = { names: ['oversampling'], values: [oversampling], input: 'stereo' };
  return run({ steps: [step], period: PERIOD, quiet: 0 }, STEADY_WARMUP, STEADY_MEASURE);
}

function changes(): ProbeRun {
  const steps = STEPS.map(([values, input]): TapeChangeStep => ({ names: NAMES, values, input }));
  return run({ steps, period: PERIOD, quiet: QUIET }, 12 * CYCLE, CYCLE);
}

function expectClean(run: ProbeRun): void {
  expect(run.changes).toEqual([]);
  expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
  expect(run.bytes, `by tenths: ${run.windows.join(' ')}`).toBeLessThan(TOLERANCE_BYTES);
}

describe('Tape on V8', () => {
  it.each([2, 4])(
    'plays its defaults at %dx for 8 000 quanta without allocating or changing a field representation',
    (factor) => {
      expectClean(steady(factor));
    },
    120_000,
  );

  it('switches 2x and 4x, Mix, bypass and every setting and input without allocating or changing a field representation', () => {
    expectClean(changes());
  }, 240_000);
});
