/**
 * The Echo insert (windsor#171): the `echo` return's delay line, on a strip
 * or a send bus, with a Mix knob and an on/off switch. Native nodes only.
 *
 *   input ─┬─▶ send ─▶ [delay loop, soft clip] ─▶ direct ─▶ wet (mix) ─┬─▶ output
 *          └─▶ dry (1 − mix) ─────────────────────────────────────────┘
 *
 * Echo is a host (windsor#688, record `2026-10-11-wet-path-slot`): a slot
 * child takes the loop's output and returns into `wet`, beside `direct`,
 * which is unity until a child arrives and crosses to 0 while it is there
 * (`wetPath`, wired by `mixer/insertSlot.ts`). The child is outside the
 * feedback, and `wet`'s Mix and switch act after it.
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
 *
 * The loop's time follows the song's tempo while Sync is on (windsor#816,
 * record `2026-10-16-echo-follows-song-tempo`): `setTempo` and `set` glide
 * it to the note value's length at the song's BPM (`echoTempo.ts`), and the
 * switch's wait reads that length. Free, it is `delayTime`, as before.
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
import { DELAY_DIVISIONS } from './delayConstants';
import {
  ECHO_BOUNDS,
  ECHO_DEFAULT_BPM,
  ECHO_DIVISION_DEFAULT,
  ECHO_LINE_DEFAULTS,
  ECHO_MIX_DEFAULT,
} from './echoConstants';
import { loopSettlesIn } from './echoSwitchSettle';
import type { EchoDivision, EchoTiming } from './echoTempo';
import { echoSeconds, echoTimeWriter } from './echoTempo';
import type { FieldHandles } from './insertFieldHandles';
import { fieldHandles, SWITCH_FIELD, switchOf } from './insertFieldHandles';
import { fadeRamp } from './fadeRamp';
import type { InsertKind, InsertStage, WetPath } from './insertKind';
import type { InsertSpec } from './insertRegistry';
import type { FieldReader } from './switchTimeline';

export interface EchoSpec extends DelayLineSettings, EchoTiming {
  readonly kind: 'echo';
  /** 0 dry .. 1 the repeats alone. */
  readonly mix: number;
  readonly enabled: boolean;
  /**
   * The child insert on the repeats, before Mix (record
   * `2026-10-11-wet-path-slot`): Echo is a host. Absent or null is none, so a
   * spec built in code without it is valid. The registry normalises it.
   */
  readonly slot?: InsertSpec | null;
}

export const DEFAULT_ECHO: EchoSpec = {
  kind: 'echo',
  ...ECHO_LINE_DEFAULTS,
  sync: true,
  division: ECHO_DIVISION_DEFAULT,
  mix: ECHO_MIX_DEFAULT,
  enabled: true,
  slot: null,
};

export const ECHO_NUMBERS = Object.keys(ECHO_BOUNDS) as (keyof typeof ECHO_BOUNDS)[];
const FIELDS = ['kind', ...ECHO_NUMBERS, 'sync', 'division', 'enabled', 'slot'];
const DIVISIONS = Object.keys(DELAY_DIVISIONS) as EchoDivision[];

/** Echo's own fields; `slot` is the registry's (`normaliseInsertEntry`), so this leaves it empty. */
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
    // Not DEFAULT_ECHO's: an Echo saved before Sync (windsor#816) plays its saved seconds, free.
    sync: n.bool(raw.sync, false, `${path}.sync`),
    division: n.pick(raw.division, DIVISIONS, DEFAULT_ECHO.division, `${path}.division`),
    mix: num('mix'),
    enabled: n.bool(raw.enabled, DEFAULT_ECHO.enabled, `${path}.enabled`),
    slot: null,
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

/**
 * The loop fields `set` writes directly: all but the feedback, which the
 * switch shares, and the time, which follows the tempo while synced.
 */
const OWN_LINE_FIELDS = DELAY_LINE_FIELDS.filter((f) => f !== 'feedback' && f !== 'delayTime');

/**
 * What one field's lane writes on its own: a loop field its param; the rest
 * only what they share. The time rests at what the loop plays, `seconds`.
 */
