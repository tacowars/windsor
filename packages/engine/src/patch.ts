/**
 * Patch schema for the FM engine: enums, the algorithm routing table, and the
 * factory functions that fill in every field the DSP expects.
 *
 * The numeric enums and the routing table are mirrored in
 * `worklet/fm-processor.js`, which must stay import-free (see the note at the
 * top of that file). `patch.test.ts` asserts the two copies are identical, so
 * they cannot drift silently.
 */
import { ALGORITHMS, OPERATOR_COUNT } from './audioConstants';
import type { Algorithm } from './audioConstants';

/** Operator waveform. Values must match `WAVE` in the worklet. */
export const WAVE = {
  SINE: 0,
  SAW: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  NOISE: 4,
  /** Not bandlimited -- aliases on purpose. Good for digital bass. */
  SAW_D: 5,
  SQUARE_D: 6,
  SINE_4BIT: 7,
  SINE_8BIT: 8,
  /** Harmonic amplitudes supplied by `Operator.userPartials`. */
  USER: 9,
} as const;

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
] as const;

export const LFO_SHAPE = {
  SINE: 0,
  TRIANGLE: 1,
  SAW_UP: 2,
  SAW_DOWN: 3,
  SQUARE: 4,
  SAMPLE_HOLD: 5,
  DRIFT: 6,
} as const;

export const LFO_SHAPE_NAMES = [
  'Sine',
  'Tri',
  'Saw Up',
  'Saw Down',
  'Square',
  'S&H',
  'Drift',
] as const;

export const FILTER_MODE = { OFF: 0, LOWPASS: 1, HIGHPASS: 2, BANDPASS: 3, NOTCH: 4 } as const;
export const FILTER_MODE_NAMES = ['Off', 'LP', 'HP', 'BP', 'Notch'] as const;

export const LOOP_MODE = { NONE: 0, LOOP: 1, TRIGGER: 2 } as const;
export const LOOP_MODE_NAMES = ['None', 'Loop', 'Trigger'] as const;

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
  userPartials: number[] | null;
  userKey: string;
  ratio: number;
  fixed: boolean;
  fixedHz: number;
  /** Cents. */
  detune: number;
  level: number;
  /** Self-modulation, 0..1. */
  feedback: number;
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
  /** Semitones. */
  toPitch: number;
  modWheelDepth: number;
  /** Per-operator level modulation depth. */
  toOp: number[];
}

export interface FilterSettings {
  mode: number;
  cutoff: number;
  resonance: number;
  drive: number;
  slope24: boolean;
  /** Octaves. */
  envAmount: number;
  /** Octaves. */
  lfoAmount: number;
  keyTrack: number;
  env: Envelope;
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
  ops: Operator[];
  pitchEnv: Envelope;
  lfo: LfoSettings;
  filter: FilterSettings;
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

export function makeEnvelope(o: Partial<Envelope> = {}): Envelope {
  return {
    initLevel: 0,
    attackTime: 0.002,
    attackCurve: 0,
    peakLevel: 1,
    decayTime: 0.4,
    decayCurve: 0.5,
    sustainLevel: 0.7,
    releaseTime: 0.3,
    releaseCurve: 0.5,
    endLevel: 0,
    loopMode: LOOP_MODE.NONE,
    keyScale: 0,
    ...o,
  };
}

export function makeOperator(o: PartialOperator = {}): Operator {
  return {
    wave: WAVE.SINE,
    userPartials: null,
    userKey: '',
    ratio: 1,
    fixed: false,
    fixedHz: 100,
    detune: 0,
    level: 0,
    feedback: 0,
    velSens: 0.4,
    levelKeyScale: 0,
    phase: 0,
    phaseFree: true,
    ...o,
    env: makeEnvelope(o.env),
  };
}

export function makePatch(o: PartialPatch = {}): Patch {
  const ops: Operator[] = [];
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    ops.push(makeOperator({ level: i === 0 ? 1 : 0, ...(o.ops?.[i] ?? {}) }));
  }
  return {
    name: 'untitled',
    algorithm: 0,
    volume: 0.8,
    tone: 1,
    glide: 0,
    pitchEnvAmount: 0,
    pan: 0,
    panRandom: 0,
    panKey: 0,
    spread: 0,
    ...o,
    ops,
    pitchEnv: makeEnvelope({ sustainLevel: 0, decayTime: 0.1, ...(o.pitchEnv ?? {}) }),
    lfo: {
      shape: LFO_SHAPE.SINE,
      rate: 5,
      amount: 0,
      delay: 0,
      retrigger: false,
      toPitch: 0,
      modWheelDepth: 1,
      toOp: [0, 0, 0, 0],
      ...(o.lfo ?? {}),
    },
    filter: {
      mode: FILTER_MODE.OFF,
      cutoff: 8000,
      resonance: 0.707,
      drive: 1,
      slope24: false,
      envAmount: 0,
      lfoAmount: 0,
      keyTrack: 0,
      ...(o.filter ?? {}),
      env: makeEnvelope({ sustainLevel: 0, ...(o.filter?.env ?? {}) }),
    },
  };
}

/** Deep copy, so an editor can mutate a preset without touching the original. */
export function clonePatch(p: Patch): Patch {
  return structuredClone(p);
}
