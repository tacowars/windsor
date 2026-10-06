/**
 * The Echo insert (windsor#171): the `echo` return's delay line, on a strip
 * or a send bus, with a Mix knob and an on/off switch. Native nodes only.
 *
 *   input ─┬─▶ send ─▶ [delay loop, soft clip] ─▶ wet (mix) ─┬─▶ output
 *          └─▶ dry (1 − mix) ───────────────────────────────┘
 *
 * The loop is `mixer/returnEffects.ts`'s `attachDelay`, the return's own
 * builder, so Mix 1 (dry 0, wet 1) is the return's line exactly. Off closes
 * `send` and `wet` and opens `dry`: the input passes unchanged and the loop
 * empties. A switch lane (windsor#628) writes the same: `send` on its own,
 * and `wet` and `dry` from the switch and Mix together.
 */
import type { DelayLine, DelayLineSettings } from '../mixer/returnEffects';
import {
  attachDelay,
  DELAY_LINE_FIELDS,
  delayLineParam,
  disconnectDelay,
  writeDelay,
} from '../mixer/returnEffects';
import type { KnobTarget } from '../automation/automationHandles';
import type { FieldNormaliser } from '../song/arrangementFields';
import { ECHO_BOUNDS, ECHO_LINE_DEFAULTS, ECHO_MIX_DEFAULT } from './echoConstants';
import { fieldHandles, SWITCH_FIELD, switchOf } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';

export interface EchoSpec extends DelayLineSettings {
  readonly kind: 'echo';
  /** 0 dry .. 1 the repeats alone. */
  readonly mix: number;
  readonly enabled: boolean;
}

export const DEFAULT_ECHO: EchoSpec = {
  kind: 'echo',
  ...ECHO_LINE_DEFAULTS,
  mix: ECHO_MIX_DEFAULT,
  enabled: true,
};

export const ECHO_NUMBERS = Object.keys(ECHO_BOUNDS) as (keyof typeof ECHO_BOUNDS)[];
const FIELDS = ['kind', ...ECHO_NUMBERS, 'enabled'];

function normalise(raw: Record<string, unknown>, path: string, n: FieldNormaliser): EchoSpec {
  n.dropUnknown(raw, FIELDS, path);
  const num = (field: (typeof ECHO_NUMBERS)[number]): number => {
    const [min, max] = ECHO_BOUNDS[field];
    return n.num(raw[field], DEFAULT_ECHO[field], min, max, `${path}.${field}`);
  };
  return {
    kind: 'echo',
    delayTime: num('delayTime'),
    feedback: num('feedback'),
    damp: num('damp'),
    resonance: num('resonance'),
    mix: num('mix'),
    enabled: n.bool(raw.enabled, DEFAULT_ECHO.enabled, `${path}.enabled`),
  };
}

const isLineField = (field: string): field is keyof DelayLineSettings =>
  (DELAY_LINE_FIELDS as readonly string[]).includes(field);

/** The wet and dry gains at `mix`, with the switch `on` (1) or off (0). */
const wetGain = (mix: number, on: number): number => (on ? mix : 0);
const dryGain = (mix: number, on: number): number => (on ? 1 - mix : 1);

/** What one field's lane writes on its own: a loop field its param, the switch the send. */
function echoTarget(
  field: string,
  line: DelayLine,
  send: AudioParam,
  spec: () => EchoSpec,
): KnobTarget | undefined {
  if (field === SWITCH_FIELD) {
    return { params: [send], write: (v) => [v], resting: () => switchOf(spec()) };
  }
  // Mix writes only the wet and dry gains, which it shares with the switch.
  if (field === 'mix') return { params: [], write: () => [], resting: () => spec().mix };
  if (!isLineField(field)) return undefined;
  const { param, value } = delayLineParam(line, field);
  return { params: [param], write: (v) => [value(v)], resting: () => spec()[field] };
}

function create(context: BaseAudioContext, spec: EchoSpec): InsertStage<EchoSpec> {
  const input = context.createGain();
  const send = context.createGain();
  const wet = context.createGain();
  const dry = context.createGain();
  const output = context.createGain();
  const line = attachDelay(context, send, wet, spec);

  input.connect(send);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);

  let current = spec;
  // Each lane (windsor#345, windsor#628): a loop field on its own param, the
  // switch on the send, and the wet and dry gains from Mix and the switch both.
  const mixed = (params: AudioParam[], value: (mix: number, on: number) => number) => ({
    params,
    fields: ['mix', SWITCH_FIELD],
    value,
  });
  const knobs = fieldHandles((field) => echoTarget(field, line, send.gain, () => current), {
    params: [mixed([wet.gain], wetGain), mixed([dry.gain], dryGain)],
    now: () => context.currentTime,
  });
  const set = (next: EchoSpec): void => {
    current = next;
    const lane = (field: string): boolean => knobs.automated(field);
    const loop: Partial<Record<keyof DelayLineSettings, number>> = {};
    for (const field of DELAY_LINE_FIELDS) if (!lane(field)) loop[field] = next[field];
    writeDelay(line, loop);
    if (!lane(SWITCH_FIELD)) send.gain.value = switchOf(next);
    knobs.writeShared();
  };
  set(spec);

  return {
    kind: 'echo',
    input,
    output,
    set,
    param: (field) => knobs.param(field),
    // The loop's own nodes too, as the return's `dispose` does; never the edge out of `output`.
    dispose(): void {
      for (const node of [input, send, wet, dry]) node.disconnect();
      disconnectDelay(line);
    },
  };
}

export const ECHO_INSERT: InsertKind<EchoSpec> = {
  fields: FIELDS,
  defaults: DEFAULT_ECHO,
  normalise,
  create,
};
