/** Runs the actual shipped retro processor with only browser globals shimmed. */
import { readFileSync } from 'node:fs';
import { RETRO_REVERB_DEFAULTS, RETRO_REVERB_MODES } from '../inserts/retroReverbConstants';
import type { RetroReverbSpec } from '../inserts/retroReverbSpec';

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
  const source = readFileSync(
    new URL('../worklet/generated/retro-reverb-processor.js', import.meta.url),
    'utf8',
  );
  let ctor: (new (options: unknown) => RetroProcessorLike) | undefined;
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
