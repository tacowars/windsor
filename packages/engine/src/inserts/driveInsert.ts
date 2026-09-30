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
 * additive and a spec without it loads as on.
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

  const set = (next: DriveSpec): void => {
    // The curve spans ±RANGE, so the drive gain is scaled into the shaper's [-1, 1].
    pre.gain.value = fromDb(next.drive) / DRIVE_CURVE_RANGE;
    tone.frequency.value = next.tone;
    wet.gain.value = next.enabled ? next.mix * driveCompensation(next.drive) : 0;
    dry.gain.value = next.enabled ? 1 - next.mix : 1;
  };
  set(spec);

  return {
    kind: 'drive',
    input,
    output,
    set,
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
