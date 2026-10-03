/**
 * The grid sequencer (#602, record `2026-09-17-602-grid-sequencer-degrees-accent-slide`):
 * a written line of 1–32 steps, the classic programmable step sequencer
 * of the key. Nothing here is drawn from the scale; the only random draw is
 * `skipChance`.
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
 * Position is the part's local step count modulo the loop `length` (at most
 * the steps written; the rest wait, greyed, in the console), never the
 * position in the bar: a 12-step line at sixteenths drifts polymetrically
 * against the bar, and a live rebuild recomputes its place from the clock.
 * Since #705 the ticks arrive through the part's region gate, so the count
 * restarts when the playhead enters a region and the skip stream is minted
 * there from `hashSeed(seed, regionIndex)` (`enter`); a single ∞ region
 * free-runs. A skipped step (one draw per note step) is a rest.
 *
 * Step modulation lanes (windsor#17, `stepModLanes.ts`): a note step's
 * note-on carries the lanes' offsets at that step, held for the note's life;
 * a slide hands them to the retargeted voice. No lanes, or lanes at 0 on a
 * step, send nothing, and the note-on is what it was.
 *
 * Ratchets (windsor#366, record `2026-10-01-sequencer-rack-devices`
 * decision 6): a note step's `ratchet` of 2 to `RATCHET_MAX` plays that
 * many hits of its note, spaced evenly across the step's swung span. The
 * step's note-on is hit 0, exactly as a plain step plays it, slide and all,
 * and carries a `roll` the player spends on the later hits (`rollSpan.ts`),
 * each the previous hit's note-off then a note-on with the step's accent and
 * offsets and no slide. The last hit is held as a plain note is, until the
 * next note or rest and through a tie. The skip draw is made once, before
 * the roll, so a skipped step plays no hit and the stream never moves. A
 * slide to the pitch held is still a tie, its ratchet unheard.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  GRID_DEFAULT_STEP_COUNT,
  GRID_REGISTER_OCTAVE_DEFAULT,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  RATCHET_MAX,
} from '../audioConstants';
import { streamRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler } from './noteEvent';
import { defaultStepCount } from './meter';
import type { Meter } from './meterTables';
import type { PartTickEvent } from './regionGate';
import type { ScaleSampler } from './scaleSampler';
import { assertStepModLanes, stepModAt, type StepModLane } from './stepModLanes';
import {
  DIVISORS,
  isNoteDivisor,
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
  /** Hits the step's roll plays, 1 to `RATCHET_MAX` (windsor#366); absent is one. */
  readonly ratchet?: number;
}

export type GridStep = { readonly kind: 'rest' } | { readonly kind: 'tie' } | GridNoteStep;

export const GRID_STEP_KINDS = ['rest', 'tie', 'note'] as const;
export type GridStepKind = (typeof GRID_STEP_KINDS)[number];

export interface GridSequencerConfig {
  /** Ticks per step: a note value that divides the whole note (see `DIVISORS`). */
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
  /** The absolute MIDI octave the line is written at (decision 11). */
  register: { octave: number };
  /** The part's own seed (decision 16); the stream per region is `hashSeed(seed, regionIndex)`. */
  seed: number;
  /**
   * Step modulation (windsor#17): at most `STEP_MOD_LANES_MAX` lanes, each
   * one value per step; the normaliser keeps them as long as `steps`.
   */
  lanes: readonly StepModLane[];
}

/** A plain note step on the root at the register octave. */
export function gridNote(degree = 0, over: Partial<Omit<GridNoteStep, 'kind'>> = {}): GridNoteStep {
  return { kind: 'note', degree, octave: 0, accent: false, slide: false, ...over };
}

/**
 * The line a part starts with when its kind becomes `grid`: a bar of
 * sixteenths on the root, in the song's meter (windsor#429; 4/4's 16 when
 * absent, 14 in 7/8, 24 in 12/8).
 */
export function defaultGridSteps(meter?: Meter): GridStep[] {
  return Array.from({ length: defaultStepCount(meter, DIVISORS.sixteenth) }, () => gridNote());
}

export const DEFAULT_GRID_CONFIG: GridSequencerConfig = {
  divisor: DIVISORS.sixteenth,
  steps: defaultGridSteps(),
  length: GRID_DEFAULT_STEP_COUNT,
  skipChance: 0,
  accentVelocity: ACCENT_VELOCITY_DEFAULT,
  accentMod: ACCENT_MOD_DEFAULT,
  register: { octave: GRID_REGISTER_OCTAVE_DEFAULT },
  seed: 0,
  lanes: [],
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
  assertRatchet(step.ratchet, `steps[${index}]`);
}

