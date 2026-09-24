/** Fixed insert graph; the stage owns DSP lifetime and the mixer owns output edges. */
import type { InsertKind, InsertStage } from './insertKind';
import { PHASER_NAME } from './phaserConstants';
import { DEFAULT_PHASER, PHASER_FIELDS, PHASER_NUMBERS, normalisePhaser } from './phaserSpec';
import type { PhaserSpec } from './phaserSpec';

function create(context: BaseAudioContext, spec: PhaserSpec): InsertStage<PhaserSpec> {
  const parameterData: Record<string, number> = {
    enabled: Number(spec.enabled),
  };
  for (const name of PHASER_NUMBERS) parameterData[name] = spec[name];
  const processor = new AudioWorkletNode(context, PHASER_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData,
  });
  const input = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  return {
    kind: 'phaser',
    input,
    output,
    processor,
    set(next): void {
      for (const name of PHASER_NUMBERS) processor.parameters.get(name)!.value = next[name];
      processor.parameters.get('enabled')!.value = Number(next.enabled);
    },
    dispose(): void {
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      processor.port.close();
    },
  };
}

export const PHASER_INSERT: InsertKind<PhaserSpec> = {
  fields: PHASER_FIELDS,
  defaults: DEFAULT_PHASER,
  normalise: normalisePhaser,
  create,
};
