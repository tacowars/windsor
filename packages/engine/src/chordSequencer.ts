/**
 * The chord sequencer (#606, record
 * `2026-09-17-606-chord-sequencer-degrees-per-part-voicing`): a written
 * progression of 0–32 steps, each a rest or a diatonic chord of the song's
 * key given as a scale degree, played through the part's voicing.
 *
 * A step is `{ duration, repeat }` and, for a chord, `{ degree, size,
 * inversion, octave, semitone }`: `duration` is a multiple of the part's base
 * step (`divisor` ticks) and `repeat` plays the step that many times in a
 * row, retriggered each time. The steps are laid out as *segments*, one per
 * repeat, and the pattern's length is their sum in ticks. Position is the
 * transport's absolute tick modulo that length, so a 3-bar progression drifts
 * against nothing and a live rebuild recomputes its place from the clock;
 * the generator subscribes at every tick and acts only on a segment's first.
 *
 * At an onset the notes still held are released on that tick, before the new
 * chord's note-ons; a rest's onset releases and plays nothing. With `gate`
 * below 1 the chord's offs are emitted at the onset with a future tick and
 * time (the step sequencer's idiom); at 1 the chord holds to the next onset.
 * Repeats retrigger — there are no ties. An empty step list is silent: its
 * first tick releases whatever a previous pattern left sounding.
 *
 * Chords resolve through the song's one `ScaleSampler` at onset time, so a
 * key change re-voices the progression; `reconfigure` takes a new pattern,
 * voicing, gate, register or sampler live, without a rebuild (#603's rule:
 * an edit never cuts the sounding chord). Nothing here is random.
 */
import {
  CHORD_DURATION_DEFAULT,
  CHORD_GATE_DEFAULT,
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_DEFAULT,
  CHORD_REPEAT_MAX,
  CHORD_SEMITONE_MAX,
  CHORD_SIZE_TRIAD,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
} from './audioConstants';
import {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
  type ChordVoicingId,
} from './chordTables';
import { chordTones, isChordSize, type ChordSize } from './chordTheory';
import { voiceChord } from './chordVoicing';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { ScaleSampler } from './scaleSampler';
import { DIVISORS, type TickEvent, type TickSource, type Unsubscribe } from './scheduler';

interface StepTiming {
  /** A multiple of the part's base step, from `CHORD_DURATIONS`. */
  readonly duration: number;
  /** Times in a row the step plays, 1–`CHORD_REPEAT_MAX`. */
  readonly repeat: number;
}

export interface ChordRestStep extends StepTiming {
  readonly kind: 'rest';
}

export interface ChordChordStep extends StepTiming {
  readonly kind: 'chord';
  /** Index into the song's scale; past its end it wraps with octave carry. */
  readonly degree: number;
  readonly size: ChordSize;
  /** 0–`CHORD_INVERSION_MAX` as written; wraps with octave carry past the tone count. */
  readonly inversion: number;
  /** Octaves above the part's register octave, `±CHORD_STEP_OCTAVE_MAX`. */
  readonly octave: number;
  /** Chromatic shift of the whole chord, `±CHORD_SEMITONE_MAX`. */
  readonly semitone: number;
}

export type ChordStep = ChordRestStep | ChordChordStep;

export const CHORD_STEP_KINDS = ['rest', 'chord'] as const;
export type ChordStepKind = (typeof CHORD_STEP_KINDS)[number];

export interface ChordSequencerConfig {
  /** Ticks per base step; one of `CHORD_DIVISORS`. */
  divisor: number;
  /** A chord's length as a fraction of its step, in (0, 1]; 1 holds to the next onset. */
  gate: number;
  /** One voicing for the whole progression (epic #605 decision 6). */
  voicing: ChordVoicingId;
  /** Octaves from the root the progression is written at. */
  register: { octave: number };
  /** 0–`CHORD_STEPS_MAX` steps; empty is silent. */
  steps: readonly ChordStep[];
  seed: number;
  generatorIndex: number;
}

