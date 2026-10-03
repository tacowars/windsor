/** Runs the actual shipped phaser processor with only browser globals shimmed. */
import { PHASER_DEFAULTS } from '../inserts/phaserConstants';
import type { PhaserSpec } from '../inserts/phaserSpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

export function phaserParams(spec: Partial<PhaserSpec> = {}): Record<string, Float32Array> {
  return Object.fromEntries(
    Object.entries({
      ...PHASER_DEFAULTS,
      ...spec,
    })
      .filter(([key]) => key !== 'kind')
      .map(([key, value]) => [key, new Float32Array([Number(value)])]),
  );
}
export interface PhaserProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}
export function loadPhaser(rate = 48000, params = phaserParams()): PhaserProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => PhaserProcessorLike>({
    file: 'phaser-processor.js',
    sampleRate: rate,
  });
  return new Processor({
    parameterData: firstValues(params),
  });
}
