/** Fixed insert graph; the stage owns DSP lifetime and the mixer owns output edges. */
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import {
  TAPE_BOUNDS,
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

/** Every param `set` writes, by name, for `spec`. */
function tapeValues(spec: TapeSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of TAPE_NUMBERS) values[name] = spec[name];
  values.enabled = Number(spec.enabled);
  values.split = Number(spec.split);
  values.model = TAPE_TYPES.indexOf(spec.model);
  return { ...values, ...tapeCoreParams(spec) };
}

function create(context: BaseAudioContext, spec: TapeSpec): InsertStage<TapeSpec> {
  let current = spec;
  const processor = new AudioWorkletNode(context, TAPE_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: tapeValues(spec),
  });
  const input = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  const params = workletFieldParams(
    processor,
    (name) => tapeValues(current)[name]!,
    ownParam(TAPE_BOUNDS),
  );
  return {
    kind: 'tape',
    input,
    output,
    processor,
    set(next): void {
      current = next;
      params.write(tapeValues(next));
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

export const TAPE_INSERT: InsertKind<TapeSpec> = {
  fields: TAPE_FIELDS,
  defaults: DEFAULT_TAPE,
  normalise: normaliseTape,
  create,
};
