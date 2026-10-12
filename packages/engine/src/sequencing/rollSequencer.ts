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
 * A roll may carry clip envelopes (`envelopes`, windsor#701, epic
 * windsor#699): voice-target curves in the same loop-local ticks, which
 * `rollEnvelope.ts` types, checks and evaluates. Absent or empty is none,
 * and the performer below does not read them.
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
 * **Slide by overlap** (windsor#739, record `2026-10-11-bounce-to-roll`
 * decision 7). A note-on carries `slide` when a note of another pitch is
 * still held: one that started on an earlier tick and whose release falls
 * after this tick. Since releases come first, every note held when a tick's
 * onsets begin is such a note, so the count held then answers it with no
 * scan. Notes starting on one tick (a chord) never slide into each other,
 * and touching notes (one released on the tick the next starts) retrigger.
 * A mono patch glides the sounding voice into the new note
 * (`NoteOnMessage.slide`); a poly patch ignores the flag. The note slid from
 * still sends its note-off when it ends, which finds its handle no longer
 * bound to a voice and releases nothing.
 *
 * **Accents and ratchets** (windsor#753, record
 * `2026-10-12-roll-note-accent-and-ratchet`). A note may carry `accent` and
 * `ratchet`, and plays them as a Grid step does (`gridSequencer.ts`). An
 * accented note-on carries the roll's `accentVelocity` and `accentMod`
 * (the Grid's defaults when absent), which `partNoteOn` turns into the
 * velocity bump and the voice's mod; the note's own `velocity` is
 * unchanged. A ratcheted note-on carries a `roll` of `ratchet` hits over
 * the note's length as it plays (cut at the loop's end, as its release
 * is; a cut that leaves less than `ROLL_RATCHET_MIN_TICKS` plays one hit),
 * at gate 1 and open: the player spends the later hits evenly across
 * that span in seconds, under swing (`pitchedRoll.ts`, `rollSpan.ts`). Hit
 * 0 is the note-on, slide and all; each later hit is a note-off then a
 * note-on with the accent and no slide; the last is held open and this
 * performer releases it at the note's end, so slide by overlap into the
 * next note works as for a plain note. The normaliser keeps both marks off
 * a note sharing its onset (a chord), and a ratchet off a note shorter than
 * `ROLL_RATCHET_MIN_TICKS`, and the performer holds the same minimum over
 * the span a loop cut leaves.
 *
 * A live edit keeps every held note on its scheduled release, unless its
 * note (known by its onset and pitch) is gone, which releases it on the
 * next tick. A ratcheted note is the exception: its hits are already
 * queued, so it keeps its scheduled release, which ends its open last hit
 * after that hit has started. The position is read from the clock at every
 * tick, so a new `loopTicks` plays on without a restart. Nothing is drawn
 * at random, and a tick that starts and releases nothing allocates nothing.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  BARS_MAX,
  MIDI_NOTE_MAX,
  ROLL_NOTES_MAX,
} from '../audioConstants';
import { assertRatchet } from './gridSequencer';
import { ticksPerBar } from './meter';
import type { Meter } from './meterTables';
import type { NoteEvent, NoteHandler, NoteOnEvent } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { assertRollEnvelopes, type RollEnvelope } from './rollEnvelope';
import { ROLL_RATCHET_MIN_TICKS } from './rollNoteTables';
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
  /** Played with the roll's accent amounts (windsor#753); absent is a plain note. */
  readonly accent?: true;
  /**
   * Hits across the note's length, 2..`RATCHET_MAX` (windsor#753); absent is
   * one. The check accepts 1 as the same as absent; the normaliser writes it
   * as no key.
   */
  readonly ratchet?: number;
}

export interface RollSequencerConfig {
  /** The loop in ticks, 1..`ROLL_LOOP_TICKS_MAX`. */
  loopTicks: number;
  /** 0..`ROLL_NOTES_MAX` notes, sorted by `tick` then `pitch`. */
  notes: readonly RollNote[];
  /** The bump an accented note adds to the part's velocity, 0..1; absent is `ACCENT_VELOCITY_DEFAULT`. */
  accentVelocity?: number;
  /** The per-note mod an accented note sends, 0..1; absent is `ACCENT_MOD_DEFAULT`. */
  accentMod?: number;
  /**
   * 0..`ROLL_ENVELOPES_MAX` clip envelopes, each on its own voice target;
   * absent is none, and the normaliser writes an empty list as absent.
   */
  envelopes?: readonly RollEnvelope[];
}

/** An empty roll looping one bar of `meter` (4/4 when absent). */
export function defaultRollConfig(meter?: Meter): RollSequencerConfig {
  return { loopTicks: ticksPerBar(meter), notes: [] };
}

export const DEFAULT_ROLL_CONFIG: RollSequencerConfig = defaultRollConfig();

/**
 * The config keys a normalised roll omits at their defaults (windsor#753),
 * which a live partial may still add: `arrangement.ts` lets a merge reach
 * them though the current roll lacks them.
 */
export const ROLL_OPTIONAL_KEYS = ['accentVelocity', 'accentMod'] as const;

/** A note's fields, writable: what the setters below copy and change. */
type EditedNote = { -readonly [K in keyof RollNote]: RollNote[K] };

