/** Fixed insert graph; the stage owns DSP lifetime and the mixer owns output edges. */
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { RETRO_REVERB_BOUNDS, RETRO_REVERB_NAME, RETRO_REVERB_MODES } from './retroReverbConstants';
import {
  DEFAULT_RETRO_REVERB,
  RETRO_REVERB_FIELDS,
  RETRO_REVERB_NUMBERS,
  normaliseRetroReverb,
} from './retroReverbSpec';
import type { RetroReverbSpec } from './retroReverbSpec';

/** Every param `set` writes, by name, for `spec`. */
function retroValues(spec: RetroReverbSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of RETRO_REVERB_NUMBERS) values[name] = spec[name];
  values.enabled = Number(spec.enabled);
  values.mode = RETRO_REVERB_MODES.indexOf(spec.mode);
  return values;
}

function create(context: BaseAudioContext, spec: RetroReverbSpec): InsertStage<RetroReverbSpec> {
  let current = spec;
  const parameterData: Record<string, number> = {
    enabled: Number(spec.enabled),
    mode: RETRO_REVERB_MODES.indexOf(spec.mode),
  };
  for (const name of RETRO_REVERB_NUMBERS) parameterData[name] = spec[name];
  const processor = new AudioWorkletNode(context, RETRO_REVERB_NAME, {
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
    (name) => retroValues(current)[name]!,
    ownParam(RETRO_REVERB_BOUNDS),
  );
  return {
    kind: 'retro-reverb',
    input,
    output,
    processor,
    set(next): void {
      current = next;
      params.write(retroValues(next));
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

export const RETRO_REVERB_INSERT: InsertKind<RetroReverbSpec> = {
  fields: RETRO_REVERB_FIELDS,
  defaults: DEFAULT_RETRO_REVERB,
  normalise: normaliseRetroReverb,
  create,
};
