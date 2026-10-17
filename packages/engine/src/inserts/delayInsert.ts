/** Fixed stereo worklet graph. Settings and song tempo only write parameters. */
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { DELAY_BOUNDS, DELAY_DSP, DELAY_NAME } from './delayConstants';
import { delayParameters as delayValues, delayTiming as timing } from './delayParameters';
import { DEFAULT_DELAY, DELAY_FIELDS, normaliseDelay } from './delaySpec';
import type { DelaySpec } from './delaySpec';

/** A field's param: the numbers' own, the switch, and Sustain, a switch lane of its own. */
const sustainOrOwn = (field: string): string | undefined =>
  field === 'sustain' ? field : ownParam(DELAY_BOUNDS)(field);

function create(context: BaseAudioContext, initial: DelaySpec): InsertStage<DelaySpec> {
  let spec = initial;
  let bpm: number = DELAY_DSP.defaultBpm;
  const processor = new AudioWorkletNode(context, DELAY_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: delayValues(spec, bpm),
  });
  const input = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  const params = workletFieldParams(
    processor,
    (name) => delayValues(spec, bpm)[name]!,
    sustainOrOwn,
  );
  return {
    kind: 'delay',
    input,
    output,
    processor,
    set(next): void {
      spec = next;
      params.write(delayValues(spec, bpm));
    },
    setTempo(next): void {
      bpm = next;
      params.write(timing(spec, bpm));
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
export const DELAY_INSERT: InsertKind<DelaySpec> = {
  fields: DELAY_FIELDS,
  defaults: DEFAULT_DELAY,
  normalise: normaliseDelay,
  create,
};
