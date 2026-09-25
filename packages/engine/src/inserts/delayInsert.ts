/** Fixed stereo worklet graph. Settings and song tempo only write parameters. */
import type { InsertKind, InsertStage } from './insertKind';
import { DELAY_DSP, DELAY_MODE_IDS, DELAY_NAME } from './delayConstants';
import {
  DEFAULT_DELAY,
  DELAY_FIELDS,
  DELAY_NUMBERS,
  delayMilliseconds,
  normaliseDelay,
} from './delaySpec';
import type { DelaySpec } from './delaySpec';

function create(context: BaseAudioContext, initial: DelaySpec): InsertStage<DelaySpec> {
  let spec = initial;
  let bpm: number = DELAY_DSP.defaultBpm;
  const parameterData: Record<string, number> = {
    enabled: Number(spec.enabled),
    mode: DELAY_MODE_IDS[spec.mode],
  };
  for (const name of DELAY_NUMBERS) parameterData[name] = spec[name];
  parameterData.leftMs = delayMilliseconds(spec, 'left', bpm);
  parameterData.rightMs = delayMilliseconds(spec, 'right', bpm);
  const processor = new AudioWorkletNode(context, DELAY_NAME, {
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
  const timing = (): void => {
    processor.parameters.get('leftMs')!.value = delayMilliseconds(spec, 'left', bpm);
    processor.parameters.get('rightMs')!.value = delayMilliseconds(spec, 'right', bpm);
  };
  return {
    kind: 'delay',
    input,
    output,
    processor,
    set(next): void {
      spec = next;
      for (const name of DELAY_NUMBERS) processor.parameters.get(name)!.value = spec[name];
      processor.parameters.get('enabled')!.value = Number(spec.enabled);
      processor.parameters.get('mode')!.value = DELAY_MODE_IDS[spec.mode];
      timing();
    },
    setTempo(next): void {
      bpm = next;
      timing();
    },
    dispose(): void {
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      processor.port.close();
    },
  };
}
export const DELAY_INSERT: InsertKind<DelaySpec> = {
  fields: DELAY_FIELDS,
  defaults: DEFAULT_DELAY,
  normalise: normaliseDelay,
  create,
};
