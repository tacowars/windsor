/** Fixed insert graph; the stage owns DSP lifetime and the mixer owns output edges. */
import type { InsertKind, InsertStage } from './insertKind';
import { RETRO_REVERB_NAME, RETRO_REVERB_MODES } from './retroReverbConstants';
import {
  DEFAULT_RETRO_REVERB,
  RETRO_REVERB_FIELDS,
  RETRO_REVERB_NUMBERS,
  normaliseRetroReverb,
} from './retroReverbSpec';
import type { RetroReverbSpec } from './retroReverbSpec';

function create(context: BaseAudioContext, spec: RetroReverbSpec): InsertStage<RetroReverbSpec> {
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
  return {
    kind: 'retro-reverb',
    input,
    output,
    processor,
    set(next): void {
      for (const name of RETRO_REVERB_NUMBERS) processor.parameters.get(name)!.value = next[name];
      processor.parameters.get('enabled')!.value = Number(next.enabled);
      processor.parameters.get('mode')!.value = RETRO_REVERB_MODES.indexOf(next.mode);
    },
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
