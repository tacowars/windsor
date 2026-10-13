/** The shipped compressor worklet, evaluated with only its browser globals shimmed. */
import { COMPRESSOR_DEFAULTS } from '../inserts/compressorConstants';
import type { CompressorSpec } from '../inserts/compressorSpec';
import type { CompressorDsp, CompressorParams } from '../inserts/compressorDsp';
import { firstValues, generatedProcessor } from './generatedProcessor';

export function compressorParams(spec: Partial<CompressorSpec> = {}): CompressorParams {
  return Object.fromEntries(
    Object.entries({ ...COMPRESSOR_DEFAULTS, ...spec, external: 0 })
      .filter(([key]) => key !== 'kind' && key !== 'sidechain')
      .map(([key, value]) => [key, new Float32Array([Number(value)])]),
  );
}
export interface CompressorProcessorLike {
  dsp: CompressorDsp;
  port: { posted: unknown[]; onmessage: (event: { data: unknown }) => void };
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: CompressorParams): boolean;
}
/** `sleep: false` renders without the sleep (windsor#793), for a test to compare against. */
export function loadCompressor(
  rate = 48000,
  params = compressorParams(),
  options: { sleep?: boolean } = {},
): CompressorProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => CompressorProcessorLike>({
    file: 'compressor-processor.js',
    sampleRate: rate,
  });
  return new Processor({
    parameterData: firstValues(params),
    processorOptions: options,
  });
}
