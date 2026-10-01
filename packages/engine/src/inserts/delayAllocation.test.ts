/**
 * Worklet rules 2 and 7 for the Dub delay (windsor#232), measured on V8
 * rather than read off the source: once its paths have run, its render
 * allocates nothing, through steady playing, parameter and tempo changes
 * alike, and no field of the bundle ever changes its representation.
 *
 * Method. As `eqAllocation.test.ts`: `__fixtures__/workletAllocation.ts` runs
 * the shipped bundle in a Node of its own (`workletAllocationProbe.ts`) with
 * `--expose-gc`, a 64 MB young generation and `--trace-generalization`, here
 * driven by `delayChangeScenario.ts`. The scenario plays a cycle of sixteen
 * steps, each a whole setting applied at its first quantum and then held while
 * the controls glide, with a short silence at its end: every mode, the insert
 * switched off and on, feedback from none to past unity, the filters, drive,
 * mix and output at their bounds, free and synced times from 1 ms to the
 * 12-second clamp, and song tempo changes alone (new `leftMs` and `rightMs`,
 * as `tempoInsertRegistry.ts` writes them). The input is stereo, mono or has
 * no channels (an inactive source). It warms up with the cycle four times, the
 * load meter on for the first, then reads `used_heap_size` in ten windows over
 * one more cycle, with the meter off (each reading calls `Date.now()` twice,
 * and V8 returns each as a new heap number, 32 bytes a quantum), and counts
 * the collections in it, which must be none, or the reading means nothing.
 *
 * Tolerance: 16 KiB over the 2 560 measured quanta, the EQ's. The eleven
 * readings' own result objects take about 600 bytes each. Before this fix the
 * render boxed about 6 KB a quantum in Node
 * (`docs/research/2026-09-30-load-sampler-allocation/`), which would read
 * about 19 MB here.
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
  DelayChangeConfig,
  DelayChangeStep,
  DelayInput,
} from '../__fixtures__/delayChangeScenario';
import {
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';
import { DELAY_MODE_IDS } from './delayConstants';
import { DEFAULT_DELAY, DELAY_NUMBERS, delayMilliseconds } from './delaySpec';
import type { DelaySpec } from './delaySpec';

const TOLERANCE_BYTES = 16 * 1024;
const PERIOD = 160;
const QUIET = 32;

/** One step a row: the settings over the defaults, the song tempo and the input. */
const STEPS: [Partial<DelaySpec>, number, DelayInput][] = [
  [{}, 120, 'stereo'],
  [{}, 96, 'stereo'],
  [{ mode: 'ping-pong', feedback: 0.8 }, 140, 'mono'],
  [{ mode: 'ping-pong', feedback: 0.8 }, 174, 'mono'],
  [{ mode: 'mid-side', highpass: 400, lowpass: 3000, drive: 12 }, 110, 'stereo'],
  [{ mode: 'mid-side', highpass: 400, lowpass: 3000, drive: 12 }, 60, 'none'],
  [{ enabled: false }, 120, 'stereo'],
  [{ feedback: 1.2, drive: 24, leftDivision: '1/16' }, 128, 'stereo'],
  [{ leftSync: false, rightSync: false, leftMs: 1, rightMs: 8000 }, 128, 'mono'],
  [{ mix: 0, outputDb: -24 }, 90, 'stereo'],
  [{ mix: 1, outputDb: 12, highpass: 4000, lowpass: 200 }, 90, 'stereo'],
  [{ leftDivision: '1/1', rightDivision: '1/1' }, 20, 'stereo'],
  [{ leftDivision: '1/32T', rightDivision: '1/32' }, 200, 'mono'],
  [{ feedback: 0 }, 150, 'none'],
  [{ mode: 'ping-pong', enabled: false }, 150, 'stereo'],
  [{ mode: 'mid-side', feedback: 1.05, highpass: 20, lowpass: 20000 }, 132, 'stereo'],
];
const CYCLE = STEPS.length * PERIOD;

/** A step's parameter values, as `delayInsert.ts` writes them. */
function step([partial, bpm, input]: (typeof STEPS)[number]): DelayChangeStep {
  const spec: DelaySpec = { ...DEFAULT_DELAY, ...partial };
  const values: Record<string, number> = {
    mode: DELAY_MODE_IDS[spec.mode],
    enabled: Number(spec.enabled),
  };
  for (const name of DELAY_NUMBERS) values[name] = spec[name];
  values.leftMs = delayMilliseconds(spec, 'left', bpm);
  values.rightMs = delayMilliseconds(spec, 'right', bpm);
  return { names: Object.keys(values), values: Object.values(values), input };
}

function probe(): ProbeRun {
  const scenarioConfig: DelayChangeConfig = {
    steps: STEPS.map(step),
    period: PERIOD,
    quiet: QUIET,
  };
  return runAllocationProbe(
    {
      bundle: workletBundle('delay-processor.js'),
      rate: 48000,
      params: {},
      options: {},
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: 4 * CYCLE,
      measure: CYCLE,
      scenario: probeScenario('delayChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('the Dub delay on V8', () => {
  it('plays and changes every mode, setting, tempo and input without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(run.bytes, `by tenths: ${run.windows.join(' ')}`).toBeLessThan(TOLERANCE_BYTES);
  }, 120_000);
});