/** `note` accented or plain (windsor#753); plain leaves no key, as the normaliser writes it. */
export function withRollNoteAccent(note: RollNote, accent: boolean): RollNote {
  const next: EditedNote = { ...note };
  if (accent) next.accent = true;
  else delete next.accent;
  return next;
}

/** `note` with `ratchet` hits (windsor#753); one leaves no key, as the normaliser writes it. */
export function withRollNoteRatchet(note: RollNote, ratchet: number): RollNote {
  const next: EditedNote = { ...note };
  if (ratchet > 1) next.ratchet = ratchet;
  else delete next.ratchet;
  return next;
}

/**
 * The onset ticks two or more of `notes` share, in any order: where a chord
 * starts. A note on one of them carries no accent and no ratchet (record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 5): the normaliser
 * clears them, and the lane draws no cell there.
 */
export function rollSharedOnsets(notes: readonly RollNote[]): ReadonlySet<number> {
  const seen = new Set<number>();
  const shared = new Set<number>();
  for (const { tick } of notes) {
    if (seen.has(tick)) shared.add(tick);
    else seen.add(tick);
  }
  return shared;
}

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
  if (note.accent !== undefined && note.accent !== true) {
    throw new RangeError(`${at}.accent must be true or absent, got ${String(note.accent)}`);
  }
  assertRatchet(note.ratchet, at);
}

const isUnitOrAbsent = (value: number | undefined): boolean =>
  value === undefined || (value >= 0 && value <= 1);

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
  for (const key of ['accentVelocity', 'accentMod'] as const) {
    const value = config[key];
    if (!isUnitOrAbsent(value)) throw new RangeError(`${key} must be in [0, 1], got ${value}`);
  }
  if (config.envelopes !== undefined) assertRollEnvelopes(config.envelopes);
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
  /** Per pitch, the local tick its held note started on, to tell an earlier note from a chord's. */
  private readonly heldSince = new Int32Array(MIDI_NOTE_MAX + 1);
  /** Per pitch, 1 while its held note is ratcheted: its hits are queued, so an edit never cuts it. */
  private readonly heldRolled = new Uint8Array(MIDI_NOTE_MAX + 1);
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
   * the next tick releases it. A ratcheted one always keeps it, since the
   * player has queued its hits up to then.
   */
  reconfigure(config: RollSequencerConfig): void {
    assertRollConfig(config);
    this.current = config;
    this.onsets = byOnset(config.notes);
    for (let pitch = 0; pitch <= MIDI_NOTE_MAX; pitch++) {
      if (this.releaseAt[pitch] === NOT_HELD || this.heldRolled[pitch] === 1) continue;
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

  /**
   * One local tick: the releases due, then the onsets at its loop position,
   * each sliding while a note from an earlier tick is still held.
   */
  handleTick(event: PartTickEvent): readonly NoteEvent[] {
    const { tick, time } = event;
    const { loopTicks } = this.current;
    const position = tick % loopTicks;
    const onsets = this.onsets;
    let events = this.heldCount > 0 ? this.releaseDue(tick, tick, time) : null;
    // Every note held now started on an earlier tick and is released after this one.
    let heldEarlier = this.heldCount;
    for (let i = firstOnsetAt(onsets, position); i < onsets.length; i++) {
      const note = onsets[i] as RollNote;
      if (note.tick !== position) break;
      if (note.velocity === 0) continue;
      events ??= [];
      if (this.releaseAt[note.pitch] !== NOT_HELD) {
        if ((this.heldSince[note.pitch] as number) < tick) heldEarlier--;
        events.push(this.off(note.pitch, tick, time));
      }
      const on = this.start(note, event, loopTicks);
      if (heldEarlier > 0) on.slide = true;
      events.push(on);
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

  /**
   * The note-on of `note` on the event's local tick, held to the loop's end
   * at most, with its accent and its ratchet's roll over that hold.
   */
  private start(note: RollNote, event: PartTickEvent, loopTicks: number): NoteOnEvent {
    const { tick, time, secondsPerTick } = event;
    const held = Math.min(note.ticks, loopTicks - note.tick);
    // A loop cut can leave a ratcheted note shorter than any ratchet plays on: it plays one hit.
    const hits = held >= ROLL_RATCHET_MIN_TICKS ? (note.ratchet ?? 1) : 1;
    this.releaseAt[note.pitch] = tick + held;
    this.heldOnset[note.pitch] = note.tick;
    this.heldSince[note.pitch] = tick;
    this.heldRolled[note.pitch] = hits > 1 ? 1 : 0;
    this.heldCount++;
    const on: NoteOnEvent = { kind: 'noteOn', tick, time, note: note.pitch, degree: 0 };
    if (note.velocity !== undefined && note.velocity !== 1) on.velocity = note.velocity;
    if (note.accent === true) on.accent = this.accent();
    // As a Grid step's: every hit but the last runs to the next, and the last is held open.
    if (hits > 1) on.roll = { hits, ticks: held, secondsPerTick, gate: 1, open: true };
    return on;
  }

  /** The roll's accent amounts, the Grid's defaults where absent. */
  private accent(): { velocity: number; mod: number } {
    const { accentVelocity, accentMod } = this.current;
    return {
      velocity: accentVelocity ?? ACCENT_VELOCITY_DEFAULT,
      mod: accentMod ?? ACCENT_MOD_DEFAULT,
    };
  }
}
