/**
 * The Plate reverb insert (windsor#171): the Dattorro plate the `room` return
 * runs, on a strip, with a Mix knob and an on/off switch.
 *
 *   input ─┬─▶ send ─▶ plate (wet = mix, dry = 1 − mix) ─▶ gate ─┬─▶ output
 *          └─▶ bypass ─────────────────────────────────────────┘
 *
 * Mix drives the processor's own `wet` and `dry`, so Mix 1 is the return
 * exactly (wet 1, dry 0) and Mix 0 is its dry path alone. Off closes `send`
 * and `gate` and opens `bypass`: the input passes unchanged, and the plate,
 * hearing silence, goes to sleep (#547). The plate is built by
 * `mixer/returnEffects.ts`, the return's own builder.
 */
import { REVERB_SPACE_RANGES } from '../audioConstants';
import type { PlateMix } from '../mixer/returnEffects';
import { createPlate, writePlate } from '../mixer/returnEffects';
import type { ReverbSpace } from '../mixer/reverbSpace';
import { SPACES } from '../mixer/reverbSpace';
import type { FieldNormaliser } from '../song/arrangementFields';
import type { InsertKind, InsertStage } from './insertKind';
import { PLATE_REVERB_MIX_DEFAULT, PLATE_REVERB_SPACE_DEFAULT } from './plateReverbConstants';

export interface PlateReverbSpec extends Readonly<ReverbSpace> {
  readonly kind: 'plate';
  /** 0 dry .. 1 the plate alone. */
  readonly mix: number;
  readonly enabled: boolean;
}

/** The 13 space fields, in the plate's own order. */
export const PLATE_SPACE_FIELDS = Object.keys(REVERB_SPACE_RANGES) as (keyof ReverbSpace)[];

export const DEFAULT_PLATE_REVERB: PlateReverbSpec = {
  kind: 'plate',
  ...SPACES[PLATE_REVERB_SPACE_DEFAULT],
  mix: PLATE_REVERB_MIX_DEFAULT,
  enabled: true,
};

const FIELDS = ['kind', ...PLATE_SPACE_FIELDS, 'mix', 'enabled'];

/** The spec's space, without its kind, mix or switch. */
export function plateSpace(spec: PlateReverbSpec): ReverbSpace {
  const space = {} as ReverbSpace;
  for (const field of PLATE_SPACE_FIELDS) space[field] = spec[field];
  return space;
}

/** Mix as the plate's own `wet` and `dry`: Mix 1 is the return's wet 1, dry 0. */
export const plateMix = (spec: PlateReverbSpec): PlateMix => ({ wet: spec.mix, dry: 1 - spec.mix });

function normalise(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): PlateReverbSpec {
  n.dropUnknown(raw, FIELDS, path);
  const base = DEFAULT_PLATE_REVERB;
  const space = plateSpace(base);
  for (const field of PLATE_SPACE_FIELDS) {
    const [min, max] = REVERB_SPACE_RANGES[field];
    space[field] = n.num(raw[field], base[field], min, max, `${path}.${field}`);
  }
  return {
    kind: 'plate',
    ...space,
    mix: n.num(raw.mix, base.mix, 0, 1, `${path}.mix`),
    enabled: n.bool(raw.enabled, base.enabled, `${path}.enabled`),
  };
}

function create(context: BaseAudioContext, spec: PlateReverbSpec): InsertStage<PlateReverbSpec> {
  const input = context.createGain();
  const send = context.createGain();
  const plate = createPlate(context, plateSpace(spec), plateMix(spec));
  const gate = context.createGain();
  const bypass = context.createGain();
  const output = context.createGain();

  input.connect(send);
  send.connect(plate);
  plate.connect(gate);
  gate.connect(output);
  input.connect(bypass);
  bypass.connect(output);

  const set = (next: PlateReverbSpec): void => {
    writePlate(plate, plateSpace(next));
    writePlate(plate, plateMix(next));
    send.gain.value = Number(next.enabled);
    gate.gain.value = Number(next.enabled);
    bypass.gain.value = Number(!next.enabled);
  };
  set(spec);

  return {
    kind: 'plate',
    input,
    output,
    processor: plate,
    set,
    // Everything this stage wired, and nothing out of `output`: the strip owns that edge.
    dispose(): void {
      for (const node of [input, send, plate, gate, bypass]) node.disconnect();
    },
  };
}

export const PLATE_REVERB_INSERT: InsertKind<PlateReverbSpec> = {
  fields: FIELDS,
  defaults: DEFAULT_PLATE_REVERB,
  normalise,
  create,
};