/** A chord step on `degree`: a root-position triad, one base step, once. */
export function chordStep(
  degree = 0,
  over: Partial<Omit<ChordChordStep, 'kind'>> = {},
): ChordChordStep {
  return {
    kind: 'chord',
    degree,
    size: CHORD_SIZE_TRIAD,
    inversion: 0,
    octave: 0,
    semitone: 0,
    duration: CHORD_DURATION_DEFAULT,
    repeat: CHORD_REPEAT_DEFAULT,
    ...over,
  };
}

/** A rest of one base step, once. */
export function restStep(over: Partial<StepTiming> = {}): ChordRestStep {
  return { kind: 'rest', duration: CHORD_DURATION_DEFAULT, repeat: CHORD_REPEAT_DEFAULT, ...over };
}

export const DEFAULT_CHORD_CONFIG: ChordSequencerConfig = {
  divisor: DIVISORS.bar,
  gate: CHORD_GATE_DEFAULT,
  voicing: CHORD_VOICING_DEFAULT,
  register: { octave: 0 },
  steps: [],
  seed: 0,
  generatorIndex: 0,
};

function assertStep(step: ChordStep, index: number): void {
  const where = `steps[${index}]`;
  if (!CHORD_DURATIONS.includes(step.duration)) {
    throw new RangeError(`${where}.duration must be one of ${CHORD_DURATIONS.join('|')}`);
  }
  if (!Number.isInteger(step.repeat) || step.repeat < 1 || step.repeat > CHORD_REPEAT_MAX) {
    throw new RangeError(`${where}.repeat must be an integer 1..${CHORD_REPEAT_MAX}`);
  }
  if (step.kind !== 'chord') return;
  if (!Number.isInteger(step.degree) || step.degree < 0) {
    throw new RangeError(`${where}.degree must be a non-negative integer, got ${step.degree}`);
  }
  if (!isChordSize(step.size)) throw new RangeError(`${where}.size must be a triad or seventh`);
  if (
    !Number.isInteger(step.inversion) ||
    step.inversion < 0 ||
    step.inversion > CHORD_INVERSION_MAX
  ) {
    throw new RangeError(`${where}.inversion must be 0..${CHORD_INVERSION_MAX}`);
  }
  if (!Number.isInteger(step.octave) || Math.abs(step.octave) > CHORD_STEP_OCTAVE_MAX) {
    throw new RangeError(`${where}.octave must be within ±${CHORD_STEP_OCTAVE_MAX}`);
  }
  if (!Number.isInteger(step.semitone) || Math.abs(step.semitone) > CHORD_SEMITONE_MAX) {
    throw new RangeError(`${where}.semitone must be within ±${CHORD_SEMITONE_MAX}`);
  }
}

/** Every constructor and `reconfigure` check; the player runs it inside `plan` so a bad live edit is refused before anything commits. */
export function assertChordConfig(config: ChordSequencerConfig): void {
  if (!CHORD_DIVISORS.includes(config.divisor)) {
    throw new RangeError(
      `divisor must be one of ${CHORD_DIVISORS.join('|')}, got ${config.divisor}`,
    );
  }
  if (!(config.gate > 0 && config.gate <= 1)) {
    throw new RangeError(`gate must be in (0, 1], got ${config.gate}`);
  }
  if (!CHORD_VOICING_IDS.includes(config.voicing)) {
    throw new RangeError(`voicing must be one of ${CHORD_VOICING_IDS.join('|')}`);
  }
  if (config.steps.length > CHORD_STEPS_MAX) {
    throw new RangeError(
      `steps must hold at most ${CHORD_STEPS_MAX} entries, got ${config.steps.length}`,
    );
  }
  config.steps.forEach(assertStep);
}

/** One playing of one step: where it starts in the pattern and how long it lasts. */
export interface ChordSegment {
  readonly step: number;
  readonly repeat: number;
  readonly start: number;
  readonly ticks: number;
}

/** The pattern laid out in ticks: one segment per repeat, in order. */
export function layoutSegments(config: ChordSequencerConfig): ChordSegment[] {
  const segments: ChordSegment[] = [];
  let start = 0;
  config.steps.forEach((step, index) => {
    const ticks = Math.max(1, Math.round(step.duration * config.divisor));
    for (let repeat = 0; repeat < step.repeat; repeat++) {
      segments.push({ step: index, repeat, start, ticks });
      start += ticks;
    }
  });
  return segments;
}

