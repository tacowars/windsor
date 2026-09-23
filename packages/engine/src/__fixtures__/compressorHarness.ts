/** The shipped compressor worklet, evaluated with only its browser globals shimmed. */
import { readFileSync } from 'node:fs';
import { COMPRESSOR_DEFAULTS } from '../inserts/compressorConstants';
import type { CompressorSpec } from '../inserts/compressorSpec';
import type { CompressorDsp, CompressorParams } from '../inserts/compressorDsp';

export function compressorParams(spec: Partial<CompressorSpec> = {}): CompressorParams {
  return Object.fromEntries(
    Object.entries({ ...COMPRESSOR_DEFAULTS, ...spec, external: 0 })
      .filter(([key]) => key !== 'kind')
      .map(([key, value]) => [key, new Float32Array([Number(value)])]),
  );
}
export interface CompressorProcessorLike {
  dsp: CompressorDsp;
  port: { posted: unknown[]; onmessage: (event: { data: unknown }) => void };
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: CompressorParams): boolean;
}
export function loadCompressor(rate = 48000, params = compressorParams()): CompressorProcessorLike {
  const source = readFileSync(
    new URL('../worklet/generated/compressor-processor.js', import.meta.url),
    'utf8',
  );
  let ctor: (new (options: unknown) => CompressorProcessorLike) | undefined;
  class Base {
    port = {
      posted: [] as unknown[],
      onmessage: null,
      postMessage(message: unknown): void {
        this.posted.push(structuredClone(message));
      },
    };
  }
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    Base,
    rate,
    (_name: string, value: typeof ctor) => {
      ctor = value;
    },
  );
  return new ctor!({
    parameterData: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]])),
  });
}
