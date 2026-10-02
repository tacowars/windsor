/**
 * The Bass / Drone (#707, epic #703 decisions 14, 16): one pitched note per
 * step, chosen from the chord the region gate hands it.
 *
 * - `followRoot` plays the chord's root degree at the part's octave;
 *   `followChord` plays the root with probability `rootBias`, otherwise a
 *   uniform draw over the chord's other tones folded into the part's octave;
 *   `fixed` plays `fixedDegree` whatever the chord (a pedal).
 * - Each note step sounds with probability `density`, drawn from the part's
 *   own stream (`streamRng(seed, regionIndex)`, restarted on a region entry
 *   and never by a chord change); a skipped step is a rest.
 * - The tie rule carries over from the retired `step` sequencer: at gate 1 a
 *   step repeating the held note emits nothing and the note continues; a
 *   different note releases and retriggers. Below gate 1 every step
 *   retriggers — even where `round(gate × divisor)` fills the step — and the
 *   note-off lands `round(gate × divisor)` ticks after the on.
 * - It subscribes at every tick, like the Chord Player, so a gated note is
 *   released on its own tick rather than scheduled ahead: whatever sounds is
 *   `held` until then, and a region end's `release` cuts it on that tick.
 *
 * So a bass is a short gate and repeated triggers, and a drone a slow rate
 * at gate 1 and density 1.
 *
 * **The step strip** (windsor#367, record `2026-10-01-sequencer-rack-devices`
 * decisions 6, 9 and 10) writes the rhythm; the pitch mode still picks each
 * note's pitch. Step `localStep mod length` plays, so the count restarts at
 * a region entry, as the Grid's does. A step is the Arp's cell:
 *
 * - **note** draws its density chance and its pitch exactly as a step did
 *   before the strip, in the same order on the stream, then adds its
 *   `octave` (`shiftOctave`: a shift past MIDI keeps the pitch). Its accent,
 *   slide and lane offsets ride on the note-on as the Grid's do. A slide
 *   with nothing held is a plain note, and a slide to the pitch held is a
 *   tie;
 * - **rest** releases whatever is held and draws nothing;
 * - **tie** draws nothing and keeps the held note, its note-off moved to
 *   `gate` of the tie's step; with nothing held it is a rest.
 *
 * Below gate 1 a note runs to the next onset instead of its gate when the
 * next step is a tie or a slide (`holdsToNext`, as the Arp's), so there is
 * a note to tie or slide from. A strip of plain notes therefore plays
 * exactly what the Basslead played before it, and a part written without
 * one gets one bar of them (`defaultBassSteps`).
 *
 * **Ratchets** (windsor#366's roll): a note's `ratchet` of 2 to
 * `RATCHET_MAX` plays that many hits across the step's swung span, each
 * held `gate` of its slice, as the Arp's do (`rollOutcome`). Where the plain
 * note would run on (gate 1, or a tie or slide next) the last hit is held
 * open for the next step to release. The density and pitch draws are made
 * once, before the roll, so a skipped step plays no hit. The gate-1 rule
 * ties a plain repeat only: a ratcheted step on the pitch held strikes its
 * roll, since at gate 1 a followed root repeats on most steps and its
 * ratchet would otherwise never sound. A slide to the pitch held is still
 * a tie, its ratchet unheard, as on the Grid and the Arp.
 *
 * Pure: no audio graph, no clock of its own.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  BASS_DENSITY_DEFAULT,
  BASS_GATE_DEFAULT,
  BASS_REGISTER_OCTAVE_DEFAULT,
  BASS_ROOT_BIAS_DEFAULT,
  CHORD_SIZE_TRIAD,
  GRID_STEPS_MAX,
  HARMONY_DEGREE_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import { chordTones } from '../harmony/chordTheory';
import type { HarmonyChord } from '../harmony/harmonyTimeline';
import { holdsToNext, shiftOctave, type ArpCellOutcome } from './arpCellPlay';
import { rollOutcome } from './arpeggiator';
import { arpNote, assertCell, defaultArpSteps, type ArpNoteStep, type ArpStep } from './arpSteps';
import { streamRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler, NoteOnEvent } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { SEMITONES_PER_OCTAVE, type ScaleSampler } from './scaleSampler';
import { DIVISORS, isBarDivisor, TICKS_PER_BAR, type Unsubscribe } from './scheduler';
import { assertStepModLanes, stepModAt, type StepModLane } from './stepModLanes';

export const BASS_PITCH_MODES = ['followRoot', 'followChord', 'fixed'] as const;
export type BassPitchMode = (typeof BASS_PITCH_MODES)[number];

/** A note step: the Arp's cell, an octave shift, accent, slide and ratchet over the mode's pitch. */
export type BassNoteStep = ArpNoteStep;
/** A step of the strip (windsor#367): a rest, a tie or a note, drawn with the Arp's cell. */
export type BassStep = ArpStep;

