/**
 * Drives the shipped Tape processor's DSP one sample at a time (windsor#224),
 * so a test can read the magnetic core's stage points, guard and reset
 * counters after every sample. It calls the DSP exactly as the processor's
 * `process` does: `configure` once per 128-sample block, then `tick` per
 * sample. `loadTape` evaluates the generated bundle, so this is the code the
 * browser runs.
 */
import { TAPE_MAGNETIC } from '../inserts/tapeMagneticConstants';
import type { TapeSpec } from '../inserts/tapeSpec';
import { loadTape, tapeParams } from './tapeHarness';

const QUANTUM = 128;

/** The parts of the bundle's `TapeOversampler` the tests read. */
export interface ShippedOversampler {
  factor: number;
  input: number;
  output: number;
  guards: number;
  stages: Float64Array;
  history: Float64Array;
  outputs: Float64Array;
  core: {
    m: number;
    out: number;
    resets: number;
    ms: number;
    invA: number;
    reversibleGain: number;
    irreversible: number;
    irreversibleK: number;
    dt: number;
    susceptibility: number;
    gain: number;
  };
}

/** The parts of the bundle's `TapeDsp` the tests read. */
export interface ShippedTapeDsp {
  configure(params: Record<string, Float32Array>, frames: number): void;
  tick(left: number, right: number): void;
  bypassEq(bypassed: boolean): void;
  left: number;
  right: number;
  magnetic: {
    active: ShippedOversampler[];
    oversamplers: ShippedOversampler[];
    factor: number;
    latency: number;
    /** True while a model switch glides the core's controls. */
    gliding: boolean;
  };
  motion: { delay: number; dropout: number };
}

export interface TapeRig {
  dsp: ShippedTapeDsp;
  params: Record<string, Float32Array>;
}

/** A shipped DSP at `spec`, with the Bias and model EQ bypassed when `eq` is false. */
export function tapeRig(spec: Partial<TapeSpec>, rate = 48000, eq = true): TapeRig {
  const params = tapeParams(spec);
  const processor = loadTape(rate, params) as unknown as { dsp: ShippedTapeDsp };
  processor.dsp.bypassEq(!eq);
  return { dsp: processor.dsp, params };
}

/**
 * The source field a stage point held before the knee: the knee is odd and
 * strictly increasing, so its output inverts exactly (to rounding). What the
 * guard let through is therefore within ±`fieldGuard`.
 */
export function unconditioned(field: number, table = TAPE_MAGNETIC): number {
  const magnitude = Math.abs(field);
  if (magnitude <= table.knee) return field;
  const span = table.asymptote - table.knee;
  const w = (magnitude - table.knee) / span;
  const h = table.knee + span * (w / (1 - w));
  return field < 0 ? -h : h;
}

/** The largest |source field| among the stage points the left core just integrated. */
export function fieldPeak(oversampler: ShippedOversampler): number {
  let peak = 0;
  const stages = oversampler.stages;
  for (let at = 2; at < stages.length; at += 2)
    peak = Math.max(peak, Math.abs(unconditioned(stages[at]!)));
  return peak;
}

export interface Render {
  /** The left output, one sample per input sample. */
  left: Float64Array;
  /** The largest |source field| at the left core over the samples from `settle` on. */
  field: number;
  /** Field-guard engagements and state resets of the left core over the whole render. */
  guards: number;
  resets: number;
}

/**
 * `frames` samples of `signal(n)` on both channels. `each` runs after every
 * sample, for a test that reads more than this collects.
 */
export function renderTape(
  rig: TapeRig,
  signal: (n: number) => number,
  frames: number,
  options: { settle?: number; each?: (n: number) => void } = {},
): Render {
  const { dsp, params } = rig;
  const { settle = 0, each } = options;
  const left = new Float64Array(frames);
  const start = dsp.magnetic.active[0]!;
  const guards = start.guards,
    resets = start.core.resets;
  let field = 0;
  for (let n = 0; n < frames; n++) {
    if (n % QUANTUM === 0) dsp.configure(params, QUANTUM);
    const x = signal(n);
    dsp.tick(x, x);
    left[n] = dsp.left;
    if (n >= settle) field = Math.max(field, fieldPeak(dsp.magnetic.active[0]!));
    each?.(n);
  }
  const end = dsp.magnetic.active[0]!;
  return { left, field, guards: end.guards - guards, resets: end.core.resets - resets };
}
