/**
 * The Drum (windsor#948, record `2026-10-24-drum-sequencer`): a written
 * line of 1–32 steps, every step a rest or a hit with its own velocity,
 * accent, pitch offset and ratchet (`drumSteps.ts`), played on the part's
 * one patch at a base `note`.
 *
 * - **A hit** at local step `s = count mod length` strikes `note + pitch`,
 *   moved by whole octaves into MIDI 0–127 when the sum leaves it
 *   (`shiftOctaveWithin`). Its note-on carries the step's velocity as the
 *   fraction of the part's it plays at (as a Figure cell's), the accent's
 *   bump and mod when accented, and the step-mod lanes' offsets at `s`.
 * - **The gate.** A hit is held `gate` of its step, rounded to whole ticks,
 *   at least one and at most the step, as the Arp holds a cell: its
 *   note-off goes out on that local tick, so at gate 1 it lands on the next
 *   step's tick, before anything that step plays. The scheduler issues the
 *   tick at its swung time, so the hold is the gate's share of the swung
 *   step where the step sits inside one swung half-pair.
 * - **A ratchet** of `n` plays `n` hits spaced evenly over the step's swung
 *   span, each held `gate` of its slice: the note-on carries a closed
 *   `roll` the player spends (`rollSpan.ts`, `pitchedRoll.ts`), and nothing
 *   is left held.
 * - **A rest** plays nothing and releases nothing: a hit has already
 *   released at its gate.
 *
 * Position is the part's local step count modulo `length`, never the bar,
 * so a 12-step line drifts against the bar. The ticks arrive through the
 * part's region gate, so the count restarts at a region entry and the
 * variation stream is minted there from `hashSeed(seed, regionIndex)`
 * (`enter`).
 *
 * Step variation (`stepVariation.ts`, records `2026-10-24-step-variation`
 * and `2026-10-24-step-variation-velocity-and-chance`) maps onto the Drum as
 * onto the Arp: with Randomness and Probability both above 0 every step
 * makes its fixed draws, rest included. A varied hit carries a velocity
 * offset about its own velocity, a gate moved about the played one, and a
 * pitch either moved by whole octaves (Octave on) or the `pitch` of the hit
 * a normal offset away over the loop, the nearest hit when that step is a
 * rest (Octave off). With Rests sound on a varied hit may rest and a varied
 * rest sound the nearest hit's pitch and velocity, with no accent and no
 * ratchet. The draws are made before the roll, so a silenced hit plays no
 * ratchet hit.
 *
 * Pure: it reads the local tick the gate forwards, never the transport.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  GATE_MIN,
  GRID_STEPS_MAX,
  MIDI_MIDDLE_C,
  MIDI_NOTE_MAX,
} from '../audioConstants';
import { DRUM_GATE_DEFAULT } from './drumConstants';
import {
  assertDrumStep,
  defaultDrumSteps,
  DRUM_REST,
  type DrumHitStep,
  type DrumStep,
} from './drumSteps';
import { streamRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler, NoteOnEvent } from './noteEvent';
import { withSeqOverrides, type PartTickEvent, type PartTickSource } from './regionGate';
import { DIVISORS, isNoteDivisor, type TickEvent, type Unsubscribe } from './scheduler';
import { assertStepModLanes, stepModAt, type StepModLane } from './stepModLanes';
import {
  assertStepVariation,
  flips,
  jumpOffset,
  nearestIndex,
  octaveShift,
  shiftOctaveWithin,
  variationAt,
  variedGate,
  variedVelocity,
  wrapIndex,
  type StepDraw,
  type StepVariationConfig,
} from './stepVariation';
import {
  STEP_VARIATION_DEFAULTS,
  STEP_VARIATION_TABLE,
  type StepVariationTable,
} from './stepVariationConstants';

export interface DrumSequencerConfig extends StepVariationConfig {
  /** Ticks per step: a note value that divides the whole note (see `DIVISORS`). */
  readonly divisor: number;
  /** 1–`GRID_STEPS_MAX` written steps; the line loops over the first `length` of them. */
  readonly steps: readonly DrumStep[];
  /** The loop length, 1..`steps.length`; the steps past it stay in the document. */
  readonly length: number;
  /** The base MIDI note every hit plays, plus its own `pitch`. */
  readonly note: number;
  /** The fraction of a step a hit is held, `[GATE_MIN, 1]`. */
  readonly gate: number;
  /** The bump an accented hit adds to the part's velocity. */
  readonly accentVelocity: number;
  /** The per-note mod an accented hit sends; a plain hit sends none. */
  readonly accentMod: number;
  /** The part's own seed; the stream per region is `hashSeed(seed, regionIndex)`. */
  readonly seed: number;
  /** Step modulation: at most `STEP_MOD_LANES_MAX` lanes, one value per step. */
  readonly lanes: readonly StepModLane[];
}

