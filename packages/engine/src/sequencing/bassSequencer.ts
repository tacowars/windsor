/**
 * The bass's config and a silent stub of its generator (#705; the generator
 * itself arrives with #707 — epic #703 decision 14).
 *
 * The normaliser accepts the whole field set here so a v3 document can
 * carry a `bass` part before the performer exists; the stub subscribes at
 * the part's divisor, emits nothing and holds nothing, so the player's
 * binding, the region gate and the console's card have their seam today.
 */
import {
  BASS_DENSITY_DEFAULT,
  BASS_GATE_DEFAULT,
  BASS_REGISTER_OCTAVE_DEFAULT,
  BASS_ROOT_BIAS_DEFAULT,
  HARMONY_DEGREE_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { DIVISORS, isBarDivisor, type Unsubscribe } from './scheduler';

export const BASS_PITCH_MODES = ['followRoot', 'followChord', 'fixed'] as const;
export type BassPitchMode = (typeof BASS_PITCH_MODES)[number];

export interface BassSequencerConfig {
  pitchMode: BassPitchMode;
  /** How often a `followChord` step lands on the chord root rather than another tone, 0–1. */
  rootBias: number;
  /** The scale degree a `fixed` bass plays, at the part's octave. */
  fixedDegree: number;
  /** Ticks per step. Must divide the bar. */
  divisor: number;
  /** A note's length as a fraction of its step, in (0, 1]; at 1 a repeated note ties. */
  gate: number;
  /** Absolute MIDI octave (decision 11). */
  register: { octave: number };
  /** Per-step chance to sound, drawn from the part's stream. */
  density: number;
  seed: number;
}

export const DEFAULT_BASS_CONFIG: BassSequencerConfig = {
  pitchMode: 'followRoot',
  rootBias: BASS_ROOT_BIAS_DEFAULT,
  fixedDegree: 0,
  divisor: DIVISORS.eighth,
  gate: BASS_GATE_DEFAULT,
  register: { octave: BASS_REGISTER_OCTAVE_DEFAULT },
  density: BASS_DENSITY_DEFAULT,
  seed: 0,
};

/** Every constructor and `reconfigure` check; the player runs it inside `plan`. */
export function assertBassConfig(config: BassSequencerConfig): void {
  if (!BASS_PITCH_MODES.includes(config.pitchMode)) {
    throw new RangeError(`pitchMode must be one of ${BASS_PITCH_MODES.join('|')}`);
  }
  if (!(config.rootBias >= 0 && config.rootBias <= 1)) {
    throw new RangeError(`rootBias must be in [0, 1], got ${config.rootBias}`);
  }
  if (
    !Number.isInteger(config.fixedDegree) ||
    config.fixedDegree < 0 ||
    config.fixedDegree > HARMONY_DEGREE_MAX
  ) {
    throw new RangeError(`fixedDegree must be 0..${HARMONY_DEGREE_MAX}`);
  }
  if (!isBarDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  if (!(config.gate > 0 && config.gate <= 1)) {
    throw new RangeError(`gate must be in (0, 1], got ${config.gate}`);
  }
  const { octave } = config.register;
  if (!Number.isInteger(octave) || octave < REGISTER_OCTAVE_MIN || octave > REGISTER_OCTAVE_MAX) {
    throw new RangeError(`register.octave must be ${REGISTER_OCTAVE_MIN}..${REGISTER_OCTAVE_MAX}`);
  }
  if (!(config.density >= 0 && config.density <= 1)) {
    throw new RangeError(`density must be in [0, 1], got ${config.density}`);
  }
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
}

/** The stub: subscribed, silent. #707 replaces the body, not the surface. */
export class BassSequencer {
  onNote: NoteHandler | null = null;
  private current: BassSequencerConfig;

  constructor(config: BassSequencerConfig) {
    assertBassConfig(config);
    this.current = config;
  }

  get config(): BassSequencerConfig {
    return this.current;
  }

  reconfigure(config: BassSequencerConfig): void {
    assertBassConfig(config);
    this.current = config;
  }

  /** The region gate entered a region: the stream restarts here (#707). */
  enter(_regionIndex: number): void {}

  /** No position to show until #707. */
  stepAt(_localStep: number): number {
    return -1;
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(this.current.divisor, (event) => this.handleTick(event));
  }

  handleTick(_event: PartTickEvent): NoteEvent[] {
    return [];
  }

  release(_tick: number, _time: number): NoteEvent[] {
    return [];
  }
}
