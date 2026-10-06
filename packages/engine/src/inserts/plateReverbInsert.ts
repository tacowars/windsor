/**
 * The Plate reverb insert (windsor#171): the Dattorro plate the `room` return
 * runs, on a strip, with a Mix knob and an on/off switch.
 *
 *   input ─┬─▶ send ─▶ plate (wet = mix, dry = 1 − mix) ─▶ gate ─┬─▶ output
 *          └─▶ bypass ─────────────────────────────────────────┘
 *
 * Mix drives the processor's own `wet` and `dry`, so Mix 1 is the return
 * exactly (wet 1, dry 0) and Mix 0 is its dry path alone. Off closes `send`
 * and `gate` and opens `bypass`: the input passes unchanged. The plate is
 * built by `mixer/returnEffects.ts`, the return's own builder. A switch lane
 * (windsor#628) writes the same gains.
 *
 * The switch crosses `INSERT_SWITCH_FADE_S` (windsor#629): `gate` and
 * `bypass` read its fade, so the plate's whole output, its own dry path
 * included, crossfades with the input. `send` and the plate's `clear` read
 * whether it is fed: the send opens at the switch on, before the gate opens,
 * and closes once the gate has shut, and from then `clear` holds the tank
 * empty, so the old tail is cut and switching on again starts a new one.
 * A switch on soon after an off waits until `clear` has been up two quanta
 * past the fade out's end (fix round 1 for PR #635).
 */
import { RENDER_QUANTUM_FRAMES, REVERB_SPACE_RANGES } from '../audioConstants';
import type { PlateMix } from '../mixer/returnEffects';
import { createPlate, writePlate } from '../mixer/returnEffects';
import type { ReverbSpace } from '../mixer/reverbSpace';
import { SPACES } from '../mixer/reverbSpace';
import type { FieldNormaliser } from '../song/arrangementFields';
import type { KnobTarget } from '../automation/automationHandles';
import { sameValue } from '../automation/automationHandles';
import type { FieldHandles } from './insertFieldHandles';
import { fieldHandles, SWITCH_FIELD, switchOf } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import {
  PLATE_CLEAR_QUANTA,
  PLATE_REVERB_MIX_DEFAULT,
  PLATE_REVERB_SPACE_DEFAULT,
} from './plateReverbConstants';
import type { SharedParam } from './sharedParamSchedule';
import type { SwitchView } from './switchTimeline';

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

/** The plate's param that empties its tank (`worklet/reverb/reverbProcessor.ts`). */
const CLEAR_PARAM = 'clear';

const isSpaceField = (field: string): field is keyof ReverbSpace =>
  (PLATE_SPACE_FIELDS as readonly string[]).includes(field);

/** The params the switch moves: what `set` writes for `enabled`. */
interface PlateSwitch {
  readonly send: AudioParam;
  readonly gate: AudioParam;
  readonly bypass: AudioParam;
  /** The plate's own: 1 empties the tank and keeps it empty. */
  readonly clear: AudioParam;
}

/**
 * The switch's params, each from the switch's fade or from whether the plate
 * is fed. All four read it settled (fix round 1 for PR #635): `clear` is
 * k-rate, read at a quantum's start, so a clear raised at the fade out's end
 * and dropped by a quick switch on could fall between two quanta and leave
 * the old tank. So `clear` stays up `PLATE_CLEAR_QUANTA` quanta past the
 * fade out's end, and the send and the gate reopen only as it falls: a
 * quick switch on waits at most that long.
 */
function switched(gains: PlateSwitch, sampleRate: number): SharedParam[] {
  const settle = (): number => (PLATE_CLEAR_QUANTA * RENDER_QUANTUM_FRAMES) / sampleRate;
  const by = (
    param: AudioParam,
    value: (on: number) => number,
    switchView: SwitchView = 'fade',
  ) => ({
    params: [param],
    fields: [SWITCH_FIELD],
    value,
    switchView,
    settle,
  });
  return [
    by(gains.gate, (on) => on),
    by(gains.bypass, (on) => 1 - on),
    by(gains.send, (open) => open, 'open'),
    by(gains.clear, (open) => 1 - open, 'open'),
  ];
}

/**
 * Each knob's lane (windsor#345): a space field on the plate's param of its
 * name, Mix on the plate's own `wet` and `dry`, the switch on the send, gate,
 * bypass and clear (windsor#628, windsor#629). The plate reads `decay` and
 * `wet` once per block, unsmoothed, so a fast lane there steps every 128
 * samples.
 */
function plateHandles(
  plate: AudioWorkletNode,
  gains: PlateSwitch,
  spec: () => PlateReverbSpec,
): FieldHandles {
  const now = (): number => plate.context.currentTime;
  return fieldHandles(
    (field): KnobTarget | undefined => {
      if (field === SWITCH_FIELD) {
        return { params: [], write: () => [], resting: () => switchOf(spec()) };
      }
      const resting = (): number => spec()[field as keyof ReverbSpace | 'mix'];
      if (field === 'mix') {
        const params = [plate.parameters.get('wet')!, plate.parameters.get('dry')!];
        const write = (v: number) => {
          const mix = plateMix({ ...spec(), mix: v });
          return [mix.wet, mix.dry];
        };
        return { params, write, resting };
      }
      const param = isSpaceField(field) ? plate.parameters.get(field) : undefined;
      return param && { params: [param], write: sameValue, resting };
    },
    { params: switched(gains, plate.context.sampleRate), now },
  );
}

/** The fields of `values` no lane holds. */
function unheld<T extends object>(values: T, knobs: FieldHandles): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(values) as (keyof T & string)[]) {
    if (!knobs.automated(key)) out[key] = values[key];
  }
  return out;
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

  let current = spec;
  const clear = plate.parameters.get(CLEAR_PARAM)!;
  const knobs = plateHandles(
    plate,
    { send: send.gain, gate: gate.gain, bypass: bypass.gain, clear },
    () => current,
  );
  const set = (next: PlateReverbSpec): void => {
    current = next;
    writePlate(plate, unheld(plateSpace(next), knobs));
    if (!knobs.automated('mix')) writePlate(plate, plateMix(next));
    knobs.writeShared();
  };
  set(spec);

  return {
    kind: 'plate',
    input,
    output,
    processor: plate,
    set,
    param: (field) => knobs.param(field),
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
