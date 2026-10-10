/**
 * Worklet rules 2 and 7 for the Retro reverb (windsor#230), measured on V8
 * rather than read off the source: once its paths have run, it renders,
 * changes every parameter, fades its finite field in and out, runs its tail
 * down to silence and takes mono and absent input without allocating, and no
 * field of the bundle ever changes its representation.
 *
 * Method, as `inserts/eqAllocation.test.ts`: a heap reading inside Vitest is
 * not repeatable (the runner shares the heap), so the test spawns a Node of
 * its own that runs the shipped bundle (`__fixtures__/workletAllocationProbe.ts`,
 * driven by `retroReverbChangeScenario.ts`) with `--expose-gc`, a 64 MB young
 * generation and `--trace-generalization`. A cycle is 512 quanta of stereo
 * noise with a parameter change every 8 (size, decay, tone, diffusion, drift
 * depth and rate, pre-delay, character, mix, duration, early, gated and
 * reverse, the enable), then
 * silence at a short decay until the tail is exact zeros, the finite field has
 * faded, the pre-delay is off and the mix has settled (about 520 quanta), then
 * 64 quanta of mono noise and 64 of no input: about 1 160 quanta. The child
 * warms for 48 000 quanta (the load meter reporting for the first half),
 * forces two collections, then reads `used_heap_size` in ten windows across
 * 8 000 quanta with the meter off (it calls Date.now() twice a quantum, and V8
 * returns each as a new heap number:
 * `docs/research/2026-09-30-load-sampler-allocation/README.md`). The scenario
 * throws, failing the child, unless the measured run took every path.
 *
 * Tolerance: 16 KiB over the 8 000 quanta; one boxed double a quantum would
 * read 128 KB. Before this fix the reverb passed its samples to and returned
 * them from calls V8 did not inline (the processor's two inputs to `tick`, the
 * internal clock's input, the delay lines' reads, the filters' and the
 * converter's results), and first wrote 17 double fields as 0 or 1 (`phase`,
 * `heldLeft`, `finite`, the tank's `size` and `pole`, …): the run read about
 * 4.8 KB a quantum and those 17 representation changes.
 */
import { describe, expect, it } from 'vitest';
import type { RetroReverbChangeConfig } from '../__fixtures__/retroReverbChangeScenario';
import {
  expectAllocationFree,
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';
import { RETRO_REVERB_DSP } from './retroReverbConstants';

const TOLERANCE_BYTES = 16 * 1024;

function probe(): ProbeRun {
  const scenarioConfig: RetroReverbChangeConfig = {
    period: 8,
    loud: 512,
    inputs: 64,
    quietDecay: 0.2,
    floor: RETRO_REVERB_DSP.silenceFloor,
    internalRate: RETRO_REVERB_DSP.rate,
  };
  return runAllocationProbe(
    {
      bundle: workletBundle('retro-reverb-processor.js'),
      rate: 48000,
      params: {},
      options: {},
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: 48000,
      measure: 8000,
      scenario: probeScenario('retroReverbChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('the Retro reverb on V8', () => {
  it('renders, changes every parameter, decays to silence and takes mono and absent input for 8 000 quanta without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expectAllocationFree(run, TOLERANCE_BYTES);
  }, 120_000);
});
