/**
 * The Filter insert's fixed graph (windsor#622): one stereo worklet node
 * running the voice's `Svf` and `Ladder` (`worklet/filter/`). The stage owns
 * the DSP's lifetime and the mixer owns its output edges. Cutoff, Reso and
 * Mix are k-rate params a lane may hold; the mode, the slope and the switch
 * are params `set` writes and no lane reaches.
 */
import { FILTER_BOUNDS, FILTER_MODES, FILTER_NAME } from './filterConstants';
import { DEFAULT_FILTER, FILTER_FIELDS, FILTER_NUMBERS, normaliseFilter } from './filterSpec';
import type { FilterSpec } from './filterSpec';
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';

/** Every param `set` writes, by name, for `spec`: the mode as its index in `FILTER_MODES`. */
function filterValues(spec: FilterSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of FILTER_NUMBERS) values[name] = spec[name];
  values.mode = FILTER_MODES.indexOf(spec.mode);
  values.slope24 = Number(spec.slope24);
  values.enabled = Number(spec.enabled);
  return values;
}

function create(context: BaseAudioContext, initial: FilterSpec): InsertStage<FilterSpec> {
  let spec = initial;
  const processor = new AudioWorkletNode(context, FILTER_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: filterValues(spec),
  });
  const input = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  const params = workletFieldParams(
    processor,
    (name) => filterValues(spec)[name]!,
    ownParam(FILTER_BOUNDS),
  );
  return {
    kind: 'filter',
    input,
    output,
    processor,
    set(next): void {
      spec = next;
      params.write(filterValues(spec));
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

export const FILTER_INSERT: InsertKind<FilterSpec> = {
  fields: FILTER_FIELDS,
  defaults: DEFAULT_FILTER,
  normalise: normaliseFilter,
  create,
};
