/**
 * The grid sequencer (#602, record `2026-09-17-602-grid-sequencer-degrees-accent-slide`):
 * a written line of 1–32 steps, the classic programmable step sequencer
 * beside the generative `step` drone. Nothing here is drawn from the scale's
 * weights; the only random draw is `skipChance`.
 *
 * A step is a rest, a tie, or a note `{ degree, octave, accent, slide }`:
 *
 * - **rest** releases whatever is held and plays nothing;
 * - **tie** emits nothing — the held note continues through the step, and a
 *   tie on step 0 continues the previous pass's last note across the loop;
 * - **note** resolves its degree through the song's scale sampler (so a key
 *   change on the Harmony tab re-pitches the line, and a degree past the end
 *   of the scale wraps with octave carry — `foldDegree`) at the part's
 *   register octave plus the step's own; releases the held note on this tick
 *   and starts the new one; with `slide` set and a note held, the new note-on
 *   is flagged `slide` and emitted *before* the old note-off at the same tick,
 *   so the worklet hands the voice over legato. A slide to the pitch already
 *   held is a tie.
 *
 * Position is the transport's absolute step count modulo the loop `length`
 * (at most the steps written; the rest wait, greyed, in the console), never
 * the position in the bar: a 12-step line at sixteenths drifts polymetrically
 * against the bar, and a live rebuild recomputes its place from the clock.
 * A skipped step (one draw from the part's stream per note step) is a rest.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  GRID_DEFAULT_STEP_COUNT,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
} from './audioConstants';
import { generatorRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { ScaleSampler } from './scaleSampler';
import {
  DIVISORS,
  isBarDivisor,
  type TickEvent,
  type TickSource,
  type Unsubscribe,
} from './scheduler';

export interface GridNoteStep {
  readonly kind: 'note';
  /** Index into the song's scale; past its end it wraps with octave carry. */
  readonly degree: number;
  /** Octaves above the part's register octave, `±GRID_STEP_OCTAVE_MAX`. */
  readonly octave: number;
  readonly accent: boolean;
  readonly slide: boolean;
}

export type GridStep = { readonly kind: 'rest' } | { readonly kind: 'tie' } | GridNoteStep;

export const GRID_STEP_KINDS = ['rest', 'tie', 'note'] as const;
export type GridStepKind = (typeof GRID_STEP_KINDS)[number];

export interface GridSequencerConfig {
  /** Ticks per step. Must divide the bar (see `DIVISORS`). */
  divisor: number;
  /** 1–`GRID_STEPS_MAX` written steps; the line loops over the first `length` of them. */
  steps: readonly GridStep[];
  /**
   * The loop length, 1..`steps.length` (#603): shortening a line keeps the
   * steps past the end in the document, greyed in the console, so lengthening
   * it again brings them back.
   */
  length: number;
  /** Chance a note step rests instead, drawn from the part's stream. */
  skipChance: number;
  /** The bump an accented step adds to the part's velocity. */
  accentVelocity: number;
  /** The per-note mod an accented step sends; a plain step sends 0. */
  accentMod: number;
  /** Octaves from the root the line is written at. */
  register: { octave: number };
  seed: number;
  generatorIndex: number;
}

/** A plain note step on the root at the register octave. */
export function gridNote(degree = 0, over: Partial<Omit<GridNoteStep, 'kind'>> = {}): GridNoteStep {
  return { kind: 'note', degree, octave: 0, accent: false, slide: false, ...over };
}

/** The line a part starts with when its kind becomes `grid`: a bar of sixteenths on the root. */
export function defaultGridSteps(): GridStep[] {
  return Array.from({ length: GRID_DEFAULT_STEP_COUNT }, () => gridNote());
}

export const DEFAULT_GRID_CONFIG: GridSequencerConfig = {
  divisor: DIVISORS.sixteenth,
  steps: defaultGridSteps(),
  length: GRID_DEFAULT_STEP_COUNT,
  skipChance: 0,
  accentVelocity: ACCENT_VELOCITY_DEFAULT,
  accentMod: ACCENT_MOD_DEFAULT,
  register: { octave: 0 },
  seed: 0,
  generatorIndex: 0,
};

