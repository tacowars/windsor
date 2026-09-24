/** Runs the actual shipped phaser processor with only browser globals shimmed. */
import { readFileSync } from 'node:fs';
import { PHASER_DEFAULTS } from '../inserts/phaserConstants';
import type { PhaserSpec } from '../inserts/phaserSpec';

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
  const source = readFileSync(
    new URL('../worklet/generated/phaser-processor.js', import.meta.url),
    'utf8',
  );
  let ctor: (new (options: unknown) => PhaserProcessorLike) | undefined;
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
