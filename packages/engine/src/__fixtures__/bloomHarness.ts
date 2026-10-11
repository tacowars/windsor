/**
 * Runs the shipped bloom processor (`generated/bloom-processor.js`) under Node
 * with only the worklet globals shimmed, and renders stereo input through it
 * block by block; and the sources (silence, noise, tone, their sum) and the
 * readings (peak, energy, a line's level) its tests take off a render.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { bloomValues } from '../inserts/bloomInsert';
import { DEFAULT_BLOOM } from '../inserts/bloomSpec';
import type { BloomSpec } from '../inserts/bloomSpec';
import { sine } from '../inserts/tapePortableMath';
import { firstValues, generatedProcessor } from './generatedProcessor';

/** What a render feeds: a function of the frame and channel, or silence. */
export type BloomSource = (frame: number, channel: number) => number;

export const silence: BloomSource = () => 0;

/** Uniform noise in ±`amplitude` over frames [from, to), a stateless hash of the frame and channel. */
export const noise =
  (amplitude: number, from = 0, to = Infinity): BloomSource =>
  (frame, channel) => {
    if (frame < from || frame >= to) return 0;
    let h = Math.imul(frame * 2 + channel + 1, 0x9e3779b1) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return amplitude * (2 * (h / 2 ** 32) - 1);
  };

/** A sine of `hz` at `rate` on both channels over frames [from, to), by the portable `sine`. */
export const tone =
  (hz: number, amplitude: number, rate: number, from = 0, to = Infinity): BloomSource =>
  (frame) =>
    frame < from || frame >= to ? 0 : amplitude * sine((2 * Math.PI * hz * frame) / rate);

/** Sources summed. */
export const mixed =
  (...sources: BloomSource[]): BloomSource =>
  (frame, channel) => {
    let sum = 0;
    for (const source of sources) sum += source(frame, channel);
    return sum;
  };

/** Σx² over [from, to). */
export function energy(data: Float32Array, from = 0, to = data.length): number {
  let total = 0;
  for (let i = Math.max(0, Math.floor(from)); i < Math.min(data.length, Math.floor(to)); i++)
    total += data[i]! * data[i]!;
  return total;
}

/** The largest |x| over [from, to). */
export function peak(data: Float32Array, from = 0, to = data.length): number {
  let largest = 0;
  for (let i = from; i < to; i++) largest = Math.max(largest, Math.abs(data[i]!));
  return largest;
}

/** The processor's params for `spec` over the defaults: one-value k-rate arrays. */
export function bloomParams(spec: Partial<BloomSpec> = {}): Record<string, Float32Array> {
  const values = bloomValues({ ...DEFAULT_BLOOM, ...spec });
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, new Float32Array([value])]),
  );
}

/** The DSP's fields the tests read (`BloomDsp` and its modules). */
export interface BloomInternals {
  asleep: boolean;
  dormant: boolean;
  slots: Float64Array;
  controls: Float64Array;
  output: { level: number; targetLevel: number };
  bands: { activeCount: number; centre: Float64Array };
  envelope: { soundingCount: number };
}

export interface BloomProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  dsp: BloomInternals;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}

export function loadBloom(rate = 48000, params = bloomParams()): BloomProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => BloomProcessorLike>({
    file: 'bloom-processor.js',
    sampleRate: rate,
  });
  return new Processor({ parameterData: firstValues(params) });
}

export interface BloomRender {
  left: Float32Array;
  right: Float32Array;
}

export interface BloomRenderOptions {
  rate?: number;
  seconds?: number;
  block?: number;
  source?: BloomSource;
  /** Called before each block; may change the params. */
  onBlock?: (frame: number, params: Record<string, Float32Array>) => void;
  /** Called after each block with the processor, to read its state. */
  afterBlock?: (frame: number, processor: BloomProcessorLike) => void;
}

/** A processor and its params, rendering on from where it left off. */
export interface BloomRig {
  processor: BloomProcessorLike;
  params: Record<string, Float32Array>;
  render(frames: number, source?: BloomSource, options?: BloomRenderOptions): BloomRender;
}

export function bloomRig(spec: Partial<BloomSpec> = {}, rate = 48000): BloomRig {
  const params = bloomParams(spec);
  const processor = loadBloom(rate, params);
  let clock = 0;
  return {
    processor,
    params,
    render(length, source = silence, options = {}) {
      const { block = 128, onBlock, afterBlock } = options;
      const left = new Float32Array(length),
        right = new Float32Array(length);
      const input = [new Float32Array(block), new Float32Array(block)];
      const output = [new Float32Array(block), new Float32Array(block)];
      for (let frame = 0; frame < length; frame += block) {
        onBlock?.(frame, params);
        for (let i = 0; i < block; i++) {
          input[0]![i] = source(clock + frame + i, 0);
          input[1]![i] = source(clock + frame + i, 1);
        }
        processor.process([input], [output], params);
        afterBlock?.(frame, processor);
        const n = Math.min(block, length - frame);
        left.set(output[0]!.subarray(0, n), frame);
        right.set(output[1]!.subarray(0, n), frame);
      }
      clock += Math.ceil(length / block) * block;
      return { left, right };
    },
  };
}

/** `seconds` of `source` through a fresh processor at `rate` in blocks of `block`. */
export function renderBloom(
  spec: Partial<BloomSpec>,
  options: BloomRenderOptions = {},
): BloomRender {
  const { rate = 48000, seconds = 1, source = silence } = options;
  return bloomRig(spec, rate).render(Math.ceil(rate * seconds), source, options);
}

/** The complex amplitude's magnitude of `hz` in `data` over frames [from, to), in dB re `reference`. */
export function lineDb(
  data: Float32Array,
  line: { hz: number; rate: number; from: number; to: number; reference: number },
): number {
  let re = 0,
    im = 0;
  for (let i = line.from; i < line.to; i++) {
    const phase = (2 * Math.PI * line.hz * i) / line.rate;
    re += data[i]! * Math.cos(phase);
    im -= data[i]! * Math.sin(phase);
  }
  const amplitude = (2 * Math.hypot(re, im)) / (line.to - line.from);
  return 20 * Math.log10(amplitude / line.reference);
}