/** A note step's ratchet, when it has one: a whole 1 to `RATCHET_MAX` (windsor#366). The Arp's cells share it. */
export function assertRatchet(ratchet: number | undefined, path: string): void {
  if (ratchet === undefined) return;
  if (!Number.isInteger(ratchet) || ratchet < 1 || ratchet > RATCHET_MAX) {
    throw new RangeError(`${path}.ratchet must be an integer 1–${RATCHET_MAX}, got ${ratchet}`);
  }
}

/** Every constructor and `reconfigure` check; the player runs it inside `plan` so a bad live edit is refused before anything commits (#603). */
export function assertGridConfig(config: GridSequencerConfig): void {
  if (!isNoteDivisor(config.divisor)) {
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
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
  assertStepModLanes(config.lanes);
}

export class GridSequencer {
  onNote: NoteHandler | null = null;

  private current: GridSequencerConfig;
  private sampler: ScaleSampler;
  private rng: Rng;
  /** The note sounding into the next step, if any. */
  private held: number | null = null;

  constructor(sampler: ScaleSampler, config: GridSequencerConfig) {
    assertGridConfig(config);
    this.sampler = sampler;
    this.current = config;
    this.rng = streamRng(config.seed, 0);
  }

  /** The region gate entered `regionIndex` from outside: the skip stream restarts (#705). */
  enter(regionIndex: number): void {
    this.rng = streamRng(this.current.seed, regionIndex);
  }

  get config(): GridSequencerConfig {
    return this.current;
  }

  /**
   * Take a new line, and optionally a new sampler, without a rebuild (#603):
   * the held note and the skip stream carry on, so turning Skip, editing a
   * step or moving the Harmony tab's root never cuts the sounding note or
   * restarts the stream. The divisor is the subscription and needs a rebuild;
   * so does a seed change, which is what a stream restart is for (#705: the
   * player rebuilds that part, and the stream restarts at once).
   */
  reconfigure(config: GridSequencerConfig, sampler: ScaleSampler = this.sampler): void {
    assertGridConfig(config);
    if (config.divisor !== this.current.divisor) {
      throw new RangeError(
        'a divisor change rebuilds the sequencer; it cannot be reconfigured live',
      );
    }
    if (config.seed !== this.current.seed) {
      throw new RangeError('a seed change rebuilds the sequencer; it cannot be reconfigured live');
    }
    this.current = config;
    this.sampler = sampler;
  }

  get heldNote(): number | null {
    return this.held;
  }

  /** The loop length — `config.length`, never more than the steps written. */
  get length(): number {
    return this.current.length;
  }

  /** The step index a local step (since the region entry) lands on — the console's playhead reads this too. */
  stepAt(localStep: number): number {
    return ((localStep % this.length) + this.length) % this.length;
  }

  attach(source: TickSource): Unsubscribe {
    return source.subscribe(this.current.divisor, (event) => this.handleTick(event));
  }

  /**
   * One step. Returns the events it emitted; an empty array is a tie. The
   * skip chance is the part's lane's on this tick where one plays (windsor#488).
   */
  handleTick(event: TickEvent & Pick<PartTickEvent, 'overrides'>): NoteEvent[] {
    const index = this.stepAt(event.step);
    const step = this.current.steps[index];
    if (!step || step.kind === 'tie') return [];
    if (step.kind === 'rest') return this.restStep(event);
    // One draw per note step, whatever the rest of the line does, so an edit
    // to a rest never moves the skip pattern of the notes around it.
    const skipChance = event.overrides?.skipChance ?? this.current.skipChance;
    if (skipChance > 0 && this.rng() < skipChance) return this.restStep(event);
    return this.noteStep(event, step, index);
  }

  private noteStep(event: TickEvent, step: GridNoteStep, index: number): NoteEvent[] {
    const note = this.sampler.noteForFolded(
      step.degree,
      this.current.register.octave + step.octave,
    );
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
      on.accent = { velocity: this.current.accentVelocity, mod: this.current.accentMod };
    }
    if (slide) on.slide = true;
    const stepMod = stepModAt(this.current.lanes, index);
    if (stepMod) on.stepMod = stepMod;
    const hits = step.ratchet ?? 1;
    if (hits > 1) {
      // Every hit but the last runs to the next; the last is held as a plain note.
      const { divisor } = this.current;
      on.roll = { hits, ticks: divisor, secondsPerTick: event.secondsPerTick, gate: 1, open: true };
    }

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
