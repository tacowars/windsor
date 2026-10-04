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
  driveOnByDefault,
  ENVELOPE_DEFAULTS,
  FILTER_DEFAULTS,
  FILTER_ENV_DEFAULTS,
  LEAD_OPERATOR_LEVEL,
  LFO2_DEFAULTS,
  LFO_DEFAULTS,
  LFO_TO_OP_DEFAULT,
  LFO_TO_WIDTH_DEFAULT,
  MACRO_DEFAULTS,
  MACRO_MAPPING_DEFAULTS,
  OPERATOR_DEFAULTS,
  PATCH_DEFAULTS,
  PITCH_ENV_DEFAULTS,
} from '../worklet/fm/patchDefaults';
import type { VoiceTargetPath } from '../worklet/fm/voiceTargetTables';
import { voiceTargetRow } from '../worklet/fm/voiceTargetTables';

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
export { DRIVE_SHAPE, FILTER_MODE, LFO_SHAPE, LOOP_MODE, MACRO_CURVE } from '../worklet/fm/modeIds';
/** The drive switch a patch that omits it takes (windsor#309), from the table both fills read. */
export { driveOnByDefault };

export const LFO_SHAPE_NAMES = [
  'Sine',
  'Tri',
  'Saw Up',
  'Saw Down',
  'Square',
  'S&H',
  'Drift',
] as const;

export const FILTER_MODE_NAMES = ['Off', 'LP', 'HP', 'BP', 'Notch', 'Formant', 'Acid'] as const;

export const LOOP_MODE_NAMES = ['None', 'Loop', 'Trigger'] as const;

/** The voice drive's shapes, by `DRIVE_SHAPE` id (windsor#300). */
export const DRIVE_SHAPE_NAMES = ['Soft', 'Hard', 'Diode', 'Tube', 'Fold'] as const;

/** A macro mapping's curves, by `MACRO_CURVE` id (windsor#559). */
export const MACRO_CURVE_NAMES = ['Linear', 'Exp', 'Log', 'S'] as const;

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
  /**
   * A Noise operator's own colour (windsor#362, record
   * `2026-10-02-operator-noise-colour`): a two-pole Butterworth lowpass and
   * highpass on its noise, before its level and envelope, in Hz; 0 is off,
   * and `NOISE_COLOUR_RANGE` bounds both. Every other wave ignores them.
   */
  noiseLp: number;
  noiseHp: number;
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
  /**
   * The vowel the Formant mode sounds (windsor#331), 0–4: 0 a, 1 e, 2 i, 3 o,
   * 4 u, a fraction morphing between neighbours (`FORMANT_VOWELS`). The other
   * modes ignore it.
   */
  vowel: number;
  env: Envelope;
}

/**
 * The voice's drive stage (windsor#300, record `2026-10-01-voice-drive-stage`):
 * after the carriers and before the filter, whether the filter is on or not.
 * `on` false, or `gain` 1 with `bias` 0, bypasses it.
 */
export interface DriveSettings {
  /**
   * The stage's switch (windsor#309): off, it costs nothing and the other
   * four are kept for when it is turned back on. A patch that omits it takes
   * `driveOnByDefault` (on when the gain is off unity or there is a bias).
   */
  on: boolean;
  /** The input gain into the shaper; 1 is unity. */
  gain: number;
  /** A `DRIVE_SHAPE` id. */
  shape: number;
  /** A DC offset added before the shaper, -1..1; silence in is still silence out. */
  bias: number;
  /** A one-pole lowpass after the shaper, 0..1: about 1 kHz at 0, bypassed at 1. */
  tone: number;
}

/**
 * One parameter a macro moves (windsor#559, record
 * `2026-10-04-patch-macro-knobs` decisions 2–5): its voice target (never a
 * macro's own row, and one mapping per target across the patch), the
 * target's value at the macro's 0 and 1 in the target's own units, a
 * `MACRO_CURVE` id the macro's travel is shaped by, and whether the travel
 * runs the other way.
 */
export interface MacroMapping {
  target: VoiceTargetPath;
  min: number;
  max: number;
  curve: number;
  inverted: boolean;
}

/**
 * One macro knob: its name, its value 0..1 (what the Parts tab's knob sets
 * and a lane overrides live, through the voice target row
 * `macros.<i>.value`) and up to `MACRO_MAPPINGS_MAX` mappings.
 */
export interface Macro {
  name: string;
  value: number;
  mappings: MacroMapping[];
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
  /** Up to `MACROS_MAX` macros (windsor#559); none by default. */
  macros: Macro[];
}

/** An operator with every field optional, its envelope included; `makeOperator` completes it. */
export type PartialOperator = Partial<Omit<Operator, 'env'>> & { env?: Partial<Envelope> };

/** A mapping with every field but its `target` optional; `makeMacroMapping` completes it. */
export type PartialMacroMapping = Partial<MacroMapping> & Pick<MacroMapping, 'target'>;

/** A macro with every field optional, its mappings partial; `makeMacro` completes it. */
export type PartialMacro = Partial<Omit<Macro, 'mappings'>> & { mappings?: PartialMacroMapping[] };

/** Every field optional, recursively -- what an editor or a preset supplies. */
export type PartialPatch = {
  [K in keyof Patch]?: K extends 'ops'
    ? PartialOperator[]
    : K extends 'macros'
      ? PartialMacro[]
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

/**
 * A mapping over its defaults; its `target` is its own, since it has none.
 * `min` and `max` are clamped to the target row's bounds, as the worklet's
 * `normalisePatch` clamps them, so an omitted end fills alike on both
 * threads (a cutoff mapping's default 0 is the row's 30 Hz; windsor#560).
 */
export function makeMacroMapping(o: PartialMacroMapping): MacroMapping {
  const mapping = { ...MACRO_MAPPING_DEFAULTS, ...o };
  const row = voiceTargetRow(mapping.target);
  if (!row) return mapping;
  const clamp = (v: number): number => Math.max(row.min, Math.min(row.max, v));
  return { ...mapping, min: clamp(mapping.min), max: clamp(mapping.max) };
}

/** A macro over its defaults, each mapping completed and one with no `target` dropped. */
export function makeMacro(o: PartialMacro = {}): Macro {
  const mappings = (o.mappings ?? []).filter((m) => m.target !== undefined);
  return { ...MACRO_DEFAULTS, ...o, mappings: mappings.map(makeMacroMapping) };
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
    drive: makeDrive(o.drive),
    macros: (o.macros ?? []).map(makeMacro),
  };
}

/** The drive with its defaults; an omitted `on` is `driveOnByDefault` of the gain and bias (windsor#309). */
function makeDrive(o: Partial<DriveSettings> | undefined): DriveSettings {
  const drive = { ...DRIVE_DEFAULTS, ...(o ?? {}) };
  if (typeof o?.on !== 'boolean') drive.on = driveOnByDefault(drive.gain, drive.bias);
  return drive;
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
 * arrays (`ops`, `toOp`, `toWidth`, `userPartials`, `macros`) are replaced wholesale. The live
 * `patches` path of `AudioSystem.apply` merges a document's patch edit over
 * the part's current patch with this, so a partial names only what changes.
 */
export function mergePatch(base: Patch, partial: PartialPatch): Patch {
  return makePatch(mergeInto(base, partial) as PartialPatch);
}