/** A plain note step: the mode's pitch, unshifted, unaccented, no slide, one hit. */
export const bassNote: (over?: Partial<Omit<BassNoteStep, 'kind'>>) => BassNoteStep = arpNote;

/** The steps in one bar at `divisor`, 1 to `max`. */
export function bassBarSteps(divisor: number, max = GRID_STEPS_MAX): number {
  return Math.max(1, Math.min(max, Math.floor(TICKS_PER_BAR / divisor)));
}

/**
 * The strip a Basslead without one plays (decision 6): one bar of plain
 * notes at `divisor`, at most `GRID_STEPS_MAX`. It plays exactly what the
 * Basslead played before the strip.
 */
export function defaultBassSteps(divisor: number): BassStep[] {
  return defaultArpSteps(bassBarSteps(divisor));
}

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
  /** Per-step chance a note step sounds, drawn from the part's stream. */
  density: number;
  seed: number;
  /** 1–`GRID_STEPS_MAX` written steps (windsor#367); the strip loops over the first `length`. */
  steps: readonly BassStep[];
  /** The loop length, 1..`steps.length`; the steps past it stay in the document, as the Grid's. */
  length: number;
  /** The bump an accented step adds to the part's velocity. */
  accentVelocity: number;
  /** The per-note mod an accented step sends; a plain step sends 0. */
  accentMod: number;
  /** Step modulation lanes as the Grid's (`stepModLanes.ts`), one value per step written. */
  lanes: readonly StepModLane[];
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
  steps: defaultBassSteps(DIVISORS.eighth),
  length: bassBarSteps(DIVISORS.eighth),
  accentVelocity: ACCENT_VELOCITY_DEFAULT,
  accentMod: ACCENT_MOD_DEFAULT,
  lanes: [],
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
  assertBassStrip(config);
}

/** The strip's bounds: 1–`GRID_STEPS_MAX` valid steps, `length` within them, the accents in 0–1, the lanes. */
function assertBassStrip(config: BassSequencerConfig): void {
  const { steps, length } = config;
  if (steps.length < 1 || steps.length > GRID_STEPS_MAX) {
    throw new RangeError(`steps must hold 1..${GRID_STEPS_MAX} entries, got ${steps.length}`);
  }
  steps.forEach(assertCell);
  if (!Number.isInteger(length) || length < 1 || length > steps.length) {
    throw new RangeError(`length must be 1..${steps.length}, got ${length}`);
  }
  if (!(config.accentVelocity >= 0 && config.accentVelocity <= 1)) {
    throw new RangeError(`accentVelocity must be in [0, 1], got ${config.accentVelocity}`);
  }
  if (!(config.accentMod >= 0 && config.accentMod <= 1)) {
    throw new RangeError(`accentMod must be in [0, 1], got ${config.accentMod}`);
  }
  assertStepModLanes(config.lanes);
}

/** A step's pitch: the MIDI note and the scale degree it was drawn from. */
interface BassPitch {
  note: number;
  degree: number;
}

/** Degrees stacked in thirds, as `chordTones` stacks them. */
const THIRD = 2;

/** What a step past the strip would play, for safety: a plain note. */
const PLAIN_STEP = bassNote();

