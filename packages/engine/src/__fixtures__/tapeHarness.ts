/** Runs the actual shipped tape processor with only browser globals shimmed. */
import { TAPE_DEFAULTS, TAPE_TYPES } from '../inserts/tapeConstants';
import { tapeCoreParams } from '../inserts/tapeInsert';
import { DEFAULT_TAPE, type TapeSpec } from '../inserts/tapeSpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

/** The processor's parameters for `spec`, as the insert writes them: `core` as its four (windsor#291). */
export function tapeParams(spec: Partial<TapeSpec> = {}): Record<string, Float32Array> {
  const full: TapeSpec = { ...DEFAULT_TAPE, ...spec };
  // The spec's `core` object is replaced by its four numbers, the flag named `core` among them.
  return Object.fromEntries(
    Object.entries({
      ...TAPE_DEFAULTS,
      ...spec,
      model: TAPE_TYPES.indexOf(spec.model ?? 'studio'),
      ...tapeCoreParams(full),
    })
      .filter(([key]) => key !== 'kind')
      .map(([key, value]) => [key, new Float32Array([Number(value)])]),
  );
}
export interface TapeProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}
export function loadTape(rate = 48000, params = tapeParams()): TapeProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => TapeProcessorLike>({
    file: 'tape-processor.js',
    sampleRate: rate,
  });
  return new Processor({
    parameterData: firstValues(params),
  });
}
