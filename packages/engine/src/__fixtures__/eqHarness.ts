/** Runs the shipped Parametric EQ processor (windsor#198) with only the worklet globals shimmed. */
import { eqParameterValues } from '../inserts/eqParameters';
import { DEFAULT_EQ } from '../inserts/eqSpec';
import type { EqSpec } from '../inserts/eqSpec';
import { generatedProcessor } from './generatedProcessor';

export const QUANTUM = 128;

export type EqParams = Record<string, Float32Array>;

/** `spec` as the processor's k-rate parameter arrays. */
export function eqParams(spec: EqSpec = DEFAULT_EQ): EqParams {
  return Object.fromEntries(
    Object.entries(eqParameterValues(spec)).map(([key, value]) => [key, new Float32Array([value])]),
  );
}

/** Write `spec` into existing parameter arrays, as a stage's `set` would between quanta. */
export function setEqParams(params: EqParams, spec: EqSpec): void {
  for (const [key, value] of Object.entries(eqParameterValues(spec))) params[key]![0] = value;
}

export interface EqProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: EqParams): boolean;
}

const FILE = 'eq-processor.js';

export function loadEq(rate = 48000): EqProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => EqProcessorLike>({
    file: FILE,
    sampleRate: rate,
  });
  return new Processor({});
}

/** The bundle's top-level functions the audio thread runs, by the names the harness reaches them by. */
export const HOT_FUNCTIONS = [
  'setPhi',
  'store',
  'identity',
  'matchPoles',
  'denominatorPower',
  'numerator',
  'bell',
  'pass',
  'pass2',
  'pass1',
  'notch',
  'shelfPower',
  'shelfFit',
  'bilinearShelf',
  'shelf',
  'cut',
  'designEqBand',
  'eqBandGain',
  'runSections',
  'glideSections',
  'mixFade',
  'clamp',
] as const;

export interface EqInternals extends Record<string, unknown> {
  EqProcessor: { prototype: object };
  EqDsp: { prototype: object };
  EqBand: { prototype: object };
  EqListen: { prototype: object };
}

/** The bundle's classes and hot functions, reached by their top-level names. */
export function eqInternals(rate = 48000): EqInternals {
  const names = ['EqProcessor', 'EqDsp', 'EqBand', 'EqListen', ...HOT_FUNCTIONS];
  return generatedProcessor<unknown, EqInternals>({
    file: FILE,
    sampleRate: rate,
    base: class {},
    epilogue: `return { ${names.join(', ')} };`,
  }).exports;
}

/**
 * Run `input` (stereo) through `processor` one quantum at a time; `before`
 * runs ahead of each quantum with its index, to change parameters mid-signal.
 */
export function runEq(
  processor: EqProcessorLike,
  params: EqParams,
  input: readonly [Float32Array, Float32Array],
  before?: (quantum: number) => void,
): [Float32Array, Float32Array] {
  const length = input[0].length;
  const out: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const blockL = new Float32Array(QUANTUM);
  const blockR = new Float32Array(QUANTUM);
  const outL = new Float32Array(QUANTUM);
  const outR = new Float32Array(QUANTUM);
  for (let q = 0; q * QUANTUM < length; q++) {
    const at = q * QUANTUM;
    const n = Math.min(QUANTUM, length - at);
    blockL.fill(0).set(input[0].subarray(at, at + n));
    blockR.fill(0).set(input[1].subarray(at, at + n));
    before?.(q);
    processor.process([[blockL, blockR]], [[outL, outR]], params);
    out[0].set(outL.subarray(0, n), at);
    out[1].set(outR.subarray(0, n), at);
  }
  return out;
}

/** A sine of `amplitude` at `hz`, `seconds` long, the same on both channels. */
export function sine(hz: number, seconds: number, rate: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}