function echoTarget(
  field: string,
  line: DelayLine,
  spec: () => EchoSpec,
  seconds: () => number,
): KnobTarget | undefined {
  if (field === SWITCH_FIELD) {
    return { params: [], write: () => [], resting: () => switchOf(spec()) };
  }
  // Mix and Feedback write only gains they share with the switch.
  if (field === 'mix' || field === 'feedback') {
    return { params: [], write: () => [], resting: () => spec()[field] };
  }
  if (!isLineField(field)) return undefined;
  const { param, value } = delayLineParam(line, field);
  const resting = field === 'delayTime' ? seconds : () => spec()[field];
  return { params: [param], write: (v) => [value(v)], resting };
}

/**
 * Echo's wet path (windsor#688): its slot's child takes the loop's output,
 * after the loop and outside the feedback, and comes back into `wet`, so Mix
 * and the switch act after it. `route` crosses `direct`, the loop's own edge
 * into `wet`, over one insert fade from now.
 */
function echoWetPath(
  context: BaseAudioContext,
  line: DelayLine,
  direct: GainNode,
  wet: GainNode,
): WetPath {
  // From where `direct` has reached now, so a route reversed mid-window turns round with no step.
  const ramp = fadeRamp(context, direct.gain);
  return {
    send: { node: line.damp, output: 0 },
    ret: wet,
    route: (on: boolean): void => ramp.to(on ? 0 : 1),
  };
}

/** Echo's nodes, wired as the diagram at the top has them, the loop at `seconds`. */
function echoGraph(context: BaseAudioContext, spec: EchoSpec, seconds: number) {
  const input = context.createGain();
  const send = context.createGain();
  // Unity unless a slot child takes the repeats: built either way, so the stage stays the same object.
  const direct = context.createGain();
  const wet = context.createGain();
  const dry = context.createGain();
  const output = context.createGain();
  const line = attachDelay(context, send, direct, { ...spec, delayTime: seconds });

  input.connect(send);
  direct.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);
  return { input, send, direct, wet, dry, output, line };
}

/** Echo's graph, as `echoGraph` builds it. */
type EchoGraph = ReturnType<typeof echoGraph>;

/**
 * Echo's lane handles (windsor#345, windsor#628, windsor#629): a loop field on
 * its own param, and every gain the switch moves from its fade and the knob
 * beside it. `spec` and `seconds` read the stage's spec and the time its loop
 * plays now.
 */
function echoHandles(
  context: BaseAudioContext,
  { send, wet, dry, line }: EchoGraph,
  spec: () => EchoSpec,
  seconds: () => number,
): FieldHandles {
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
  return fieldHandles((field) => echoTarget(field, line, spec, seconds), {
    params: [
      settled([wet.gain], ['mix'], wetGain),
      settled([dry.gain], ['mix'], dryGain),
      switched([send.gain], [], (on) => on),
      settled([feedback.param], ['feedback'], (gain, on) => on * feedback.value(gain)),
    ],
    now: () => context.currentTime,
  });
}

function create(context: BaseAudioContext, spec: EchoSpec): InsertStage<EchoSpec> {
  let current = spec;
  // The song's tempo arrives through `setTempo` (`tempoInsertRegistry.ts`); until then, the default.
  let bpm = ECHO_DEFAULT_BPM;
  const seconds = (): number => echoSeconds(current, bpm);
  const graph = echoGraph(context, spec, seconds());
  const { input, send, direct, wet, dry, output, line } = graph;
  const knobs = echoHandles(context, graph, () => current, seconds);
  const writeTime = echoTimeWriter({
    param: line.effect.delayTime,
    now: () => context.currentTime,
    held: () => knobs.automated('delayTime'),
    initial: seconds(),
  });
  const set = (next: EchoSpec): void => {
    current = next;
    const loop: Partial<Record<keyof DelayLineSettings, number>> = {};
    for (const field of OWN_LINE_FIELDS) if (!knobs.automated(field)) loop[field] = next[field];
    writeDelay(line, loop);
    writeTime(seconds(), next.sync);
    knobs.writeShared();
  };
  set(spec);

  return {
    kind: 'echo',
    input,
    output,
    wetPath: echoWetPath(context, line, direct, wet),
    set,
    setTempo(next): void {
      if (Object.is(next, bpm)) return;
      bpm = next;
      if (current.sync) writeTime(seconds(), true);
    },
    param: (field) => knobs.param(field),
    // The loop's own nodes too, as the return's `dispose` does; never the edge out of `output`.
    dispose(): void {
      for (const node of [input, send, direct, wet, dry]) node.disconnect();
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