function assertStep(step: GridStep, index: number): void {
  if (step.kind !== 'note') return;
  if (!Number.isInteger(step.degree) || step.degree < 0) {
    throw new RangeError(
      `steps[${index}].degree must be a non-negative integer, got ${step.degree}`,
    );
  }
  if (!Number.isInteger(step.octave) || Math.abs(step.octave) > GRID_STEP_OCTAVE_MAX) {
    throw new RangeError(`steps[${index}].octave must be within ±${GRID_STEP_OCTAVE_MAX}`);
  }
}

function assertConfig(config: GridSequencerConfig): void {
  if (!isBarDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  if (config.steps.length < 1 || config.steps.length > GRID_STEPS_MAX) {
    throw new RangeError(
      `steps must hold 1..${GRID_STEPS_MAX} entries, got ${config.steps.length}`,
    );
  }
  config.steps.forEach(assertStep);
  if (
    !Number.isInteger(config.length) ||
    config.length < 1 ||
    config.length > config.steps.length
  ) {
    throw new RangeError(`length must be 1..${config.steps.length}, got ${config.length}`);
  }
  if (!(config.skipChance >= 0 && config.skipChance <= 1)) {
    throw new RangeError(`skipChance must be in [0, 1], got ${config.skipChance}`);
  }
  if (!(config.accentVelocity >= 0 && config.accentVelocity <= 1)) {
    throw new RangeError(`accentVelocity must be in [0, 1], got ${config.accentVelocity}`);
  }
  if (!(config.accentMod >= 0 && config.accentMod <= 1)) {
    throw new RangeError(`accentMod must be in [0, 1], got ${config.accentMod}`);
  }
}

export class GridSequencer {
  readonly config: GridSequencerConfig;
  onNote: NoteHandler | null = null;

  private readonly sampler: ScaleSampler;
  private readonly rng: Rng;
  /** The note sounding into the next step, if any. */
  private held: number | null = null;

  constructor(sampler: ScaleSampler, config: GridSequencerConfig) {
    assertConfig(config);
    this.sampler = sampler;
    this.config = config;
    this.rng = generatorRng(config.seed, config.generatorIndex);
  }

  get heldNote(): number | null {
    return this.held;
  }

  /** The loop length — `config.length`, never more than the steps written. */
  get length(): number {
    return this.config.length;
  }

  /** The step index a transport step lands on — the console's playhead reads this too. */
  stepAt(transportStep: number): number {
    return ((transportStep % this.length) + this.length) % this.length;
  }

  attach(source: TickSource): Unsubscribe {
    return source.subscribe(this.config.divisor, (event) => this.handleTick(event));
  }

  /** One step. Returns the events it emitted; an empty array is a tie. */
  handleTick(event: TickEvent): NoteEvent[] {
    const step = this.config.steps[this.stepAt(event.step)];
    if (!step || step.kind === 'tie') return [];
    if (step.kind === 'rest') return this.restStep(event);
    // One draw per note step, whatever the rest of the line does, so an edit
    // to a rest never moves the skip pattern of the notes around it.
    if (this.config.skipChance > 0 && this.rng() < this.config.skipChance) {
      return this.restStep(event);
    }
    return this.noteStep(event, step);
  }

  private noteStep(event: TickEvent, step: GridNoteStep): NoteEvent[] {
    const note = this.sampler.noteForFolded(step.degree, this.config.register.octave + step.octave);
    const slide = step.slide && this.held !== null;
    if (slide && note === this.held) return [];

    const on: NoteEvent = {
      kind: 'noteOn',
      tick: event.tick,
      time: event.time,
      note,
      degree: step.degree,
    };
    if (step.accent) {
      on.accent = { velocity: this.config.accentVelocity, mod: this.config.accentMod };
    }
    if (slide) on.slide = true;

    const events: NoteEvent[] = [];
    const off: NoteEvent | null =
      this.held === null
        ? null
        : { kind: 'noteOff', tick: event.tick, time: event.time, note: this.held };
    // Legato: the new note takes the voice before the old handle lets go.
    if (slide) events.push(on);
    if (off) events.push(off);
    if (!slide) events.push(on);
    this.held = note;
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** A rest, written or drawn: release whatever is held, play nothing. */
  private restStep(event: TickEvent): NoteEvent[] {
    const released = this.release(event.tick, event.time);
    return released ? [released] : [];
  }

  /** Release the held note at the given tick — what a transport stop calls. */
  release(tick: number, time: number): NoteEvent | null {
    if (this.held === null) return null;
    const event: NoteEvent = { kind: 'noteOff', tick, time, note: this.held };
    this.held = null;
    this.onNote?.(event);
    return event;
  }
}
