/** Headless harness for the shipped Advanced Drive worklet, with browser globals shimmed. */
import { DEFAULT_ADVANCED_DRIVE } from '../inserts/advancedDriveSpec';
import type { AdvancedDriveSpec } from '../inserts/advancedDriveSpec';
import { advancedDriveParameters } from '../inserts/advancedDriveParameters';
import { firstValues, generatedProcessor } from './generatedProcessor';
export function advancedDriveParams(
  spec: Partial<AdvancedDriveSpec> = {},
  bpm = 120,
): Record<string, Float32Array> {
  return Object.fromEntries(
    Object.entries(advancedDriveParameters({ ...DEFAULT_ADVANCED_DRIVE, ...spec }, bpm)).map(
      ([k, v]) => [k, new Float32Array([v])],
    ),
  );
}
export interface AdvancedDriveProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}
export function loadAdvancedDrive(
  rate = 48000,
  params = advancedDriveParams(),
): AdvancedDriveProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => AdvancedDriveProcessorLike>({
    file: 'advanced-drive-processor.js',
    sampleRate: rate,
  });
  return new Processor({
    parameterData: firstValues(params),
  });
}
