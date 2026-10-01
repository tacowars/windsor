/** Fixed insert graph; the stage owns DSP lifetime and the mixer owns output edges. */
import type { InsertKind, InsertStage } from './insertKind';
import {
  TAPE_CORE_BOUNDS as B,
  TAPE_CORE_PARAMS as P,
  TAPE_NAME,
  TAPE_TYPES,
} from './tapeConstants';
import { DEFAULT_TAPE, TAPE_FIELDS, TAPE_NUMBERS, normaliseTape, tapeModelCore } from './tapeSpec';
import type { TapeSpec } from './tapeSpec';

/**
 * The processor's parameters for `spec.core` (windsor#291): its flag, and its three controls.
 * While it is absent the processor reads the model's row itself, and the three carry that row,
 * which lies inside each parameter's range, `TAPE_CORE_BOUNDS` (windsor#315); the clamp keeps any
 * write in range should a row ever leave it.
 */
export function tapeCoreParams(spec: TapeSpec): Record<(typeof P)[keyof typeof P], number> {
  const controls = spec.core ?? tapeModelCore(spec.model);
  const clamp = (control: keyof typeof B): number =>
    Math.min(B[control][1], Math.max(B[control][0], controls[control]));
  return {
    [P.flag]: spec.core ? 1 : 0,
    [P.drive]: clamp('drive'),
    [P.width]: clamp('width'),
    [P.saturation]: clamp('saturation'),
  } as Record<(typeof P)[keyof typeof P], number>;
}

function create(context: BaseAudioContext, spec: TapeSpec): InsertStage<TapeSpec> {
  const parameterData: Record<string, number> = {
    enabled: Number(spec.enabled),
    split: Number(spec.split),
    model: TAPE_TYPES.indexOf(spec.model),
    ...tapeCoreParams(spec),
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
      for (const [name, value] of Object.entries(tapeCoreParams(next)))
        processor.parameters.get(name)!.value = value;
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
