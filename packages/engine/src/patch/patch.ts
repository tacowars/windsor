/**
 * Patch schema for the FM engine: the types, the display names, and the
 * factory functions that fill in every field the DSP expects.
 *
 * Nothing here is a copy of the worklet's. The waveform and mode ids
 * (`worklet/fm/waveIds.ts`, `modeIds.ts`, #656 and #669) and the algorithm
 * table (`worklet/fm/algorithms.ts`, via `audioConstants.ts`) are re-exported
 * from the modules the worklet reads, and every default `makePatch()` writes
 * comes from `worklet/fm/patchDefaults.ts`, the table the worklet's
 * `normalisePatch` fills from too (#670). `patchDefaults.test.ts` pins the two
 * fills of an empty patch equal leaf for leaf.
 */
import { ALGORITHMS, OPERATOR_COUNT } from '../audioConstants';
import type { Algorithm } from '../audioConstants';

/** The waveform ids live with the worklet that renders them (`worklet/fm/waveIds.ts`, #656). */
export { WAVE } from '../worklet/fm/waveIds';
import {
  DRIVE_DEFAULTS,
  ENVELOPE_DEFAULTS,
  FILTER_DEFAULTS,
  FILTER_ENV_DEFAULTS,
  LEAD_OPERATOR_LEVEL,
  LFO2_DEFAULTS,
  LFO_DEFAULTS,
  LFO_TO_OP_DEFAULT,
  LFO_TO_WIDTH_DEFAULT,
  OPERATOR_DEFAULTS,
  PATCH_DEFAULTS,
  PITCH_ENV_DEFAULTS,
} from '../worklet/fm/patchDefaults';

export const WAVE_NAMES = [
  'Sine',
  'Saw',
  'Square',
  'Triangle',
  'Noise',
  'Saw D',
  'Square D',
  'Sine 4bit',
  'Sine 8bit',
  'User',
  'Pulse',
] as const;

/** The mode ids live with the worklet that switches on them (`worklet/fm/modeIds.ts`, #669). */
export { DRIVE_SHAPE, FILTER_MODE, LFO_SHAPE, LOOP_MODE } from '../worklet/fm/modeIds';

export const LFO_SHAPE_NAMES = [
  'Sine',
  'Tri',
  'Saw Up',
  'Saw Down',
  'Square',
  'S&H',
  'Drift',
] as const;

export const FILTER_MODE_NAMES = ['Off', 'LP', 'HP', 'BP', 'Notch'] as const;

export const LOOP_MODE_NAMES = ['None', 'Loop', 'Trigger'] as const;

/** The voice drive's shapes, by `DRIVE_SHAPE` id (windsor#300). */
export const DRIVE_SHAPE_NAMES = ['Soft', 'Hard', 'Diode', 'Tube', 'Fold'] as const;

/** Operators are labelled A B C D, with A nearest the output. */
export const OP_NAMES = ['A', 'B', 'C', 'D'] as const;

/** The algorithm routing table lives in `audioConstants.ts`; this is its home. */
export { ALGORITHMS };
export type { Algorithm };

/* ------------------------------------------------------------------ */

export interface Envelope {
  initLevel: number;
  attackTime: number;
  attackCurve: number;
  peakLevel: number;
  decayTime: number;
  decayCurve: number;
  sustainLevel: number;
  releaseTime: number;
  releaseCurve: number;
  endLevel: number;
  loopMode: number;
  /** Above zero, higher notes run their envelope faster. */
  keyScale: number;
}

export interface Operator {
  wave: number;
  /** Harmonic amplitudes for the User wave, fundamental first; null plays a sine. */
  userPartials: number[] | null;
  ratio: number;
  fixed: boolean;
  fixedHz: number;
  /** Cents. */
  detune: number;
  /**
   * 0..1, squared before the envelope and the rest of the amplitude chain.
   * A carrier's level is its volume; a modulator's is its depth — at 1, with
   * its envelope open, it shifts the phase it feeds by 4 cycles, ~25 rad
   * (#543). The Level knob means both because an operator can be either.
   */
  level: number;
  /** Self-feedback, -1..1 (#529): positive towards a sawtooth, negative towards a square, 0 off. */
  feedback: number;
  /**
   * The fraction of the period the wave is squeezed into, `WIDTH_RANGE`; the
   * rest of the period holds at zero, and 1 is the plain wave. For PULSE it is
   * the duty, and 0.5 is a square
   * (record `2026-09-28-operator-width-pulse-and-a-second-lfo`).
   */
  width: number;
  velSens: number;
  levelKeyScale: number;
  phase: number;
  phaseFree: boolean;
  env: Envelope;
}

export interface LfoSettings {
  shape: number;
  rate: number;
  amount: number;
  delay: number;
  retrigger: boolean;
  /** The phase runs once from note-on (a reset is implied) and holds its end value. */
  oneShot: boolean;
  /** 0..1 instead of -1..1: `(v + 1) / 2` after the shape, before the fade-in. */
  unipolar: boolean;
  /** Semitones. */
  toPitch: number;
  modWheelDepth: number;
  /** Per-operator level modulation depth. */
  toOp: number[];
  /** Per-operator width modulation depth, added to `Operator.width` before the clamp. */
  toWidth: number[];
}

