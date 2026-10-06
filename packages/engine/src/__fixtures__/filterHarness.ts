/**
 * Runs the shipped Filter insert bundle (windsor#622) with only the
 * worklet scope's globals shimmed, and reaches its DSP's fields for the
 * tests that watch the tuning and the rest. Node-only, like the rest of
 * this directory.
 */
import { FILTER_MODES } from '../inserts/filterConstants';
import { DEFAULT_FILTER } from '../inserts/filterSpec';
import type { FilterSpec } from '../inserts/filterSpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

/** The processor's params for `spec` over the defaults: the mode as its index, the switches as 0 or 1. */
export function filterParams(spec: Partial<FilterSpec> = {}): Record<string, Float32Array> {
  const s = { ...DEFAULT_FILTER, ...spec };
  const values: Record<string, number> = {
    cutoff: s.cutoff,
    resonance: s.resonance,
    mix: s.mix,
    mode: FILTER_MODES.indexOf(s.mode),
    slope24: Number(s.slope24),
    enabled: Number(s.enabled),
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, new Float32Array([value])]),
  );
}

/** What a test reads of one SVF section or ladder in the bundle. */
export interface FilterSectionLike {
  cutoffHz: number;
  setCoeffs(rate: number): void;
}

export interface FilterProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  dsp: {
    resting: boolean;
    svfA: FilterSectionLike[];
    ladder: { cutoffHz: number }[];
  };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}

export function loadFilter(rate = 48000, params = filterParams()): FilterProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => FilterProcessorLike>({
    file: 'filter-processor.js',
    sampleRate: rate,
  });
  return new Processor({ parameterData: firstValues(params) });
}

/** A fixed stereo noise, `quanta` quanta of it, the same on every call. */
export function filterNoise(quanta: number, seed = 0x5eed): Float32Array[][] {
  let state = seed >>> 0;
  const next = (): number => {
    // xorshift32: the same numbers on every platform.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0x100000000) * 2 - 1;
  };
  return Array.from({ length: quanta }, () => {
    const left = new Float32Array(128),
      right = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      left[i] = 0.5 * next();
      right[i] = 0.5 * next();
    }
    return [left, right];
  });
}

/** `processor` over every quantum of `input` (the params as they stand), both channels' outputs joined. */
export function runFilter(
  processor: FilterProcessorLike,
  input: Float32Array[][],
  params: Record<string, Float32Array>,
): [Float32Array, Float32Array] {
  const left = new Float32Array(input.length * 128),
    right = new Float32Array(input.length * 128);
  input.forEach((quantum, q) => {
    const out = [new Float32Array(128), new Float32Array(128)];
    processor.process([quantum], [out], params);
    left.set(out[0]!, q * 128);
    right.set(out[1]!, q * 128);
  });
  return [left, right];
}
