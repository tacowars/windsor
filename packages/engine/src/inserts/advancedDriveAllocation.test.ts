/**
 * Worklet rules 2 and 7 for Advanced Drive (windsor#226), measured on V8
 * rather than read off the source: once its paths have run, its render
 * allocates nothing, through steady playing and parameter changes alike, and
 * no field of the bundle ever changes its representation.
 *
 * Method. As `eqAllocation.test.ts`: `__fixtures__/workletAllocation.ts` runs
 * the shipped bundle in a Node of its own (`workletAllocationProbe.ts`) with
 * `--expose-gc`, a 64 MB young generation and `--trace-generalization`, here
 * driven by `advancedDriveChangeScenario.ts`. The scenario plays a cycle of
 * twenty steps, each a whole new setting (every route, shaper, filter and LFO
 * wave, sync on and off, stages, shaping, filtering and the insert switched
 * off and on, modulation into every stage), applied at the step's first
 * quantum and then held while the controls glide and settle, with a short
 * silence at its end. It warms up with the cycle three times, the load meter
 * on for the first, then reads `used_heap_size` in ten windows over one more
 * cycle, with the meter off (each reading calls `Date.now()` twice, and V8
 * returns each as a new heap number, 32 bytes a quantum), and counts the
 * collections in it, which must be none, or the reading means nothing.
 *
 * Tolerance: 16 KiB over the 7 680 measured quanta, the EQ's. The eleven
 * readings' own result objects take about 600 bytes each. Before this fix the
 * render boxed about 100 KB a quantum (`docs/research/2026-09-30-load-sampler-allocation/`),
 * and one double boxed per sample would read about 15 MB.
 *
 * Representation: a failure is any generalisation from the bundle, or from no
 * named script, that changes a field's representation (`s`, `d`, `h`, `t`),
 * at any time in the run (`__fixtures__/generalizationTrace.ts`). Before this
 * fix the run traced 42: the drive's doubles first written as small integers,
 * and `DriveFilter`'s fields defined as `undefined` first.
 *
 * What this does not cover: the first runs of a path V8 has not optimised yet,
 * which box, as the EQ's research README describes.
 */
import { describe, expect, it } from 'vitest';
import {
  probeScenario,
  runAllocationProbe,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';
import type {
  DriveChangeConfig,
  DriveChangeStep,
} from '../__fixtures__/advancedDriveChangeScenario';
import {
  DRIVE_FILTERS,
  DRIVE_LFO_SHAPES,
  DRIVE_ROUTES,
  DRIVE_SHAPERS,
} from './advancedDriveConstants';
import { advancedDriveParameters } from './advancedDriveParameters';
import { DEFAULT_ADVANCED_DRIVE, DEFAULT_DRIVE_STAGE } from './advancedDriveSpec';
import type { AdvancedDriveSpec, DriveStageSpec } from './advancedDriveSpec';

const TOLERANCE_BYTES = 16 * 1024;
const STEPS = 20;
const PERIOD = 384;
const QUIET = 16;
const CYCLE = STEPS * PERIOD;

/** Stage `s` of step `i`: every shaper and filter in turn, and each switch off now and then. */
function stage(i: number, s: number): DriveStageSpec {
  const n = i + s,
    odd = n % 2 === 1;
  return {
    ...DEFAULT_DRIVE_STAGE,
    shaper: DRIVE_SHAPERS[n % DRIVE_SHAPERS.length]!,
    filter: DRIVE_FILTERS[(i + 2 * s) % DRIVE_FILTERS.length]!,
    enabled: n % 7 !== 6,
    shaping: n % 9 !== 8,
    filtering: !odd,
    pre: n % 4 >= 2,
    amount: n % 6 === 5 ? 0 : 0.15 + 0.1 * (n % 5),
    bias: odd ? -0.2 : 0.15,
    level: odd ? -3 : 1.5,
    frequency: odd ? 1500 : 4200,
    resonance: odd ? 0.8 : 3,
    peak: odd ? 5 : -4,
    envAmount: odd ? 0.3 : -0.2,
    envBias: odd ? 0.1 : -0.1,
    envCutoff: odd ? 1.5 : -1,
    lfoAmount: odd ? -0.3 : 0.25,
    lfoBias: odd ? 0.2 : -0.05,
    lfoCutoff: odd ? -0.5 : 2,
  };
}

/** Step `i`: a whole setting, every route and wave in turn. */
function step(i: number): DriveChangeStep {
  const odd = i % 2 === 1;
  const spec: AdvancedDriveSpec = {
    ...DEFAULT_ADVANCED_DRIVE,
    route: DRIVE_ROUTES[i % DRIVE_ROUTES.length]!,
    wave: DRIVE_LFO_SHAPES[Math.floor(i / 2) % DRIVE_LFO_SHAPES.length]!,
    division: odd ? '1/8D' : '1/4',
    sync: i % 4 >= 2,
    enabled: i % 10 !== 9,
    compensation: i % 3 !== 2,
    drive: odd ? 9.5 : 3.25,
    tone: odd ? -4.5 : 6,
    pivot: odd ? 900 : 1400,
    output: odd ? -2.5 : 0,
    mix: odd ? 0.75 : 1,
    blend: odd ? 0.35 : 0.65,
    low: odd ? 180 : 260,
    high: odd ? 2400 : 3100,
    rate: odd ? 0.7 : 3.3,
    attack: odd ? 5 : 20,
    release: odd ? 60 : 150,
    sensitivity: odd ? 6 : 0,
    stages: [0, 1, 2].map((s) => stage(i, s)),
  };
  const values = advancedDriveParameters(spec, odd ? 96 : 132);
  return { names: Object.keys(values), values: Object.values(values) };
}

function probe(): ProbeRun {
  const scenarioConfig: DriveChangeConfig = {
    steps: Array.from({ length: STEPS }, (_, i) => step(i)),
    period: PERIOD,
    quiet: QUIET,
  };
  return runAllocationProbe({
    bundle: workletBundle('advanced-drive-processor.js'),
    rate: 48000,
    params: {},
    options: {},
    messages: [],
    inputChannels: 2,
    loadQuanta: 0,
    warmup: 3 * CYCLE,
    measure: CYCLE,
    scenario: probeScenario('advancedDriveChangeScenario.ts'),
    scenarioConfig,
  });
}

describe('Advanced Drive on V8', () => {
  it('plays and changes every route, shaper and filter without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(run.bytes, `by tenths: ${run.windows.join(' ')}`).toBeLessThan(TOLERANCE_BYTES);
  }, 120_000);
});
