/**
 * The step sequencer is the drone (record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §6).
 *
 * The same sampler as the arpeggiator at a selectable divisor -- 1/32 up to a
 * whole bar -- and a gate that is a fraction of the step. At one bar per step
 * with the gate at 1.0 it holds a note for a bar, and a note the next step
 * repeats is tied: no note-off, no retrigger, the held note simply continues.
 * There is no separate drone system.
 *
 * Tie rule: a step ties iff the previous step's gate reached the step boundary
 * (`gate === 1`) and the new draw is the same MIDI note. Otherwise the held
 * note is released on this step's tick, before the new note-on.
 */
import { assertNotePattern, type NotePattern } from './capturedPattern';
import { generatorRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { Register, SampledNote, ScaleSampler } from './scaleSampler';
import { isBarDivisor, type TickEvent, type TickSource, type Unsubscribe } from './scheduler';

export interface StepSequencerConfig {
  /** Ticks per step. Must divide the bar (see `DIVISORS`). */
  divisor: number;
  /** Note length as a fraction of the step, in (0, 1]. 1 ties repeated notes. */
  gate: number;
  register: Register;
  seed: number;
  generatorIndex: number;
  /**
   * A captured bar (issue #70, record §6): a note or `null` (a rest) per
   * step, looped; the sampler is unused and no RNG is consumed. Repeated
   * equal notes tie under the same rule as sampled ones. `null` or absent is
   * generative.
   */
  pattern?: NotePattern | null;
}

export const DEFAULT_STEP_SEQUENCER_CONFIG: StepSequencerConfig = {
  divisor: 96,
  gate: 1,
  register: { octave: -1, span: 1 },
  seed: 0,
  generatorIndex: 3,
};

function assertConfig(config: StepSequencerConfig): void {
  if (!isBarDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  if (!(config.gate > 0 && config.gate <= 1)) {
    throw new RangeError(`gate must be in (0, 1], got ${config.gate}`);
  }
  if (config.pattern != null) assertNotePattern(config.pattern);
}

export class StepSequencer {
  readonly config: StepSequencerConfig;
  onNote: NoteHandler | null = null;

  private readonly sampler: ScaleSampler;
  private readonly rng: Rng;
  /** A note whose gate reached the step boundary and is still sounding. */
  private held: number | null = null;

  constructor(sampler: ScaleSampler, config: StepSequencerConfig) {
    assertConfig(config);
    this.sampler = sampler;
    this.config = config;
    this.rng = generatorRng(config.seed, config.generatorIndex);
  }

  get heldNote(): number | null {
    return this.held;
  }

  /** Ticks a note sounds for; equal to the divisor when the gate is 1. */
  get durationTicks(): number {
    return Math.max(1, Math.round(this.config.gate * this.config.divisor));
  }

  attach(source: TickSource): Unsubscribe {
    return source.subscribe(this.config.divisor, (event) => this.handleTick(event));
  }

  /** One step. Returns the events it emitted; an empty array is a tie. */
  handleTick(event: TickEvent): NoteEvent[] {
    const drawn = this.draw(event);
    if (!drawn) return this.restStep(event);
    const duration = this.durationTicks;
    const holds = duration >= this.config.divisor;
    if (this.held !== null && holds && drawn.note === this.held) return [];

    const events: NoteEvent[] = [];
    if (this.held !== null) {
      events.push({ kind: 'noteOff', tick: event.tick, time: event.time, note: this.held });
      this.held = null;
    }
    events.push({
      kind: 'noteOn',
      tick: event.tick,
      time: event.time,
      note: drawn.note,
      degree: drawn.degree,
    });
    if (holds) {
      this.held = drawn.note;
    } else {
      events.push({
        kind: 'noteOff',
        tick: event.tick + duration,
        time: event.time + duration * event.secondsPerTick,
        note: drawn.note,
      });
    }
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** The step's pitch: the captured bar's slot (issue #70), or a sampler draw. */
  private draw(event: TickEvent): SampledNote | null {
    const pattern = this.config.pattern;
    if (pattern == null) return this.sampler.sampleNote(this.rng, this.config.register);
    const slot = Math.floor(event.tickInBar / this.config.divisor) % pattern.length;
    const note = pattern[slot];
    // A captured note was not drawn from the scale; -1 marks that honestly.
    return note == null ? null : { note, degree: -1 };
  }

  /** A captured rest: release whatever is held, play nothing. */
  private restStep(event: TickEvent): NoteEvent[] {
    const released = this.release(event.tick, event.time);
    return released ? [released] : [];
  }

  /** Release a held note at the given tick -- what a transport stop calls. */
  release(tick: number, time: number): NoteEvent | null {
    if (this.held === null) return null;
    const event: NoteEvent = { kind: 'noteOff', tick, time, note: this.held };
    this.held = null;
    this.onNote?.(event);
    return event;
  }
}
