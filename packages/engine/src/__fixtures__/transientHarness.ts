/**
 * Runs the shipped Transient bundle (record `2026-10-18-transient-insert`)
 * with only the worklet scope's globals shimmed, and reaches its DSP's
 * fields for the tests that watch the detector and the gain. Node-only, like
 * the rest of this directory.
 */
import { transientParameters } from '../inserts/transientParameters';
import { DEFAULT_TRANSIENT } from '../inserts/transientSpec';
import type { TransientSpec } from '../inserts/transientSpec';
import type { TransientTiming } from '../inserts/transientTables';
import { firstValues, generatedProcessor } from './generatedProcessor';

export const QUANTUM = 128;

/** The processor's params for `spec` over the defaults. */
export function transientParams(spec: Partial<TransientSpec> = {}): Record<string, Float32Array> {
  const values = transientParameters({ ...DEFAULT_TRANSIENT, ...spec });
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, new Float32Array([value])]),
  );
}

export interface TransientProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  dsp: {
    gainDb: number;
    level: number;
    bypassed: boolean;
    asleep: boolean;
    outputGain: number;
    detector: {
      peak: number;
      follower: number;
      attackRef: number;
      sustainRef: number;
      shapeA: number;
      shapeS: number;
    };
  };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}

export interface TransientOptions {
  /** A timing row over the shipped one: the tests' and the listen's only. */
  timing?: TransientTiming;
  /** `false` renders without the sleep, for a test to compare against. */
  sleep?: boolean;
}

export function loadTransient(
  rate = 48000,
  params = transientParams(),
  options: TransientOptions = {},
): TransientProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => TransientProcessorLike>({
    file: 'transient-processor.js',
    sampleRate: rate,
  });
  return new Processor({ parameterData: firstValues(params), processorOptions: options });
}

export interface TransientRun {
  left: Float32Array;
  right: Float32Array;
  /** The gain each sample took, in dB: output over input. */
  gainDb: Float32Array;
}

/**
 * `program` through `processor` in quanta, the params as they stand.
 * `gainDb` is the left output over the left input in dB, the gain the insert
 * applied to that sample (Mix, Output and the switch included), and NaN
 * where the input is within 1e-12 of 0. `each(quantum)` may move a param
 * before its quantum. The length is rounded up to whole quanta.
 */
export function runTransient(
  processor: TransientProcessorLike,
  program: Float32Array[],
  params: Record<string, Float32Array>,
  each: (quantum: number) => void = () => {},
): TransientRun {
  const frames = Math.ceil(program[0]!.length / QUANTUM) * QUANTUM;
  const left = new Float32Array(frames),
    right = new Float32Array(frames),
    gainDb = new Float32Array(frames);
  for (let at = 0; at < frames; at += QUANTUM) {
    each(at / QUANTUM);
    const input = program.map((channel) => {
      const block = new Float32Array(QUANTUM);
      block.set(channel.subarray(at, at + QUANTUM));
      return block;
    });
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    processor.process([input], [out], params);
    left.set(out[0]!, at);
    right.set(out[1]!, at);
    for (let i = 0; i < QUANTUM; i++) {
      const x = input[0]![i]!;
      gainDb[at + i] = Math.abs(x) > 1e-12 ? 20 * Math.log10(Math.abs(out[0]![i]! / x)) : NaN;
    }
  }
  return { left, right, gainDb };
}

/** A stereo signal of `frames` samples, both channels `at(i)`. */
export function transientSignal(frames: number, at: (i: number) => number): Float32Array[] {
  const left = Float32Array.from({ length: frames }, (_, i) => at(i));
  return [left, Float32Array.from(left)];
}

/**
 * The sweep's synthetic hit: silence until `onset`, then an instant rise to
 * `peak` and an exponential decay with time constant `tauS`, on a sine of
 * `hz` that starts at its crest, so the first sample is the peak.
 */
export function hit(
  frames: number,
  rate: number,
  { onset = 0, peak = 0.5, tauS = 0.08, hz = 220 } = {},
): Float32Array[] {
  return transientSignal(frames, (i) => {
    if (i < onset) return 0;
    const t = (i - onset) / rate;
    return peak * Math.exp(-t / tauS) * Math.cos(2 * Math.PI * hz * t);
  });
}

/** A steady sine of `hz` at `peak`. */
export function sine(frames: number, rate: number, hz: number, peak = 0.5): Float32Array[] {
  return transientSignal(frames, (i) => peak * Math.sin((2 * Math.PI * hz * i) / rate));
}
