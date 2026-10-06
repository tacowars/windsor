/**
 * The drive insert (#641): a tanh saturator with a tone control and a
 * parallel dry path, and an on/off switch (windsor#171).
 *
 *   input ─┬─▶ pre (drive / RANGE) ─▶ shaper (tanh) ─▶ tone (lowpass) ─▶ wet ─┬─▶ output
 *          └─▶ dry ────────────────────────────────────────────────────────┘
 *
 * The curve is built once and never swapped: turning Drive is a gain write
 * before the shaper, so it cannot click the way reallocating a curve would.
 * `wet` carries the output compensation, which holds a −12 dBFS sample at
 * its own level whatever the drive, so the knob changes colour more than
 * loudness. `oversample: '2x'`, because a driven saw aliases audibly without it.
 * Off is `wet` 0 and `dry` 1, so the input passes unchanged; `enabled` is
 * additive and a spec without it loads as on. A switch lane (windsor#628)
 * writes the same two gains, and either way the switch crosses
 * `INSERT_SWITCH_FADE_S` (windsor#629): the gains read its fade, 0 to 1.
 *
 * The fader is the worklet's `gain`, before every stage, so a strip's Level
 * changes how hard it drives this insert; the Drive knob is the trim that
 * compensates (docs/log/2026-09-22-641-strip-inserts-over-a-code-owned-registry.md).
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { BUTTERWORTH_Q_DB } from '../audioConstants';
import { tanhCurve } from '../mixer/tanhCurve';
import {
  DRIVE_CURVE_POINTS,
  DRIVE_CURVE_RANGE,
  DRIVE_GAIN_DEFAULT_DB,
  DRIVE_GAIN_MAX_DB,
  DRIVE_GAIN_MIN_DB,
  DRIVE_MIX_DEFAULT,
  DRIVE_REFERENCE_LEVEL,
  DRIVE_TONE_DEFAULT_HZ,
  DRIVE_TONE_MAX_HZ,
  DRIVE_TONE_MIN_HZ,
  GAIN_EXPONENT_PER_DB,
} from './insertConstants';
import type { KnobTarget } from '../automation/automationHandles';
import type { FieldHandles } from './insertFieldHandles';
import { fieldHandles, SWITCH_FIELD, switchOf } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';

export interface DriveSpec {
  readonly kind: 'drive';
  /** dB of gain into the shaper. */
  readonly drive: number;
  /** Hz; the lowpass after the shaper. */
  readonly tone: number;
  /** 0 dry .. 1 wet. */
  readonly mix: number;
  readonly enabled: boolean;
}

export const DEFAULT_DRIVE: DriveSpec = {
  kind: 'drive',
  drive: DRIVE_GAIN_DEFAULT_DB,
  tone: DRIVE_TONE_DEFAULT_HZ,
  mix: DRIVE_MIX_DEFAULT,
  enabled: true,
};

const FIELDS = ['kind', 'drive', 'tone', 'mix', 'enabled'] as const;

const fromDb = (db: number): number => Math.exp(db * GAIN_EXPONENT_PER_DB);

/** The wet gain that maps a `DRIVE_REFERENCE_LEVEL` sample back to its own level. */
export function driveCompensation(driveDb: number): number {
  const gain = fromDb(driveDb);
  return DRIVE_REFERENCE_LEVEL / Math.tanh(gain * DRIVE_REFERENCE_LEVEL);
}

function normalise(raw: Record<string, unknown>, path: string, n: FieldNormaliser): DriveSpec {
  n.dropUnknown(raw, FIELDS, path);
  const base = DEFAULT_DRIVE;
  return {
    kind: 'drive',
    drive: n.num(raw.drive, base.drive, DRIVE_GAIN_MIN_DB, DRIVE_GAIN_MAX_DB, `${path}.drive`),
    tone: n.num(raw.tone, base.tone, DRIVE_TONE_MIN_HZ, DRIVE_TONE_MAX_HZ, `${path}.tone`),
    mix: n.num(raw.mix, base.mix, 0, 1, `${path}.mix`),
    enabled: n.bool(raw.enabled, base.enabled, `${path}.enabled`),
  };
}

