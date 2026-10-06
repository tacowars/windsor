/** Fixed one-worklet graph: live edits preserve the insert and transport; disposal owns its node. */
import { SWITCH_FIELD, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import {
  ADVANCED_DRIVE_BOUNDS,
  ADVANCED_DRIVE_NAME,
  DRIVE_DSP,
  DRIVE_STAGE_BOUNDS,
} from './advancedDriveConstants';
import { DEFAULT_ADVANCED_DRIVE, normaliseAdvancedDrive } from './advancedDriveSpec';
import type { AdvancedDriveSpec } from './advancedDriveSpec';
import { advancedDriveParameters } from './advancedDriveParameters';

/** A stage's field, `stages.<i>.<field>`, as the catalog spells it. */
const STAGE_FIELD = /^stages\.(\d+)\.(\w+)$/;

/** A lane field's param: `drive` and `enabled` themselves, `stages.1.amount` as `s1_amount`. */
function driveParamOf(field: string): string | undefined {
  const stage = STAGE_FIELD.exec(field);
  if (!stage) {
    return Object.hasOwn(ADVANCED_DRIVE_BOUNDS, field) || field === SWITCH_FIELD
      ? field
      : undefined;
  }
  const [, index, name] = stage;
  const known = Number(index) < DRIVE_DSP.stages && Object.hasOwn(DRIVE_STAGE_BOUNDS, name!);
  return known ? `s${index}_${name}` : undefined;
}

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
  const params = workletFieldParams(
    processor,
    (name) => advancedDriveParameters(current, tempo)[name]!,
    driveParamOf,
  );
  const set = (next: AdvancedDriveSpec): void => {
    current = next;
    params.write(advancedDriveParameters(next, tempo));
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
    param: (field) => params.param(field),
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
