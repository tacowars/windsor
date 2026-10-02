/**
 * The Chord Player (#606, refactored by #705 — epic #703 decision 15): a
 * written rhythm of 0–32 steps, each a rest or a *hit*, and a hit voices
 * whatever chord the song's harmony timeline holds on that tick.
 *
 * A step is `{ duration, repeat }` and, for a hit, `{ inversion, octave }`:
 * `duration` is a multiple of the part's base step (`divisor` ticks) and
 * `repeat` plays the step that many times in a row, retriggered each time.
 * The steps are laid out as *segments*, one per repeat, and the pattern's
 * length is their sum in ticks. Position is the part's local tick (since its
 * region entry, through the region gate) modulo that length; the generator
 * subscribes at every tick and acts only on a segment's first.
 *
 * The chord itself is not in the step: the gate hands every tick the
 * `HarmonyChord` at the transport tick (`chordAt`), and a hit's onset takes
 * its stack from there (`chord.stack`, windsor#330), voices it through
 * `voiceChord` with the step's `inversion` and `octave` and the part's
 * `voicing`, above the key root at the part's absolute register octave. A
 * chord change never restarts anything: a hit sustaining across a harmony
 * boundary keeps its notes to its own end (decision 2 — only future onsets
 * change). With `follow` on (windsor#333, record
 * `2026-10-02-chord-player-follow`) the held hit follows instead: on a tick
 * whose chord stack or key root differs from the one the held notes were
 * voiced from, the shared tones stay and only the voices that must move step
 * to the nearest new chord tone (`followVoices`) — an off then an on per
 * moved voice, nothing for a common tone.
 *
 * At an onset the notes still held are released on that tick, before the new
 * chord's note-ons; a rest's onset releases and plays nothing. With `gate`
 * below 1 the chord's offs are emitted on the tick the gate ends — deferred,
 * not scheduled ahead at the onset, so a live edit that clears or shortens
 * the progression can still release it (Codex, #606); at 1 the chord holds to
 * the next onset. Repeats retrigger — there are no ties. An empty step list
 * is silent: its first tick releases whatever a previous pattern left sounding.
 * `reconfigure` takes a new pattern, voicing, gate, register or sampler live,
 * without a rebuild (#603's rule: an edit never cuts the sounding chord).
 * Nothing here is random.
 */
import {
  CHORD_DURATION_DEFAULT,
  CHORD_GATE_DEFAULT,
  CHORD_INVERSION_MAX,
  CHORD_REGISTER_OCTAVE_DEFAULT,
  CHORD_REPEAT_DEFAULT,
  CHORD_REPEAT_MAX,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
  type ChordVoicingId,
} from '../harmony/chordTables';
import { voiceChord } from '../harmony/chordVoicing';
import type { HarmonyChord } from '../harmony/harmonyTimeline';
import { followVoices } from '../harmony/voiceLeading';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { SEMITONES_PER_OCTAVE, type ScaleSampler } from './scaleSampler';
import { DIVISORS, type Unsubscribe } from './scheduler';

interface StepTiming {
  /** A multiple of the part's base step, from `CHORD_DURATIONS`. */
  readonly duration: number;
  /** Times in a row the step plays, 1–`CHORD_REPEAT_MAX`. */
  readonly repeat: number;
}

export interface ChordRestStep extends StepTiming {
  readonly kind: 'rest';
}

/** A hit: the current harmony chord, voiced with this step's inversion and octave. */
export interface ChordHitStep extends StepTiming {
  readonly kind: 'hit';
  /** 0–`CHORD_INVERSION_MAX` as written; wraps with octave carry past the tone count. */
  readonly inversion: number;
  /** Octaves above the part's register octave, `±CHORD_STEP_OCTAVE_MAX`. */
  readonly octave: number;
}

export type ChordStep = ChordRestStep | ChordHitStep;

export const CHORD_STEP_KINDS = ['rest', 'hit'] as const;
export type ChordStepKind = (typeof CHORD_STEP_KINDS)[number];

