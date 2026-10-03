/** Runs the actual shipped delay processor with only browser globals shimmed. */
import { DELAY_MODE_IDS } from '../inserts/delayConstants';
import { DEFAULT_DELAY, delayMilliseconds } from '../inserts/delaySpec';
import type { DelaySpec } from '../inserts/delaySpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

export function delayParams(
  partial: Partial<DelaySpec> = {},
  bpm = 120,
): Record<string, Float32Array> {
  const spec = { ...DEFAULT_DELAY, ...partial };
  const values = {
    ...spec,
    mode: DELAY_MODE_IDS[spec.mode],
    leftMs: delayMilliseconds(spec, 'left', bpm),
    rightMs: delayMilliseconds(spec, 'right', bpm),
  };
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => typeof value !== 'string')
      .map(([key, value]) => [key, new Float32Array([Number(value)])]),
  );
}
export interface DelayProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}
export function loadDelay(rate = 48000, params = delayParams()): DelayProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => DelayProcessorLike>({
    file: 'delay-processor.js',
    sampleRate: rate,
  });
  return new Processor({
    parameterData: firstValues(params),
  });
}
