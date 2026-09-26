/** Fixed one-worklet graph: live edits preserve the insert and transport; disposal owns its node. */
import type { InsertKind, InsertStage } from './insertKind';
import { ADVANCED_DRIVE_NAME, DRIVE_DSP } from './advancedDriveConstants';
import { DEFAULT_ADVANCED_DRIVE, normaliseAdvancedDrive } from './advancedDriveSpec';
import type { AdvancedDriveSpec } from './advancedDriveSpec';
import { advancedDriveParameters } from './advancedDriveParameters';
function create(
  context: BaseAudioContext,
  spec: AdvancedDriveSpec,
): InsertStage<AdvancedDriveSpec> {
  let current = spec,
    tempo = DRIVE_DSP.defaultTempo;
  const processor = new AudioWorkletNode(context, ADVANCED_DRIVE_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: advancedDriveParameters(spec, tempo),
  });
  const input = context.createGain(),
    output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  const set = (next: AdvancedDriveSpec): void => {
    current = next;
    for (const [key, value] of Object.entries(advancedDriveParameters(next, tempo)))
      processor.parameters.get(key)!.value = value;
  };
  return {
    kind: 'advanced-drive',
    input,
    output,
    processor,
    set,
    setTempo(bpm): void {
      tempo = bpm;
      set(current);
    },
    dispose(): void {
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      processor.port.close();
    },
  };
}
export const ADVANCED_DRIVE_INSERT: InsertKind<AdvancedDriveSpec> = {
  fields: Object.keys(DEFAULT_ADVANCED_DRIVE),
  defaults: DEFAULT_ADVANCED_DRIVE,
  normalise: normaliseAdvancedDrive,
  create,
};
