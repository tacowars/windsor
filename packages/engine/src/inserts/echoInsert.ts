/**
 * The Echo insert (windsor#171): the `echo` return's delay line, on a strip
 * or a send bus, with a Mix knob and an on/off switch. Native nodes only.
 *
 *   input ─┬─▶ send ─▶ [delay loop, soft clip] ─▶ wet (mix) ─┬─▶ output
 *          └─▶ dry (1 − mix) ───────────────────────────────┘
 *
 * The loop is `mixer/returnEffects.ts`'s `attachDelay`, the return's own
 * builder, so Mix 1 (dry 0, wet 1) is the return's line exactly. Off closes
 * `send` and `wet`, opens `dry` and mutes the loop's feedback: the input
 * passes unchanged, and the loop, fed nothing and feeding nothing back,
 * empties within one delay time, so switching on again never brings back
 * the old repeats (windsor#629). A native delay line cannot be cleared, so
 * the feedback mute is what cuts the tail. A switch lane (windsor#628)
 * writes the same gains, and either way each reads the switch's fade over
 * `INSERT_SWITCH_FADE_S`: `send` alone, `wet` and `dry` with Mix, the
 * feedback with the Feedback knob. A switch on within a delay time of the
 * off's end keeps `wet`, `dry` and the feedback where off left them until
 * the loop has emptied (`echoSwitchSettle.ts`, fix round 1 for PR #635) and
 * its damp filter has rung out (fix round 2), while `send` opens at once.
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
import { loopSettlesIn } from './echoSwitchSettle';
import { fieldHandles, SWITCH_FIELD, switchOf } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import type { FieldReader } from './switchTimeline';

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

/** A gain the switch moves, from the knobs beside it and, last, the switch's fade. */
type SwitchedGain = (...values: number[]) => number;

const isLineField = (field: string): field is keyof DelayLineSettings =>
  (DELAY_LINE_FIELDS as readonly string[]).includes(field);

/** The wet and dry gains at `mix`, with the switch's fade `on` (1) to off (0). */
const wetGain = (mix: number, on: number): number => on * mix;
const dryGain = (mix: number, on: number): number => 1 - on * mix;

/** The fields whose lanes, or knobs, say how long the loop takes to empty: the line's, then the damp filter's. */
const SETTLE_FIELDS = ['delayTime', 'damp', 'resonance'] as const;

/** The loop fields `set` writes directly: all but the feedback, which the switch shares. */
const OWN_LINE_FIELDS = DELAY_LINE_FIELDS.filter((field) => field !== 'feedback');

/** What one field's lane writes on its own: a loop field its param; the rest only what they share. */
function echoTarget(field: string, line: DelayLine, spec: () => EchoSpec): KnobTarget | undefined {
  if (field === SWITCH_FIELD) {
    return { params: [], write: () => [], resting: () => switchOf(spec()) };
  }
  // Mix and Feedback write only gains they share with the switch.
  if (field === 'mix' || field === 'feedback') {
    return { params: [], write: () => [], resting: () => spec()[field] };
  }
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
  // Each lane (windsor#345, windsor#628, windsor#629): a loop field on its own
  // param, and every gain the switch moves from its fade and the knob beside it.
  const feedback = delayLineParam(line, 'feedback');
  const switched = (params: AudioParam[], fields: string[], value: SwitchedGain) => ({
    params,
    fields: [...fields, SWITCH_FIELD],
    value,
  });
  // What the loop's output reaches waits, after an off, until the loop is
  // empty and its damp filter has rung out (`echoSwitchSettle.ts`); Delay
  // Time, Damp and Resonance, read last, only time that.
  const settled = (params: AudioParam[], fields: string[], value: SwitchedGain) => ({
    ...switched(params, fields, value),
    fields: [...fields, SWITCH_FIELD, ...SETTLE_FIELDS],
    settle: (offEnd: number, read: readonly FieldReader[]) => {
      const [delayTime, damp, resonance] = read.slice(-SETTLE_FIELDS.length);
      return loopSettlesIn(offEnd, {
        delayTime: delayTime!,
        damp: damp!,
        resonance: resonance!,
        sampleRate: context.sampleRate,
      });
    },
  });
  const knobs = fieldHandles((field) => echoTarget(field, line, () => current), {
    params: [
      settled([wet.gain], ['mix'], wetGain),
      settled([dry.gain], ['mix'], dryGain),
      switched([send.gain], [], (on) => on),
      settled([feedback.param], ['feedback'], (gain, on) => on * feedback.value(gain)),
    ],
    now: () => context.currentTime,
  });
  const set = (next: EchoSpec): void => {
    current = next;
    const loop: Partial<Record<keyof DelayLineSettings, number>> = {};
    for (const field of OWN_LINE_FIELDS) if (!knobs.automated(field)) loop[field] = next[field];
    writeDelay(line, loop);
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
