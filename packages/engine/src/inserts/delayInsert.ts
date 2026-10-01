/** Fixed stereo worklet graph. Settings and song tempo only write parameters. */
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { DELAY_BOUNDS, DELAY_DSP, DELAY_MODE_IDS, DELAY_NAME } from './delayConstants';
import {
  DEFAULT_DELAY,
  DELAY_FIELDS,
  DELAY_NUMBERS,
  delayMilliseconds,
  normaliseDelay,
} from './delaySpec';
import type { DelaySpec } from './delaySpec';

/** The two sides' times `set` and `setTempo` write: a synced side's from the tempo. */
const timing = (spec: DelaySpec, bpm: number): Record<string, number> => ({
  leftMs: delayMilliseconds(spec, 'left', bpm),
  rightMs: delayMilliseconds(spec, 'right', bpm),
});

/** Every param `set` writes, by name, for `spec` at `bpm`. */
function delayValues(spec: DelaySpec, bpm: number): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of DELAY_NUMBERS) values[name] = spec[name];
  values.enabled = Number(spec.enabled);
  values.mode = DELAY_MODE_IDS[spec.mode];
  return { ...values, ...timing(spec, bpm) };
}

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
    ownParam(DELAY_BOUNDS),
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
