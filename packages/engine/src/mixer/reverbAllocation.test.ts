/**
 * Worklet rules 2 and 7 for the plate (windsor#227), measured on V8 rather
 * than read off the source: once its paths have run, the plate renders,
 * changes every parameter, sleeps and wakes without allocating, and no field
 * of the bundle ever changes its representation.
 *
 * Method, as `inserts/eqAllocation.test.ts`: a heap reading inside Vitest is
 * not repeatable (the runner shares the heap), so the test spawns a Node of
 * its own that runs the shipped bundle (`__fixtures__/workletAllocationProbe.ts`,
 * driven by `reverbChangeScenario.ts`) with `--expose-gc`, a 64 MB young
 * generation and `--trace-generalization`. The scenario cycles noise with a
 * parameter change every 8 quanta (a SIZE glide each way, HOLD on and off,
 * decay, filters, modulation, pre-delay, diffusions, wet and dry), then
 * silence until the plate sleeps, and noise again to wake it; a cycle runs
 * 2 000 to 6 500 quanta, as the tail's length varies. The child warms for
 * 48 000 quanta (the load meter reporting for the first half), forces two
 * collections, then reads
 * `used_heap_size` in ten windows across 8 000 quanta, with the meter off
 * (it calls Date.now() twice a quantum, and V8 returns each as a new heap
 * number: `docs/research/2026-09-30-load-sampler-allocation/README.md`). The
 * scenario throws, failing the child, unless the measured run glided,
 * settled, held, slept and woke.
 *
 * Tolerance: 16 KiB over the 8 000 quanta. The run reads 6 784 bytes, every
 * run alike: each reading's own result object, about 600 bytes. Before this
 * fix the plate boxed about twenty doubles a sample, a read's result or a
 * cubic read's offset crossing a call V8 did not inline, 41 KB a quantum: the
 * run collected three times and read 6 fields generalised (`_size`,
 * `_inputGain`, `_inputLp`, `_inputHp`, `_excPhase`, `_excPhase2`, each first
 * written as 0 or 1).
 *
 * With a 16 000-quantum warm-up the same run reads 3 to 5 KB in the windows
 * around each sleep and wake: V8 is still tiering up the paths taken once a
 * cycle (`process` and `_renderAsleep` were Maglev code at the start of the
 * measured run, and `_render` reached TurboFan during it, by
 * `%GetOptimizationStatus`), and its lower tiers box. The source cannot
 * remove that; the longer warm-up measures the plate once it is hot.
 */
import { describe, expect, it } from 'vitest';
import type { ReverbChangeConfig } from '../__fixtures__/reverbChangeScenario';
import {
  probeScenario,
  runAllocationProbe,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';

const TOLERANCE_BYTES = 16 * 1024;

function probe(): ProbeRun {
  const scenarioConfig: ReverbChangeConfig = { period: 8, loud: 512, asleep: 64, quietDecay: 0.3 };
  return runAllocationProbe({
    bundle: workletBundle('reverb-processor.js'),
    rate: 48000,
    params: {},
    options: {},
    messages: [],
    inputChannels: 2,
    loadQuanta: 0,
    warmup: 48000,
    measure: 8000,
    scenario: probeScenario('reverbChangeScenario.ts'),
    scenarioConfig,
  });
}

describe('the plate on V8', () => {
  it('renders, changes every parameter, sleeps and wakes for 8 000 quanta without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(run.bytes, `by tenths: ${run.windows.join(' ')}`).toBeLessThan(TOLERANCE_BYTES);
  }, 120_000);
});
