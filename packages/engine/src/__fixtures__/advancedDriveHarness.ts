/** Headless harness for the shipped Advanced Drive worklet, with browser globals shimmed. */
import { readFileSync } from 'node:fs';
import { DEFAULT_ADVANCED_DRIVE } from '../inserts/advancedDriveSpec';
import type { AdvancedDriveSpec } from '../inserts/advancedDriveSpec';
import { advancedDriveParameters } from '../inserts/advancedDriveParameters';
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
  const source = readFileSync(
    new URL('../worklet/generated/advanced-drive-processor.js', import.meta.url),
    'utf8',
  );
  let ctor: (new (options: unknown) => AdvancedDriveProcessorLike) | undefined;
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
    parameterData: Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, value[0]]),
    ),
  });
}