/** The params the drive's knobs write. */
interface DriveParams {
  readonly pre: AudioParam;
  readonly tone: AudioParam;
  readonly wet: AudioParam;
  readonly dry: AudioParam;
}

/** The shaper's input gain for `drive` dB: the curve spans ±RANGE, scaled into [-1, 1]. */
const preGain = (drive: number): number => fromDb(drive) / DRIVE_CURVE_RANGE;
/** The wet and dry gains for the drive, the mix and the switch's fade, on (1) to off (0). */
const wetGain = (drive: number, mix: number, on: number): number =>
  on * mix * driveCompensation(drive);
const dryGain = (mix: number, on: number): number => 1 - on * mix;

/**
 * Each knob's lane (windsor#345): Drive moves the shaper's gain, Tone the
 * lowpass. The wet gain (the mix times the drive's compensation, while on)
 * follows Drive, Mix and the switch (windsor#628), and the dry gain Mix and
 * the switch, each from every field's own value at every breakpoint any of
 * them has.
 */
function driveHandles(p: DriveParams, spec: () => DriveSpec, now: () => number): FieldHandles {
  const wet = { params: [p.wet], fields: ['drive', 'mix', SWITCH_FIELD], value: wetGain };
  const dry = { params: [p.dry], fields: ['mix', SWITCH_FIELD], value: dryGain };
  return fieldHandles(
    (field): KnobTarget | undefined => {
      if (field === SWITCH_FIELD) {
        return { params: [], write: () => [], resting: () => switchOf(spec()) };
      }
      const resting = (): number => spec()[field as 'drive' | 'tone' | 'mix'];
      if (field === 'drive') return { params: [p.pre], write: (v) => [preGain(v)], resting };
      // Mix writes only the wet and dry gains, which it shares.
      if (field === 'mix') return { params: [], write: () => [], resting };
      return field === 'tone' ? { params: [p.tone], write: (v) => [v], resting } : undefined;
    },
    { params: [wet, dry], now },
  );
}

function create(context: BaseAudioContext, spec: DriveSpec): InsertStage<DriveSpec> {
  const input = context.createGain();
  const pre = context.createGain();
  const shaper = context.createWaveShaper();
  const tone = context.createBiquadFilter();
  const wet = context.createGain();
  const dry = context.createGain();
  const output = context.createGain();

  shaper.curve = tanhCurve(DRIVE_CURVE_RANGE, DRIVE_CURVE_POINTS);
  shaper.oversample = '2x';
  tone.type = 'lowpass';
  tone.Q.value = BUTTERWORTH_Q_DB;

  input.connect(pre);
  pre.connect(shaper);
  shaper.connect(tone);
  tone.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);

  let current = spec;
  const params = { pre: pre.gain, tone: tone.frequency, wet: wet.gain, dry: dry.gain };
  const knobs = driveHandles(
    params,
    () => current,
    () => context.currentTime,
  );
  const set = (next: DriveSpec): void => {
    current = next;
    const lane = (field: string): boolean => knobs.automated(field);
    if (!lane('drive')) pre.gain.value = preGain(next.drive);
    if (!lane('tone')) tone.frequency.value = next.tone;
    knobs.writeShared();
  };
  set(spec);

  return {
    kind: 'drive',
    input,
    output,
    set,
    param: (field) => knobs.param(field),
    // Everything this stage wired, and nothing out of `output`: the strip owns that edge.
    dispose(): void {
      for (const node of [input, pre, shaper, tone, wet, dry]) node.disconnect();
    },
  };
}

export const DRIVE_INSERT: InsertKind<DriveSpec> = {
  fields: FIELDS,
  defaults: DEFAULT_DRIVE,
  normalise,
  create,
};
