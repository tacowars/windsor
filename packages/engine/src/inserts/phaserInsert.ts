/** Fixed insert graph; the stage owns DSP lifetime and the mixer owns output edges. */
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { PHASER_BOUNDS, PHASER_NAME } from './phaserConstants';
import { DEFAULT_PHASER, PHASER_FIELDS, PHASER_NUMBERS, normalisePhaser } from './phaserSpec';
import type { PhaserSpec } from './phaserSpec';

/** Every param `set` writes, by name, for `spec`. */
function phaserValues(spec: PhaserSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of PHASER_NUMBERS) values[name] = spec[name];
  values.enabled = Number(spec.enabled);
  return values;
}

function create(context: BaseAudioContext, spec: PhaserSpec): InsertStage<PhaserSpec> {
  let current = spec;
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
  const params = workletFieldParams(
    processor,
    (name) => phaserValues(current)[name]!,
    ownParam(PHASER_BOUNDS),
  );
  return {
    kind: 'phaser',
    input,
    output,
    processor,
    set(next): void {
      current = next;
      params.write(phaserValues(next));
    },
    param: (field) => params.param(field),
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
