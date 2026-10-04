/**
 * The Roll (windsor#599, epic windsor#596; record `2026-10-04-roll-sequencer`):
 * a piano roll's notes over a loop. A note is an absolute MIDI pitch with a
 * free onset, length and velocity, in the region's local ticks (24 PPQ); a
 * key or chord change never moves it.
 *
 * The loop is `loopTicks`, at most the region's length once the console
 * draws it (windsor#601). A note whose `tick` is at or past the loop is
 * kept and silent until the loop grows back over it, so shrinking the loop
 * loses nothing. A note's `velocity` scales the part's velocity as a Figure
 * cell's does (`partNoteOn`); absent is 1, and a note at 0 is silent, as a
 * Figure cell at 0 is a rest.
 *
 * This file is the field set, its defaults, the check and the performer
 * (windsor#600); the normaliser is `song/rollNormalise.ts`, which also keeps
 * the notes sorted and free of same-pitch overlaps.
 *
 * **The performer.** `RollSequencer` hears its region gate at every local
 * tick `t`, at loop position `p = t mod loopTicks`. On a tick it first
 * releases every held note due by then, then starts every note whose `tick`
 * is `p`, so a note ending where the same pitch starts again is retriggered,
 * not swallowed. A note is released `min(ticks, loopTicks − tick)` after its
 * onset: it is cut at the loop's end whatever its length. The region's end
 * releases everything held, through the gate's leave, as for every kind.
 * Held notes are tracked by pitch, any number at once; a same-pitch onset
 * while that pitch is held releases the held one first. Nothing chases: an
 * entry mid-note (a seek, a loop jump) starts only the onsets it reaches.
 *
 * A live edit keeps every held note on its scheduled release, unless its
 * note (known by its onset and pitch) is gone, which releases it on the
 * next tick. The position is read from the clock at every tick, so a new
 * `loopTicks` plays on without a restart. Nothing is drawn at random, and a
 * tick that starts and releases nothing allocates nothing.
 */
import { BARS_MAX, MIDI_NOTE_MAX, ROLL_NOTES_MAX } from '../audioConstants';
import { ticksPerBar } from './meter';
import type { Meter } from './meterTables';
import type { NoteEvent, NoteHandler, NoteOnEvent } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { TICKS_PER_BAR, type Unsubscribe } from './scheduler';

/** The longest loop, and so one past the latest onset: `BARS_MAX` bars of 4/4. */
export const ROLL_LOOP_TICKS_MAX = BARS_MAX * TICKS_PER_BAR;

export interface RollNote {
  /** The onset in the region's local ticks, 0..`ROLL_LOOP_TICKS_MAX` − 1. */
  readonly tick: number;
  /** The length in ticks, 1..`ROLL_LOOP_TICKS_MAX`. */
  readonly ticks: number;
  /** Absolute MIDI pitch, 0..`MIDI_NOTE_MAX`. */
  readonly pitch: number;
  /** Scales the part's velocity, 0–1; absent is 1. */
  readonly velocity?: number;
}

export interface RollSequencerConfig {
  /** The loop in ticks, 1..`ROLL_LOOP_TICKS_MAX`. */
  loopTicks: number;
  /** 0..`ROLL_NOTES_MAX` notes, sorted by `tick` then `pitch`. */
  notes: readonly RollNote[];
}

/** An empty roll looping one bar of `meter` (4/4 when absent). */
export function defaultRollConfig(meter?: Meter): RollSequencerConfig {
  return { loopTicks: ticksPerBar(meter), notes: [] };
}

export const DEFAULT_ROLL_CONFIG: RollSequencerConfig = defaultRollConfig();

const isIntIn = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

function assertRollNote(note: RollNote, index: number): void {
  const at = `notes[${index}]`;
  if (!isIntIn(note.tick, 0, ROLL_LOOP_TICKS_MAX - 1)) {
    throw new RangeError(`${at}.tick must be an integer 0..${ROLL_LOOP_TICKS_MAX - 1}`);
  }
  if (!isIntIn(note.ticks, 1, ROLL_LOOP_TICKS_MAX)) {
    throw new RangeError(`${at}.ticks must be an integer 1..${ROLL_LOOP_TICKS_MAX}`);
  }
  if (!isIntIn(note.pitch, 0, MIDI_NOTE_MAX)) {
    throw new RangeError(`${at}.pitch must be an integer 0..${MIDI_NOTE_MAX}`);
  }
  const { velocity } = note;
  if (velocity !== undefined && !(velocity >= 0 && velocity <= 1)) {
    throw new RangeError(`${at}.velocity must be in [0, 1], got ${velocity}`);
  }
}

/**
 * The ranges of every field. The order of the notes and their overlaps are
 * the normaliser's to settle, not this check's.
 */
export function assertRollConfig(config: RollSequencerConfig): void {
  if (!isIntIn(config.loopTicks, 1, ROLL_LOOP_TICKS_MAX)) {
    throw new RangeError(`loopTicks must be an integer 1..${ROLL_LOOP_TICKS_MAX}`);
  }
  if (!Array.isArray(config.notes) || config.notes.length > ROLL_NOTES_MAX) {
    throw new RangeError(`notes must be a list of at most ${ROLL_NOTES_MAX}`);
  }
  config.notes.forEach(assertRollNote);
}

