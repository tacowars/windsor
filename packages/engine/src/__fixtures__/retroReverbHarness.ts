/** Runs the actual shipped retro processor with only browser globals shimmed. */
import { RETRO_REVERB_DEFAULTS, RETRO_REVERB_MODES } from '../inserts/retroReverbConstants';
import type { RetroReverbSpec } from '../inserts/retroReverbSpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

export function retroParams(spec: Partial<RetroReverbSpec> = {}): Record<string, Float32Array> {
  return Object.fromEntries(
    Object.entries({
      ...RETRO_REVERB_DEFAULTS,
      ...spec,
      mode: RETRO_REVERB_MODES.indexOf(spec.mode ?? 'reverb'),
    })
      .filter(([key]) => key !== 'kind')
      .map(([key, value]) => [key, new Float32Array([Number(value)])]),
  );
}
export interface RetroProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}
export function loadRetro(rate = 48000, params = retroParams()): RetroProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => RetroProcessorLike>({
    file: 'retro-reverb-processor.js',
    sampleRate: rate,
  });
  return new Processor({
    parameterData: firstValues(params),
  });
}
