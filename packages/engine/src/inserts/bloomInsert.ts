/**
 * bloom's stage: input → processor → output. The stage owns DSP lifetime,
 * the mixer owns output edges.
 */
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { BLOOM_BOUNDS, BLOOM_KEYS, BLOOM_NAME, BLOOM_SCALES, BLOOM_SLOT } from './bloomConstants';
import {
  BLOOM_FIELDS,
  BLOOM_NUMBERS,
  BLOOM_SWITCHES,
  DEFAULT_BLOOM,
  normaliseBloom,
} from './bloomSpec';
import type { BloomSpec } from './bloomSpec';

/**
 * Every param `set` writes, by name, for `spec`: the numbers as they are,
 * the switches as 0/1, Key and Scale by index. The processor's `split`
 * param is no field's, so it is not here.
 */
export function bloomValues(spec: BloomSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of BLOOM_NUMBERS) values[name] = spec[name];
  for (const name of BLOOM_SWITCHES) values[name] = Number(spec[name]);
  values.key = BLOOM_KEYS.indexOf(spec.key);
  values.scale = BLOOM_SCALES.indexOf(spec.scale);
  return values;
}

/** The fields a lane may hold: the numbers, the switch and Freeze. Key and Scale are enums (guide §4.5). */
const numberOrSwitch = ownParam(BLOOM_BOUNDS);
const bloomParamOf = (field: string): string | undefined =>
  field === 'freeze' ? field : numberOrSwitch(field);

/** bloom's kind: input → processor → output. */
export const BLOOM_INSERT: InsertKind<BloomSpec> = {
  fields: BLOOM_FIELDS,
  defaults: DEFAULT_BLOOM,
  normalise: normaliseBloom,
  create(context, spec): InsertStage<BloomSpec> {
    let current = spec;
    // Output 0 only: bloom as a wet-path slot host builds outputs 1 and 2 (`BLOOM_SLOT`).
    const processor = new AudioWorkletNode(context, BLOOM_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      parameterData: bloomValues(spec),
    });
    const input = context.createGain();
    const output = context.createGain();
    input.connect(processor);
    processor.connect(output, BLOOM_SLOT.mixOutput);
    const params = workletFieldParams(
      processor,
      (name) => bloomValues(current)[name]!,
      bloomParamOf,
    );
    return {
      kind: 'bloom',
      input,
      output,
      processor,
      set(next): void {
        current = next;
        params.write(bloomValues(next));
      },
      param: (field) => params.param(field),
      dispose(): void {
        input.disconnect();
        processor.disconnect();
        processor.port.postMessage({ type: 'stop' });
        processor.port.close();
      },
    };
  },
};