/** A pitch no note holds. */
const NOT_HELD = -1;

/** What a tick that starts and releases nothing hands back: one shared empty list. */
const NO_EVENTS: readonly NoteEvent[] = Object.freeze([]);

/** The notes in the order they start: by `tick`, then `pitch`. */
const byOnset = (notes: readonly RollNote[]): readonly RollNote[] =>
  [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

/** The index of the first note in `onsets` (sorted by onset) at or after loop tick `tick`. */
function firstOnsetAt(onsets: readonly RollNote[], tick: number): number {
  let lo = 0;
  let hi = onsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((onsets[mid] as RollNote).tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Whether `onsets` holds a note starting on loop tick `tick` at `pitch`. */
function hasNote(onsets: readonly RollNote[], tick: number, pitch: number): boolean {
  for (let i = firstOnsetAt(onsets, tick); i < onsets.length; i++) {
    const note = onsets[i] as RollNote;
    if (note.tick !== tick) return false;
    if (note.pitch === pitch) return true;
  }
  return false;
}

export class RollSequencer {
  onNote: NoteHandler | null = null;

  private current: RollSequencerConfig;
  private onsets: readonly RollNote[];
  /** Per pitch, the local tick its held note is released on; `NOT_HELD` while none sounds. */
  private readonly releaseAt = new Int32Array(MIDI_NOTE_MAX + 1).fill(NOT_HELD);
  /** Per pitch, the loop tick its held note started on: with the pitch, which note it is. */
  private readonly heldOnset = new Int32Array(MIDI_NOTE_MAX + 1);
  private heldCount = 0;

  constructor(config: RollSequencerConfig) {
    assertRollConfig(config);
    this.current = config;
    this.onsets = byOnset(config.notes);
  }

  get config(): RollSequencerConfig {
    return this.current;
  }

  /** The gate entered a region. Nothing is drawn, so nothing restarts. */
  enter(_regionIndex: number): void {}

  /**
   * A new `notes` or `loopTicks`, live. A held note keeps its scheduled
   * release unless its note is gone (removed, moved or re-pitched): then
   * the next tick releases it.
   */
  reconfigure(config: RollSequencerConfig): void {
    assertRollConfig(config);
    this.current = config;
    this.onsets = byOnset(config.notes);
    for (let pitch = 0; pitch <= MIDI_NOTE_MAX; pitch++) {
      if (this.releaseAt[pitch] === NOT_HELD) continue;
      if (!hasNote(this.onsets, this.heldOnset[pitch] as number, pitch)) this.releaseAt[pitch] = 0;
    }
  }

  /** The loop tick a local tick (since the region entry) plays: the device's playhead. */
  stepAt(localTick: number): number {
    return localTick % this.current.loopTicks;
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One local tick: the releases due, then the onsets at its loop position. */
  handleTick(event: PartTickEvent): readonly NoteEvent[] {
    const { tick, time } = event;
    const { loopTicks } = this.current;
    const position = tick % loopTicks;
    const onsets = this.onsets;
    let events = this.heldCount > 0 ? this.releaseDue(tick, tick, time) : null;
    for (let i = firstOnsetAt(onsets, position); i < onsets.length; i++) {
      const note = onsets[i] as RollNote;
      if (note.tick !== position) break;
      if (note.velocity === 0) continue;
      events ??= [];
      if (this.releaseAt[note.pitch] !== NOT_HELD) events.push(this.off(note.pitch, tick, time));
      events.push(this.start(note, tick, time, loopTicks));
    }
    return this.emit(events);
  }

  /** Release every held note at the given tick: a transport stop or a region end. */
  release(tick: number, time: number): readonly NoteEvent[] {
    return this.emit(this.heldCount > 0 ? this.releaseDue(Infinity, tick, time) : null);
  }

  private emit(events: NoteEvent[] | null): readonly NoteEvent[] {
    if (events === null) return NO_EVENTS;
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** The note-offs, on local tick `tick`, of every held note due by local tick `due`; null with none. */
  private releaseDue(due: number, tick: number, time: number): NoteEvent[] | null {
    let events: NoteEvent[] | null = null;
    for (let pitch = 0; pitch <= MIDI_NOTE_MAX && this.heldCount > 0; pitch++) {
      const at = this.releaseAt[pitch] as number;
      if (at === NOT_HELD || at > due) continue;
      events ??= [];
      events.push(this.off(pitch, tick, time));
    }
    return events;
  }

  private off(pitch: number, tick: number, time: number): NoteEvent {
    this.releaseAt[pitch] = NOT_HELD;
    this.heldCount--;
    return { kind: 'noteOff', tick, time, note: pitch };
  }

  /** The note-on of `note` on local tick `tick`, held to the loop's end at most. */
  private start(note: RollNote, tick: number, time: number, loopTicks: number): NoteOnEvent {
    this.releaseAt[note.pitch] = tick + Math.min(note.ticks, loopTicks - note.tick);
    this.heldOnset[note.pitch] = note.tick;
    this.heldCount++;
    const on: NoteOnEvent = { kind: 'noteOn', tick, time, note: note.pitch, degree: 0 };
    if (note.velocity !== undefined && note.velocity !== 1) on.velocity = note.velocity;
    return on;
  }
}