const pitchClass = (semitones: number): number =>
  ((semitones % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;

export class BassSequencer {
  onNote: NoteHandler | null = null;
  private current: BassSequencerConfig;
  private sampler: ScaleSampler;
  private rng: Rng;
  /** The note sounding now, whatever its gate. */
  private held: number | null = null;
  /** The local tick its gate ends on; null while it runs to the next onset. */
  private offTick: number | null = null;

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

  /** Ticks a gated note sounds for, never less than one; at gate 1 it ties instead. */
  get durationTicks(): number {
    return Math.max(1, Math.round(this.current.gate * this.current.divisor));
  }

  /** The loop length — `config.length`, never more than the steps written. */
  get length(): number {
    return this.current.length;
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

  /** The step a local step (since the region entry) plays: the strip's playhead. */
  stepAt(localStep: number): number {
    return ((localStep % this.length) + this.length) % this.length;
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One local tick: a gate ending, then a step onset. Returns what it emitted. */
  handleTick(event: PartTickEvent): NoteEvent[] {
    const events: NoteEvent[] = [];
    if (this.offTick !== null && event.tick >= this.offTick) {
      events.push(...this.drop(event.tick, event.time));
    }
    const { divisor } = this.current;
    if (event.tick % divisor === 0) events.push(...this.onset(event, event.tick / divisor));
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release the held note at the given tick: a region end, a transport stop. */
  release(tick: number, time: number): NoteEvent[] {
    const events = this.drop(tick, time);
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** A step: a rest releases, a tie holds on, a note draws its chance and its pitch, then plays. */
  private onset(event: PartTickEvent, localStep: number): NoteEvent[] {
    const index = this.stepAt(localStep);
    const step = this.current.steps[index] ?? PLAIN_STEP;
    if (step.kind === 'rest') return this.drop(event.tick, event.time);
    if (step.kind === 'tie') return this.sustain(event.tick, index);
    if (!(this.rng() < this.current.density)) return this.drop(event.tick, event.time);
    const pitch = this.pitch(event.chord);
    const note = shiftOctave(pitch.note, step.octave);
    return this.strike(event, step, index, { note, degree: pitch.degree });
  }

  /**
   * A note step that sounds. A slide to the pitch held, or a plain repeat
   * at gate 1, ties; anything else releases the held note and strikes,
   * rolled when the step is ratcheted.
   */
  private strike(
    event: PartTickEvent,
    step: BassNoteStep,
    index: number,
    pitch: BassPitch,
  ): NoteEvent[] {
    const hits = step.ratchet ?? 1;
    const slide = step.slide && this.held !== null;
    const ties = slide || (this.current.gate >= 1 && hits === 1);
    if (ties && this.held === pitch.note) return this.sustain(event.tick, index);
    const on: NoteOnEvent = { kind: 'noteOn', tick: event.tick, time: event.time, ...pitch };
    const { accentVelocity, accentMod, lanes } = this.current;
    if (step.accent) on.accent = { velocity: accentVelocity, mod: accentMod };
    if (slide) on.slide = true;
    const stepMod = stepModAt(lanes, index);
    if (stepMod) on.stepMod = stepMod;
    const off = this.drop(event.tick, event.time);
    // Legato: the sliding note takes the voice before the held one lets go.
    const events = slide ? [on, ...off] : [...off, on];
    const plain: ArpCellOutcome = {
      events,
      held: pitch.note,
      releaseTick: this.releaseAt(event.tick, index),
    };
    return this.settle(hits > 1 ? rollOutcome(plain, hits, this.current, event) : plain);
  }

  /** A tie, or a slide to the pitch held: nothing new sounds, and the held note's gate moves to this step. */
  private sustain(tick: number, index: number): NoteEvent[] {
    if (this.held !== null) this.offTick = this.releaseAt(tick, index);
    return [];
  }

  /** Where a note sounding from step `index` at `tick` ends; null runs it to the next onset. */
  private releaseAt(tick: number, index: number): number | null {
    if (this.current.gate >= 1) return null;
    if (holdsToNext(this.current.steps, index, this.length)) return null;
    return tick + this.durationTicks;
  }

  /** Keep what a step leaves sounding, and hand back what it emitted. */
  private settle(outcome: ArpCellOutcome): NoteEvent[] {
    this.held = outcome.held;
    this.offTick = outcome.releaseTick;
    return outcome.events;
  }

  /** The held note's off at `tick`, emitted by the caller; nothing when nothing sounds. */
  private drop(tick: number, time: number): NoteEvent[] {
    const note = this.held;
    this.held = null;
    this.offTick = null;
    return note === null ? [] : [{ kind: 'noteOff', tick, time, note }];
  }

  /**
   * The step's note under the current chord's stack (windsor#330: a chromatic
   * chord's root and tones are already moved); no timeline events reads as
   * the tonic triad. The reported degree stays the event's.
   */
  private pitch(chord: HarmonyChord | null): BassPitch {
    const { pitchMode, fixedDegree, register } = this.current;
    if (pitchMode === 'fixed') return this.degreeAt(fixedDegree);
    const degree = chord?.event.degree ?? 0;
    const stack = chord?.stack ?? chordTones(this.sampler.offsets, 0, CHORD_SIZE_TRIAD);
    const root = this.sampler.rootNote(register.octave);
    if (pitchMode === 'followRoot' || this.rng() < this.current.rootBias) {
      return { note: root + (stack[0] ?? 0), degree };
    }
    const others = stack.slice(1);
    const pick = Math.min(others.length - 1, Math.floor(this.rng() * others.length));
    return {
      note: root + pitchClass(others[pick] ?? 0),
      degree: (degree + (pick + 1) * THIRD) % this.sampler.degreeCount,
    };
  }

  private degreeAt(degree: number): BassPitch {
    return { note: this.sampler.noteForFolded(degree, this.current.register.octave), degree };
  }
}
