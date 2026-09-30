/** Fixed insert graph; the stage owns DSP lifetime and the mixer owns output edges. */
import type { InsertKind, InsertStage } from './insertKind';
import { TAPE_NAME, TAPE_TYPES } from './tapeConstants';
import { DEFAULT_TAPE, TAPE_FIELDS, TAPE_NUMBERS, normaliseTape } from './tapeSpec';
import type { TapeSpec } from './tapeSpec';

function create(context: BaseAudioContext, spec: TapeSpec): InsertStage<TapeSpec> {
  const parameterData: Record<string, number> = {
    enabled: Number(spec.enabled),
    split: Number(spec.split),
    model: TAPE_TYPES.indexOf(spec.model),
  };
  for (const name of TAPE_NUMBERS) parameterData[name] = spec[name];
  const processor = new AudioWorkletNode(context, TAPE_NAME, {
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
    kind: 'tape',
    input,
    output,
    processor,
    set(next): void {
      for (const name of TAPE_NUMBERS) processor.parameters.get(name)!.value = next[name];
      processor.parameters.get('enabled')!.value = Number(next.enabled);
      processor.parameters.get('split')!.value = Number(next.split);
      processor.parameters.get('model')!.value = TAPE_TYPES.indexOf(next.model);
    },
    dispose(): void {
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      processor.port.close();
    },
  };
}

export const TAPE_INSERT: InsertKind<TapeSpec> = {
  fields: TAPE_FIELDS,
  defaults: DEFAULT_TAPE,
  normalise: normaliseTape,
  create,
};
