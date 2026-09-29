/** Runs the actual shipped tape processor with only browser globals shimmed. */
import { readFileSync } from 'node:fs';
import { TAPE_DEFAULTS, TAPE_TYPES } from '../inserts/tapeConstants';
import type { TapeSpec } from '../inserts/tapeSpec';

export function tapeParams(spec: Partial<TapeSpec> = {}): Record<string, Float32Array> {
  return Object.fromEntries(
    Object.entries({
      ...TAPE_DEFAULTS,
      ...spec,
      model: TAPE_TYPES.indexOf(spec.model ?? 'studio'),
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
  const source = readFileSync(
    new URL('../worklet/generated/tape-processor.js', import.meta.url),
    'utf8',
  );
  let ctor: (new (options: unknown) => TapeProcessorLike) | undefined;
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
