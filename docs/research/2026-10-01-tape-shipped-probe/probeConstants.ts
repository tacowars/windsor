/** Declared windsor#250 experiment, fixed before measurement: part 1's guard (c) and slew
 * (e) matrices through the shipped TapeDsp source, and part 2's cost cells for the shipped
 * worklet bundle at 2× and 4×, with the program, repeats, target and bounds. Research
 * values, not product settings; no factor is chosen here.
 */
import {
  TAPE_BOUNDS,
  TAPE_OVERSAMPLING,
  TAPE_TYPES,
} from '../../../packages/engine/src/inserts/tapeConstants';
import { COST, plan as costPlan } from '../2026-09-30-tape-browser-cost/costConstants';
import type { Configuration } from '../2026-09-30-tape-browser-cost/costConstants';

const [DRIVE_MIN, DRIVE_MAX] = TAPE_BOUNDS.drive;
const [BIAS_MIN, BIAS_MAX] = TAPE_BOUNDS.bias;

/** Part 1: every cell renders a fresh shipped TapeDsp, both channels fed the same input,
 * the left core read after every host sample as `__fixtures__/tapeDspProbe.ts` reads it. */
export const PROBE = {
  models: [...TAPE_TYPES] as string[],
  rates: [44100, 48000, 96000],
  factors: [...TAPE_OVERSAMPLING] as number[],
  /** Test (c): the assertion is zero resets in every cell; a reset is a blocker for E. */
  guard: {
    biases: [BIAS_MIN, 0, BIAS_MAX] as number[],
    drives: [DRIVE_MIN, DRIVE_MIN / 2, 0, DRIVE_MAX / 2, DRIVE_MAX] as number[],
    signals: ['sine100', 'sine1k', 'impulse', 'step'],
    seconds: 0.25,
    /** Full scale is a peak of 1. The impulse is +1 then −1; the step 0 → 1 → 0 → −1 → 0. */
    level: 1,
    impulseSeconds: [0.02, 0.1],
    stepSeconds: 0.04,
  },
  /** Test (e): counts reported with no gate, at Bias 0 and Drive 0 as E2's smoke. */
  slew: {
    signals: ['noise', 'alternating'],
    seconds: 10,
    /** +12 dB over full scale: ±4. The noise is uniform over ±spread·over, clipped at ±over. */
    over: 4,
    spread: 2,
    seed: 250,
    bias: 0,
    drive: 0,
  },
  /** Parent-enforced wall-clock bound on the whole part-1 child, in ms. */
  budgetMs: 900000,
};
export type Probe = typeof PROBE;

export interface GuardCell {
  id: string;
  model: string;
  bias: number;
  drive: number;
  rate: number;
  factor: number;
  signal: string;
}
export interface SlewCell {
  id: string;
  model: string;
  rate: number;
  factor: number;
  signal: string;
}

/** Test (c) in run order: model, Bias, Drive, rate, factor, signal. */
export function guardCells(p: Probe = PROBE): GuardCell[] {
  const g = p.guard;
  return p.models.flatMap((model) =>
    g.biases.flatMap((bias) =>
      g.drives.flatMap((drive) =>
        p.rates.flatMap((rate) =>
          p.factors.flatMap((factor) =>
            g.signals.map((signal) => ({
              id: `c/${model}/b${bias}/d${drive}/${rate}/${factor}x/${signal}`,
              model,
              bias,
              drive,
              rate,
              factor,
              signal,
            })),
          ),
        ),
      ),
    ),
  );
}

/** Test (e) in run order, after every (c) cell: factor, rate, model, signal. */
export function slewCells(p: Probe = PROBE): SlewCell[] {
  return p.factors.flatMap((factor) =>
    p.rates.flatMap((rate) =>
      p.models.flatMap((model) =>
        p.slew.signals.map((signal) => ({
          id: `e/${model}/${rate}/${factor}x/${signal}`,
          model,
          rate,
          factor,
          signal,
        })),
      ),
    ),
  );
}

/** Part 2: the shipped bundle, the processor the app loads, at each factor. */
export const CONFIGURATIONS: Configuration[] = TAPE_OVERSAMPLING.map((factor) => ({
  id: `shipped/${factor}x`,
  role: 'candidate',
  factor,
}));

/** #211's program, repeats, real-time trial, target and bound, unchanged. Edits move the
 * shipped `drive` AudioParam: #211's research-control values 0.8 and 0.2 map linearly onto
 * Drive's range [−32, 32] as +19.2 and −19.2, high first, every 16 quanta, unsmoothed at
 * the parameter (the DSP smooths Drive per sample as it always does). */
export const SHIPPED = {
  rate: COST.rate,
  quantumFrames: COST.quantumFrames,
  channels: COST.channels,
  instances: COST.instances,
  modes: COST.modes,
  repeats: COST.repeats,
  edits: { quanta: COST.edits.quanta, low: -19.2, high: 19.2 },
  realtime: COST.realtime,
  targetMs: COST.targetMs,
  peakLoadLimit: COST.peakLoadLimit,
  budgetMs: COST.budgetMs,
  program: COST.program,
  bundle: 'packages/engine/src/worklet/generated/tape-processor.js',
  /** Each shipped configuration's #211 research-adapter cell, and where #211 saved it. */
  reference: {
    report: 'docs/research/2026-09-30-tape-browser-cost/measurement.json',
    cells: { 'shipped/2x': 'rk4/2x/48s', 'shipped/4x': 'rk4/4x/48s' } as Record<string, string>,
  },
  /** The harness's own smoke plan: not the measurement, never written to its report. */
  smoke: { configurations: ['shipped/2x'], repeats: 1 },
};
export type Shipped = typeof SHIPPED;

/** #211's run order: real-time trials, four-instance cells, one-instance cells. */
export const plan = (table: Shipped = SHIPPED, configurations = CONFIGURATIONS) =>
  costPlan(table as unknown as typeof COST, configurations);