export interface ChordSequencerConfig {
  /** Ticks per base step; one of `CHORD_DIVISORS`. */
  divisor: number;
  /** A chord's length as a fraction of its step, in (0, 1]; 1 holds to the next onset. */
  gate: number;
  /** One voicing for the whole progression (epic #605 decision 6). */
  voicing: ChordVoicingId;
  /** The absolute MIDI octave the hits are voiced at (decision 11). */
  register: { octave: number };
  /** 0–`CHORD_STEPS_MAX` steps; empty is silent. */
  steps: readonly ChordStep[];
  /** A held hit follows a chord change with minimal voice motion (windsor#333); off keeps #705's rule. */
  follow: boolean;
}

/** A hit of one base step, once, in root position at the register. */
export function hitStep(over: Partial<Omit<ChordHitStep, 'kind'>> = {}): ChordHitStep {
  return {
    kind: 'hit',
    inversion: 0,
    octave: 0,
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
  divisor: DIVISORS.whole,
  gate: CHORD_GATE_DEFAULT,
  voicing: CHORD_VOICING_DEFAULT,
  register: { octave: CHORD_REGISTER_OCTAVE_DEFAULT },
  steps: [],
  follow: false,
};

function assertStep(step: ChordStep, index: number): void {
  const where = `steps[${index}]`;
  if (!CHORD_DURATIONS.includes(step.duration)) {
    throw new RangeError(`${where}.duration must be one of ${CHORD_DURATIONS.join('|')}`);
  }
  if (!Number.isInteger(step.repeat) || step.repeat < 1 || step.repeat > CHORD_REPEAT_MAX) {
    throw new RangeError(`${where}.repeat must be an integer 1..${CHORD_REPEAT_MAX}`);
  }
  if (step.kind !== 'hit') return;
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
  const octave = config.register.octave;
  if (!Number.isInteger(octave) || octave < REGISTER_OCTAVE_MIN || octave > REGISTER_OCTAVE_MAX) {
    throw new RangeError(
      `register.octave must be an integer ${REGISTER_OCTAVE_MIN}..${REGISTER_OCTAVE_MAX}, got ${octave}`,
    );
  }
  if (config.steps.length > CHORD_STEPS_MAX) {
    throw new RangeError(
      `steps must hold at most ${CHORD_STEPS_MAX} entries, got ${config.steps.length}`,
    );
  }
  config.steps.forEach(assertStep);
  if (typeof config.follow !== 'boolean') {
    throw new TypeError(`follow must be a boolean, got ${String(config.follow)}`);
  }
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

/**
 * The MIDI notes a hit sounds for `chord` under the part's voicing and
 * register: what an onset plays, and what the console auditions when a Hit
 * tile is pressed.
 */
export function voiceHit(
  sampler: ScaleSampler,
  config: Pick<ChordSequencerConfig, 'voicing' | 'register'>,
  step: Pick<ChordHitStep, 'inversion' | 'octave'>,
  chord: HarmonyChord,
): number[] {
  return voiceChord(
    chord.stack,
    { inversion: step.inversion, voicing: config.voicing, octave: step.octave },
    sampler.rootNote(config.register.octave),
  );
}

export class ChordSequencer {
  onNote: NoteHandler | null = null;

  private current: ChordSequencerConfig;
  private sampler: ScaleSampler;
  private segments: ChordSegment[] = [];
  private byStart = new Map<number, ChordSegment>();
  private length = 0;
  /** The notes sounding now: released at the next onset, or at `releaseTick` when the gate ends. */
  private held: number[] = [];
  /** The local tick a gated chord's offs go out on; null while the held chord runs to the next onset. */
  private releaseTick: number | null = null;
  /**
   * What the held notes were voiced from: the key root's pitch class and the
   * chord's stack, as a string (the gate builds a fresh chord every tick, so
   * the object never identifies it). Null while nothing is held.
   */
  private heldChord: string | null = null;
  /** Set when `follow` turns on mid-hold: the next tick adopts the sounding chord without moving. */
  private resync = false;

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
   * onset, or its own gate end, releases it, so an edit never cuts the
   * sounding chord and never strands it either.
   */
  reconfigure(config: ChordSequencerConfig, sampler: ScaleSampler = this.sampler): void {
    assertChordConfig(config);
    // Follow takes effect at the next chord change, never at the toggle.
    if (config.follow && !this.current.follow) this.resync = true;
    this.current = config;
    this.sampler = sampler;
    this.layout();
  }

  /** Nothing to restart: the Chord Player draws nothing, and the gate released what it held. */
  enter(_regionIndex: number): void {}

  /** The step and repeat a local tick falls in — the console's playhead; null when empty. */
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

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One local tick. Returns the events it emitted; most ticks emit none. */
  handleTick(event: PartTickEvent): NoteEvent[] {
    const gateEnded = this.releaseTick !== null && event.tick >= this.releaseTick;
    if (this.length === 0) {
      return this.held.length > 0 ? this.releaseHeld(event.tick, event.time) : [];
    }
    const segment = this.byStart.get(event.tick % this.length);
    if (!segment) return gateEnded ? this.releaseHeld(event.tick, event.time) : this.follow(event);
    const step = this.current.steps[segment.step];
    const events = this.held.length > 0 ? this.releaseHeld(event.tick, event.time, false) : [];
    if (step && step.kind === 'hit' && event.chord) {
      events.push(...this.onset(event, step, segment, event.chord));
    }
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release everything held at the given tick — what a transport stop or a region end calls. */
  release(tick: number, time: number): NoteEvent[] {
    return this.releaseHeld(tick, time);
  }

  private onset(
    event: PartTickEvent,
    step: ChordHitStep,
    segment: ChordSegment,
    chord: HarmonyChord,
  ): NoteEvent[] {
    const notes = voiceHit(this.sampler, this.current, step, chord);
    const events: NoteEvent[] = notes.map((note) => ({
      kind: 'noteOn',
      tick: event.tick,
      time: event.time,
      note,
      degree: chord.event.degree,
    }));
    const gateTicks = Math.max(1, Math.round(this.current.gate * segment.ticks));
    this.held = notes;
    this.heldChord = this.chordKey(chord);
    this.resync = false;
    this.releaseTick = gateTicks >= segment.ticks ? null : event.tick + gateTicks;
    return events;
  }

  private releaseHeld(tick: number, time: number, emit = true): NoteEvent[] {
    const events: NoteEvent[] = this.held.map((note) => ({ kind: 'noteOff', tick, time, note }));
    this.held = [];
    this.releaseTick = null;
    this.heldChord = null;
    if (emit) for (const e of events) this.onNote?.(e);
    return events;
  }

  /**
   * A tick between onsets: with `follow` on and notes held, a chord whose
   * stack or key root changed moves the voices that must move — offs for
   * their old pitches, then ons for the new, on this tick. The release tick
   * is unchanged. A null chord or an unchanged one emits nothing.
   */
  private follow(event: PartTickEvent): NoteEvent[] {
    const chord = event.chord;
    if (!this.current.follow || this.held.length === 0 || !chord) return [];
    const key = this.chordKey(chord);
    if (this.resync) {
      this.resync = false;
      this.heldChord = key;
      return [];
    }
    if (key === this.heldChord) return [];
    this.heldChord = key;
    const moved = followVoices(this.held, chord.stack, this.sampler.rootNote(0));
    const { tick, time } = event;
    const steps = this.held.flatMap((from, i) => {
      const to = moved[i] ?? from;
      return to === from ? [] : [{ from, to }];
    });
    const events: NoteEvent[] = [
      ...steps.map(({ from }): NoteEvent => ({ kind: 'noteOff', tick, time, note: from })),
      ...steps.map(({ to }): NoteEvent => ({
        kind: 'noteOn',
        tick,
        time,
        note: to,
        degree: chord.event.degree,
      })),
    ];
    this.held = moved;
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** The held chord's identity: the key root's pitch class and the stack (decision 3). */
  private chordKey(chord: HarmonyChord): string {
    return `${this.sampler.rootNote(0) % SEMITONES_PER_OCTAVE}|${chord.stack.join(',')}`;
  }

  private layout(): void {
    this.segments = layoutSegments(this.current);
    this.byStart = new Map(this.segments.map((s) => [s.start, s]));
    const last = this.segments[this.segments.length - 1];
    this.length = last ? last.start + last.ticks : 0;
  }
}