const DEFAULT_DRUM_STEPS = defaultDrumSteps();

/** A new Drum part in 4/4: a bar of sixteenths, four on the floor, on middle C at half a step's gate. */
export const DEFAULT_DRUM_CONFIG: DrumSequencerConfig = {
  divisor: DIVISORS.sixteenth,
  steps: DEFAULT_DRUM_STEPS,
  length: DEFAULT_DRUM_STEPS.length,
  note: MIDI_MIDDLE_C,
  gate: DRUM_GATE_DEFAULT,
  accentVelocity: ACCENT_VELOCITY_DEFAULT,
  accentMod: ACCENT_MOD_DEFAULT,
  ...STEP_VARIATION_DEFAULTS,
  seed: 0,
  lanes: [],
};

function assertUnit(value: number, name: string, low = 0): void {
  if (!(value >= low && value <= 1)) {
    throw new RangeError(`${name} must be in [${low}, 1], got ${value}`);
  }
}

/** Every constructor and `reconfigure` check; the player runs it inside `plan`, so a bad live edit is refused before anything commits. */
export function assertDrumConfig(config: DrumSequencerConfig): void {
  if (!isNoteDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  const count = config.steps.length;
  if (count < 1 || count > GRID_STEPS_MAX) {
    throw new RangeError(`steps must hold 1..${GRID_STEPS_MAX} entries, got ${count}`);
  }
  config.steps.forEach((step, i) => assertDrumStep(step, i));
  if (!Number.isInteger(config.length) || config.length < 1 || config.length > count) {
    throw new RangeError(`length must be 1..${count}, got ${config.length}`);
  }
  if (!(Number.isInteger(config.note) && config.note >= 0 && config.note <= MIDI_NOTE_MAX)) {
    throw new RangeError(`note must be a MIDI note 0–${MIDI_NOTE_MAX}, got ${config.note}`);
  }
  assertUnit(config.gate, 'gate', GATE_MIN);
  assertUnit(config.accentVelocity, 'accentVelocity');
  assertUnit(config.accentMod, 'accentMod');
  assertStepVariation(config);
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
  assertStepModLanes(config.lanes);
}

/** The local ticks a hit at `gate` is held over a step of `divisor` ticks: at least one, at most the step. */
export function drumGateTicks(gate: number, divisor: number): number {
  return Math.min(divisor, Math.max(1, Math.round(gate * divisor)));
}

type DrumLine = Pick<DrumSequencerConfig, 'steps' | 'length'>;

/** The index of the hit nearest `from` inside the loop, wrapping over `length`; −1 in a line with none. */
function nearestHit(config: DrumLine, from: number): number {
  return nearestIndex(from, config.length, (i) => config.steps[i]?.kind === 'hit');
}

/**
 * A step as it plays once Rests sound has flipped it: a hit rests, and a
 * rest sounds the nearest hit's pitch and velocity with no accent and no
 * ratchet. A line with no hit keeps its rests.
 */
export function flippedDrumStep(config: DrumLine, index: number, step: DrumStep): DrumStep {
  if (step.kind === 'hit') return DRUM_REST;
  const near = config.steps[nearestHit(config, index)];
  if (near?.kind !== 'hit') return step;
  const { velocity, pitch } = near;
  return {
    kind: 'hit',
    accent: false,
    ...(velocity !== undefined && { velocity }),
    ...(pitch !== undefined && { pitch }),
  };
}

/** What a hit plays once step variation has had its say. */
interface PlayedHit {
  readonly note: number;
  readonly gate: number;
  readonly velocityOffset: number | undefined;
}

export class DrumSequencer {
  onNote: NoteHandler | null = null;

  private current: DrumSequencerConfig;
  private rng: Rng;
  /** The note sounding until its gate ends, if any. */
  private held: number | null = null;
  /** The local tick the held note's off goes out on; null with nothing held. */
  private releaseTick: number | null = null;

  constructor(
    config: DrumSequencerConfig,
    private readonly variation: StepVariationTable = STEP_VARIATION_TABLE,
  ) {
    assertDrumConfig(config);
    this.current = config;
    this.rng = streamRng(config.seed, 0);
  }

  /** The region gate entered `regionIndex` from outside: the variation stream restarts. */
  enter(regionIndex: number): void {
    this.rng = streamRng(this.current.seed, regionIndex);
  }

  get config(): DrumSequencerConfig {
    return this.current;
  }

  get heldNote(): number | null {
    return this.held;
  }

  /** The loop length — `config.length`, never more than the steps written. */
  get length(): number {
    return this.current.length;
  }

  /** The step a local step (since the region entry) lands on: the console's playhead reads it too. */
  stepAt(localStep: number): number {
    return wrapIndex(localStep, this.length);
  }

  /**
   * Take a new line live: a held hit plays on to its gate and the stream
   * carries on. The divisor is the step and a seed the stream, so either
   * rebuilds the part instead.
   */
  reconfigure(config: DrumSequencerConfig): void {
    assertDrumConfig(config);
    if (config.divisor !== this.current.divisor) {
      throw new RangeError(
        'a divisor change rebuilds the sequencer; it cannot be reconfigured live',
      );
    }
    if (config.seed !== this.current.seed) {
      throw new RangeError('a seed change rebuilds the sequencer; it cannot be reconfigured live');
    }
    this.current = config;
  }

  /** Every local tick: a gate may end on any of them, and a step starts on each multiple of the divisor. */
  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One local tick. Returns the events it emitted; most ticks emit none. */
  handleTick(event: TickEvent & Pick<PartTickEvent, 'overrides'>): NoteEvent[] {
    const { divisor } = this.current;
    const gateEnded = this.releaseTick !== null && event.tick >= this.releaseTick;
    const events = gateEnded ? this.releaseHeld(event.tick, event.time) : [];
    if (event.tick % divisor === 0) events.push(...this.onset(event, event.tick / divisor));
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release the held hit at the given tick — what a transport stop or a region end calls. */
  release(tick: number, time: number): NoteEvent[] {
    const events = this.releaseHeld(tick, time);
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /**
   * Step `count` since the entry, at the gate, Randomness and Probability
   * the part's lanes hold on this tick, the config's where none does.
   */
  private onset(event: TickEvent & Pick<PartTickEvent, 'overrides'>, count: number): NoteEvent[] {
    const config = withSeqOverrides(this.current, event.overrides);
    const index = this.stepAt(count);
    // Every step draws, whatever it plays, so an edit to one never moves another's draws.
    const draw = variationAt(this.rng, config, this.variation);
    const written = config.steps[index] ?? DRUM_REST;
    const flipped = draw !== null && flips(draw, config, count, this.variation);
    const step = flipped ? flippedDrumStep(config, index, written) : written;
    if (step.kind !== 'hit') return [];
    // A gate never outlasts its step, so nothing is held here; a stray one is let go first.
    const events = this.releaseHeld(event.tick, event.time);
    events.push(this.strike(event, config, index, step, this.played(config, index, step, draw)));
    return events;
  }

  /** A hit's note, gate and velocity offset: as written, or as its step's draws move them. */
  private played(
    config: DrumSequencerConfig,
    index: number,
    step: DrumHitStep,
    draw: StepDraw | null,
  ): PlayedHit {
    const { note, gate, randomness, length } = config;
    const own = note + (step.pitch ?? 0);
    if (!draw) return { note: shiftOctaveWithin(own, 0), gate, velocityOffset: undefined };
    const varied = {
      gate: variedGate(gate, draw, randomness, this.variation),
      velocityOffset: variedVelocity(draw, randomness, this.variation),
    };
    if (config.octaveMode) {
      return {
        note: shiftOctaveWithin(own, octaveShift(draw, randomness, this.variation)),
        ...varied,
      };
    }
    const offset = jumpOffset(draw, randomness, length, this.variation.stepJumpSigma);
    const lender =
      offset === 0 ? step : config.steps[nearestHit(config, wrapIndex(index + offset, length))];
    const pitch = lender?.kind === 'hit' ? (lender.pitch ?? 0) : (step.pitch ?? 0);
    return { note: shiftOctaveWithin(note + pitch, 0), ...varied };
  }

  /** The hit's note-on, a closed roll when it ratchets; a plain hit is held to its gate. */
  private strike(
    event: TickEvent,
    config: DrumSequencerConfig,
    index: number,
    step: DrumHitStep,
    played: PlayedHit,
  ): NoteOnEvent {
    const { note, gate, velocityOffset } = played;
    const on: NoteOnEvent = { kind: 'noteOn', tick: event.tick, time: event.time, note, degree: 0 };
    if (step.velocity !== undefined) on.velocity = step.velocity;
    if (velocityOffset !== undefined) on.velocityOffset = velocityOffset;
    if (step.accent) on.accent = { velocity: config.accentVelocity, mod: config.accentMod };
    const stepMod = stepModAt(config.lanes, index);
    if (stepMod) on.stepMod = stepMod;
    const hits = step.ratchet ?? 1;
    const { divisor } = config;
    if (hits > 1) {
      on.roll = { hits, ticks: divisor, secondsPerTick: event.secondsPerTick, gate, open: false };
      return on;
    }
    this.held = note;
    this.releaseTick = event.tick + drumGateTicks(gate, divisor);
    return on;
  }

  private releaseHeld(tick: number, time: number): NoteEvent[] {
    const note = this.held;
    this.held = null;
    this.releaseTick = null;
    return note === null ? [] : [{ kind: 'noteOff', tick, time, note }];
  }
}