export class ChordSequencer {
  onNote: NoteHandler | null = null;

  private current: ChordSequencerConfig;
  private sampler: ScaleSampler;
  private segments: ChordSegment[] = [];
  private byStart = new Map<number, ChordSegment>();
  private length = 0;
  /** The notes sounding into the next onset, if the gate holds them. */
  private held: number[] = [];

  constructor(sampler: ScaleSampler, config: ChordSequencerConfig) {
    assertChordConfig(config);
    this.sampler = sampler;
    this.current = config;
    this.layout();
  }

  get config(): ChordSequencerConfig {
    return this.current;
  }

  /** The pattern's length in ticks; 0 when there are no steps. */
  get lengthTicks(): number {
    return this.length;
  }

  get heldNotes(): readonly number[] {
    return this.held;
  }

  /**
   * Take a new pattern, gate, voicing or register, and optionally a new
   * sampler, without a rebuild: whatever is held plays on until the next
   * onset releases it, so an edit never cuts the sounding chord.
   */
  reconfigure(config: ChordSequencerConfig, sampler: ScaleSampler = this.sampler): void {
    assertChordConfig(config);
    this.current = config;
    this.sampler = sampler;
    this.layout();
  }

  /** The step and repeat a transport tick falls in — the console's playhead; null when empty. */
  stepAt(tick: number): { step: number; repeat: number } | null {
    if (this.length === 0) return null;
    const offset = ((tick % this.length) + this.length) % this.length;
    let found: ChordSegment | undefined;
    for (const segment of this.segments) {
      if (segment.start > offset) break;
      found = segment;
    }
    return found ? { step: found.step, repeat: found.repeat } : null;
  }

  attach(source: TickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One tick. Returns the events it emitted; most ticks emit none. */
  handleTick(event: TickEvent): NoteEvent[] {
    if (this.length === 0)
      return this.held.length > 0 ? this.releaseHeld(event.tick, event.time) : [];
    const segment = this.byStart.get(event.tick % this.length);
    if (!segment) return [];
    const step = this.current.steps[segment.step];
    const events = this.held.length > 0 ? this.releaseHeld(event.tick, event.time, false) : [];
    if (step && step.kind === 'chord') events.push(...this.onset(event, step, segment));
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release everything held at the given tick — what a transport stop calls. */
  release(tick: number, time: number): NoteEvent[] {
    return this.releaseHeld(tick, time);
  }

  private onset(event: TickEvent, step: ChordChordStep, segment: ChordSegment): NoteEvent[] {
    const stack = chordTones(this.sampler.offsets, step.degree, step.size);
    const notes = voiceChord(
      stack,
      {
        inversion: step.inversion,
        voicing: this.current.voicing,
        octave: this.current.register.octave + step.octave,
        semitone: step.semitone,
      },
      this.sampler.root,
    );
    const events: NoteEvent[] = notes.map((note) => ({
      kind: 'noteOn',
      tick: event.tick,
      time: event.time,
      note,
      degree: step.degree,
    }));
    const gateTicks = Math.max(1, Math.round(this.current.gate * segment.ticks));
    if (gateTicks >= segment.ticks) {
      this.held = notes;
      return events;
    }
    for (const note of notes) {
      events.push({
        kind: 'noteOff',
        tick: event.tick + gateTicks,
        time: event.time + gateTicks * event.secondsPerTick,
        note,
      });
    }
    return events;
  }

  private releaseHeld(tick: number, time: number, emit = true): NoteEvent[] {
    const events: NoteEvent[] = this.held.map((note) => ({ kind: 'noteOff', tick, time, note }));
    this.held = [];
    if (emit) for (const e of events) this.onNote?.(e);
    return events;
  }

  private layout(): void {
    this.segments = layoutSegments(this.current);
    this.byStart = new Map(this.segments.map((s) => [s.start, s]));
    const last = this.segments[this.segments.length - 1];
    this.length = last ? last.start + last.ticks : 0;
  }
}
