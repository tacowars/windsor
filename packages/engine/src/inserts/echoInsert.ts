/**
 * The Echo insert (windsor#171): the `echo` return's delay line, on a strip,
 * with a Mix knob and an on/off switch. Native nodes only.
 *
 *   input ─┬─▶ send ─▶ [delay loop, soft clip] ─▶ wet (mix) ─┬─▶ output
 *          └─▶ dry (1 − mix) ───────────────────────────────┘
 *
 * The loop is `mixer/returnEffects.ts`'s `attachDelay`, the return's own
 * builder, so Mix 1 (dry 0, wet 1) is the return's line exactly. Off closes
 * `send` and `wet` and opens `dry`: the input passes unchanged and the loop
 * empties.
 */
import { RETURNS } from '../mixer/mix';
import type { DelayLineSettings } from '../mixer/returnEffects';
import { attachDelay, disconnectDelay, writeDelay } from '../mixer/returnEffects';
import type { FieldNormaliser } from '../song/arrangementFields';
import { ECHO_BOUNDS, ECHO_MIX_DEFAULT } from './echoConstants';
import type { InsertKind, InsertStage } from './insertKind';

export interface EchoSpec extends DelayLineSettings {
  readonly kind: 'echo';
  /** 0 dry .. 1 the repeats alone. */
  readonly mix: number;
  readonly enabled: boolean;
}

export const DEFAULT_ECHO: EchoSpec = {
  kind: 'echo',
  delayTime: RETURNS.echo.delayTime,
  feedback: RETURNS.echo.feedback,
  damp: RETURNS.echo.damp,
  resonance: RETURNS.echo.resonance,
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

  const set = (next: EchoSpec): void => {
    writeDelay(line, next);
    send.gain.value = Number(next.enabled);
    wet.gain.value = next.enabled ? next.mix : 0;
    dry.gain.value = next.enabled ? 1 - next.mix : 1;
  };
  set(spec);

  return {
    kind: 'echo',
    input,
    output,
    set,
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
