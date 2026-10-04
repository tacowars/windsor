/**
 * The Roll's config (windsor#599, epic windsor#596; record
 * `2026-10-04-roll-sequencer`): a piano roll's notes over a loop. A note is
 * an absolute MIDI pitch with a free onset, length and velocity, in the
 * region's local ticks (24 PPQ); a key or chord change never moves it.
 *
 * The loop is `loopTicks`, at most the region's length once the console
 * draws it (windsor#601). A note whose `tick` is at or past the loop is
 * kept and silent until the loop grows back over it, so shrinking the loop
 * loses nothing. A note's `velocity` scales the part's velocity as a Figure
 * cell's does (`partNoteOn`); absent is 1.
 *
 * This file is the field set, its defaults and the check a performer and a
 * live edit will run (windsor#600); the normaliser is `song/rollNormalise.ts`,
 * which also keeps the notes sorted and free of same-pitch overlaps. Nothing
 * performs a Roll yet: the player builds no generator for it.
 */
import { BARS_MAX, MIDI_NOTE_MAX, ROLL_NOTES_MAX } from '../audioConstants';
import { ticksPerBar } from './meter';
import type { Meter } from './meterTables';
import { TICKS_PER_BAR } from './scheduler';

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
