/**
 * The Bass / Drone (#707, epic #703 decisions 14, 16): one pitched note per
 * step, chosen from the chord the region gate hands it.
 *
 * - `followRoot` plays the chord's root degree at the part's octave;
 *   `followChord` plays the root with probability `rootBias`, otherwise a
 *   uniform draw over the chord's other tones folded into the part's octave;
 *   `fixed` plays `fixedDegree` whatever the chord (a pedal).
 * - Each step sounds with probability `density`, drawn from the part's own
 *   stream (`streamRng(seed, regionIndex)`, restarted on a region entry and
 *   never by a chord change); a skipped step is a rest.
 * - The tie rule carries over from the retired `step` sequencer: when a note
 *   lasts its whole step (gate 1) a step repeating the held note emits
 *   nothing and the note continues; a different note releases and
 *   retriggers. Below that every step retriggers, its note-off deferred by
 *   `round(gate × divisor)` ticks.
 *
 * So a bass is a short gate and repeated triggers, and a drone a slow rate
 * at gate 1 and density 1. Pure: no audio graph, no clock of its own.
 */
import {
  BASS_DENSITY_DEFAULT,
  BASS_GATE_DEFAULT,
  BASS_REGISTER_OCTAVE_DEFAULT,
  BASS_ROOT_BIAS_DEFAULT,
  CHORD_SIZE_TRIAD,
  HARMONY_DEGREE_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import { chordTones } from '../harmony/chordTheory';
import type { HarmonyChord } from '../harmony/harmonyTimeline';
import { streamRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { SEMITONES_PER_OCTAVE, type ScaleSampler } from './scaleSampler';
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

/** A step's pitch: the MIDI note and the scale degree it was drawn from. */
interface BassPitch {
  note: number;
  degree: number;
}

/** Degrees stacked in thirds, as `chordTones` stacks them. */
const THIRD = 2;

const pitchClass = (semitones: number): number =>
  ((semitones % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;

export class BassSequencer {
  onNote: NoteHandler | null = null;
  private current: BassSequencerConfig;
  private sampler: ScaleSampler;
  private rng: Rng;
  /** A note whose gate reached the step boundary and is still sounding. */
  private held: number | null = null;

  constructor(sampler: ScaleSampler, config: BassSequencerConfig) {
    assertBassConfig(config);
    this.sampler = sampler;
    this.current = config;
    this.rng = streamRng(config.seed, 0);
  }

  get config(): BassSequencerConfig {
    return this.current;
  }

  get heldNote(): number | null {
    return this.held;
  }

  /** Ticks a note sounds for; the whole step at gate 1, never less than one tick. */
  get durationTicks(): number {
    return Math.max(1, Math.round(this.current.gate * this.current.divisor));
  }

  /**
   * Every field takes effect on the next step, the stream and the held note
   * kept. The divisor and the seed are the player's to rebuild on
   * (`generatorSig`), so a seed passed here only reaches the next entry.
   */
  reconfigure(config: BassSequencerConfig, sampler: ScaleSampler = this.sampler): void {
    assertBassConfig(config);
    this.current = config;
    this.sampler = sampler;
  }

  /** The region gate entered `regionIndex` from outside: the stream restarts (#705). */
  enter(regionIndex: number): void {
    this.rng = streamRng(this.current.seed, regionIndex);
  }

  /** The card has no strip and no playhead (#707 decision 5): no position to show. */
  stepAt(_localStep: number): number {
    return -1;
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(this.current.divisor, (event) => this.handleTick(event));
  }

  /** One step. Returns the events it emitted; an empty array is a tie or a silent rest. */
  handleTick(event: PartTickEvent): NoteEvent[] {
    if (!(this.rng() < this.current.density)) return this.release(event.tick, event.time);
    const pitch = this.pitch(event.chord);
    const duration = this.durationTicks;
    const holds = duration >= this.current.divisor;
    if (holds && this.held === pitch.note) return [];

    const events: NoteEvent[] = [];
    if (this.held !== null) {
      events.push({ kind: 'noteOff', tick: event.tick, time: event.time, note: this.held });
      this.held = null;
    }
    events.push({ kind: 'noteOn', tick: event.tick, time: event.time, ...pitch });
    if (holds) {
      this.held = pitch.note;
    } else {
      events.push({
        kind: 'noteOff',
        tick: event.tick + duration,
        time: event.time + duration * event.secondsPerTick,
        note: pitch.note,
      });
    }
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release the held note at the given tick: a rest, a region end, a transport stop. */
  release(tick: number, time: number): NoteEvent[] {
    if (this.held === null) return [];
    const event: NoteEvent = { kind: 'noteOff', tick, time, note: this.held };
    this.held = null;
    this.onNote?.(event);
    return [event];
  }

  /** The step's note under the current chord; no timeline events reads as the tonic triad. */
  private pitch(chord: HarmonyChord | null): BassPitch {
    const { pitchMode, fixedDegree, register } = this.current;
    if (pitchMode === 'fixed') return this.degreeAt(fixedDegree);
    const degree = chord?.event.degree ?? 0;
    if (pitchMode === 'followRoot' || this.rng() < this.current.rootBias) {
      return this.degreeAt(degree);
    }
    const size = chord?.event.size ?? CHORD_SIZE_TRIAD;
    const others = chordTones(this.sampler.offsets, degree, size).slice(1);
    const pick = Math.min(others.length - 1, Math.floor(this.rng() * others.length));
    return {
      note: this.sampler.rootNote(register.octave) + pitchClass(others[pick] ?? 0),
      degree: (degree + (pick + 1) * THIRD) % this.sampler.degreeCount,
    };
  }

  private degreeAt(degree: number): BassPitch {
    return { note: this.sampler.noteForFolded(degree, this.current.register.octave), degree };
  }
}
