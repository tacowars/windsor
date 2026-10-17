/** Runs the actual shipped delay processor with only browser globals shimmed. */
import { delayParameters } from '../inserts/delayParameters';
import { DEFAULT_DELAY } from '../inserts/delaySpec';
import type { DelaySpec } from '../inserts/delaySpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

/** The processor's parameters for `partial` over the defaults, as the insert writes them. */
export function delayParams(
  partial: Partial<DelaySpec> = {},
  bpm = 120,
): Record<string, Float32Array> {
  const values = delayParameters({ ...DEFAULT_DELAY, ...partial }, bpm);
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, new Float32Array([value])]),
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
/** `sleep: false` renders without the sleep (windsor#793), for a test to compare against. */
export function loadDelay(
  rate = 48000,
  params = delayParams(),
  options: { sleep?: boolean } = {},
): DelayProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => DelayProcessorLike>({
    file: 'delay-processor.js',
    sampleRate: rate,
  });
  return new Processor({
    parameterData: firstValues(params),
    processorOptions: options,
  });
}
