/**
 * The Parametric EQ as an insert kind (windsor#198): one stereo worklet node
 * between the stage's own input and output gains. `set` writes the flat
 * k-rate parameters and never re-wires. Not yet in `INSERT_KINDS`: the
 * console card that every registered kind needs comes with windsor#199.
 * Pinned by `eqInsert.test.ts`.
 */
import type { InsertKind, InsertStage } from './insertKind';
import { EQ_NAME } from './eqConstants';
import { eqParameterValues } from './eqParameters';
import { DEFAULT_EQ, EQ_FIELDS, normaliseEq } from './eqSpec';
import type { EqSpec } from './eqSpec';

function create(context: BaseAudioContext, spec: EqSpec): InsertStage<EqSpec> {
  const values = eqParameterValues(spec);
  const processor = new AudioWorkletNode(context, EQ_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: values,
  });
  const input = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  return {
    kind: 'eq',
    input,
    output,
    processor,
    set(next): void {
      eqParameterValues(next, values);
      for (const name in values) processor.parameters.get(name)!.value = values[name]!;
    },
    dispose(): void {
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      processor.port.close();
    },
  };
}

export const EQ_INSERT: InsertKind<EqSpec> = {
  fields: EQ_FIELDS,
  defaults: DEFAULT_EQ,
  normalise: normaliseEq,
  create,
};