export interface FilterSettings {
  mode: number;
  cutoff: number;
  resonance: number;
  slope24: boolean;
  /** Octaves. */
  envAmount: number;
  /** Octaves the mod wheel adds to `envAmount` at full travel (#586); 0 is off. */
  modWheelDepth: number;
  /** Octaves. */
  lfoAmount: number;
  /** Octaves, from the second LFO. */
  lfo2Amount: number;
  keyTrack: number;
  env: Envelope;
}

/**
 * The voice's drive stage (windsor#300, record `2026-10-01-voice-drive-stage`):
 * after the carriers and before the filter, whether the filter is on or not.
 * `gain` 1 with `bias` 0 bypasses it.
 */
export interface DriveSettings {
  /** The input gain into the shaper; 1 is unity. */
  gain: number;
  /** A `DRIVE_SHAPE` id. */
  shape: number;
  /** A DC offset added before the shaper, -1..1; silence in is still silence out. */
  bias: number;
  /** A one-pole lowpass after the shaper, 0..1: about 1 kHz at 0, bypassed at 1. */
  tone: number;
}

export interface Patch {
  name: string;
  algorithm: number;
  volume: number;
  /** Global harmonic brightness, doubling as the anti-alias trim. */
  tone: number;
  /** Seconds. */
  glide: number;
  /** Semitones. */
  pitchEnvAmount: number;
  pan: number;
  panRandom: number;
  panKey: number;
  /** Cents. Above zero this doubles voice cost -- it runs two detuned voices. */
  spread: number;
  /**
   * One *note* at a time, with retrigger (#453): a note-on fades whatever the
   * part has sounding and starts the new note fresh. `spread` still runs its
   * detuned pair for that one note. For percussion and bass.
   */
  mono: boolean;
  ops: Operator[];
  pitchEnv: Envelope;
  lfo: LfoSettings;
  /** A second LFO, symmetric with the first; `LFO2_DEFAULTS` leaves it inert. */
  lfo2: LfoSettings;
  filter: FilterSettings;
  drive: DriveSettings;
}

/** An operator with every field optional, its envelope included; `makeOperator` completes it. */
export type PartialOperator = Partial<Omit<Operator, 'env'>> & { env?: Partial<Envelope> };

/** Every field optional, recursively -- what an editor or a preset supplies. */
export type PartialPatch = {
  [K in keyof Patch]?: K extends 'ops'
    ? PartialOperator[]
    : Patch[K] extends object
      ? Partial<Patch[K]>
      : Patch[K];
};

export function makeEnvelope(
  o: Partial<Envelope> = {},
  defaults: Envelope = ENVELOPE_DEFAULTS,
): Envelope {
  return { ...defaults, ...o };
}

export function makeOperator(o: PartialOperator = {}): Operator {
  return {
    ...OPERATOR_DEFAULTS,
    ...o,
    env: makeEnvelope(o.env),
  };
}

/** An LFO over its defaults, its per-operator depths filled when the partial names none. */
function makeLfo(defaults: typeof LFO_DEFAULTS, o: Partial<LfoSettings> = {}): LfoSettings {
  return {
    ...defaults,
    toOp: new Array<number>(OPERATOR_COUNT).fill(LFO_TO_OP_DEFAULT),
    toWidth: new Array<number>(OPERATOR_COUNT).fill(LFO_TO_WIDTH_DEFAULT),
    ...o,
  };
}

export function makePatch(o: PartialPatch = {}): Patch {
  const ops: Operator[] = [];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const level = i === 0 ? LEAD_OPERATOR_LEVEL : OPERATOR_DEFAULTS.level;
    ops.push(makeOperator({ level, ...(o.ops?.[i] ?? {}) }));
  }
  return {
    ...PATCH_DEFAULTS,
    ...o,
    ops,
    pitchEnv: makeEnvelope(o.pitchEnv ?? {}, PITCH_ENV_DEFAULTS),
    lfo: makeLfo(LFO_DEFAULTS, o.lfo),
    lfo2: makeLfo(LFO2_DEFAULTS, o.lfo2),
    filter: {
      ...FILTER_DEFAULTS,
      ...(o.filter ?? {}),
      env: makeEnvelope(o.filter?.env ?? {}, FILTER_ENV_DEFAULTS),
    },
    drive: { ...DRIVE_DEFAULTS, ...(o.drive ?? {}) },
  };
}

/** Deep copy, so an editor can mutate a preset without touching the original. */
export function clonePatch(p: Patch): Patch {
  return structuredClone(p);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeInto(current: unknown, partial: unknown): unknown {
  if (!isPlainObject(current) || !isPlainObject(partial)) return partial;
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(partial)) merged[key] = mergeInto(current[key], value);
  return merged;
}

/**
 * A partial patch over a complete one, then completed again: objects recurse,
 * arrays (`ops`, `toOp`, `toWidth`, `userPartials`) are replaced wholesale. The live
 * `patches` path of `AudioSystem.apply` merges a document's patch edit over
 * the part's current patch with this, so a partial names only what changes.
 */
export function mergePatch(base: Patch, partial: PartialPatch): Patch {
  return makePatch(mergeInto(base, partial) as PartialPatch);
}
