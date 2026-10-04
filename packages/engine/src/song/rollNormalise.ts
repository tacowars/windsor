/**
 * The Roll's sequencer fields, normalised (windsor#599, record
 * `2026-10-04-roll-sequencer`): the `roll` branch of `normaliseSequencer`,
 * built from the field vocabulary (`arrangementFields.ts`). Everything
 * returned satisfies `assertRollConfig` by construction.
 *
 * Each number is clamped into its range and a non-integer tick, length or
 * pitch rounded; an unknown key and a note that is not an object are
 * dropped. The notes are then sorted by `tick`, then `pitch`, silently; an
 * exact duplicate (same `tick` and `pitch`) is dropped, keeping the first;
 * a note running into the next onset at its own pitch is trimmed to end
 * there; and the notes past `ROLL_NOTES_MAX` are trimmed. Each change is
 * reported except the sort, and a `velocity` of 1 leaves no key, so an
 * export carries no default. A note at or past `loopTicks` is kept: it is
 * silent until the loop grows back over it.
 */
import { MIDI_MIDDLE_C, MIDI_NOTE_MAX, ROLL_NOTES_MAX } from '../audioConstants';
import { ticksPerBar } from '../sequencing/meter';
import { ROLL_LOOP_TICKS_MAX, type RollNote } from '../sequencing/rollSequencer';
import { DIVISORS } from '../sequencing/scheduler';
import type { RollDriver } from './arrangement';
import { isRecord, show, type FieldNormaliser } from './arrangementFields';

const ROLL_KEYS = ['loopTicks', 'notes'];
const NOTE_KEYS = ['tick', 'ticks', 'pitch', 'velocity'];

/** A written note's mutable shape while the list is settled. */
type DraftNote = { tick: number; ticks: number; pitch: number; velocity?: number };

export function rollDriver(raw: unknown, path: string, n: FieldNormaliser): RollDriver {
  const o = n.section(raw, path);
  n.dropUnknown(o, ROLL_KEYS, path);
  const at = `${path}.loopTicks`;
  return {
    loopTicks: n.int(o.loopTicks, ticksPerBar(n.meter), 1, ROLL_LOOP_TICKS_MAX, at),
    notes: rollNotes(o.notes, `${path}.notes`, n),
  };
}

/** The list: each note read, then sorted, de-duplicated, de-overlapped and capped. */
function rollNotes(raw: unknown, path: string, n: FieldNormaliser): RollNote[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of notes — no notes`);
    return [];
  }
  const read: DraftNote[] = [];
  raw.forEach((item, i) => {
    const note = rollNote(item, `${path}[${i}]`, n);
    if (note) read.push(note);
  });
  read.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const settled = withoutOverlaps(read, path, n);
  if (settled.length > ROLL_NOTES_MAX) {
    n.correction(`${path}: ${settled.length} notes trimmed to ${ROLL_NOTES_MAX}`);
  }
  return settled.slice(0, ROLL_NOTES_MAX);
}

/** One note, or null (reported) when it is not an object. */
function rollNote(raw: unknown, path: string, n: FieldNormaliser): DraftNote | null {
  if (!isRecord(raw)) {
    n.correction(`${path}: ${show(raw)} is not a note — dropped`);
    return null;
  }
  n.dropUnknown(raw, NOTE_KEYS, path);
  const note: DraftNote = {
    tick: required(raw, 'tick', path, n),
    ticks: required(raw, 'ticks', path, n),
    pitch: required(raw, 'pitch', path, n),
  };
  const velocity = n.num(raw.velocity, 1, 0, 1, `${path}.velocity`);
  if (velocity !== 1) note.velocity = velocity;
  return note;
}

interface NoteField {
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

/** A note's whole-number fields: what one missing takes (an onset at 0, a sixteenth, middle C), and its range. */
const NOTE_FIELDS: Readonly<Record<'tick' | 'ticks' | 'pitch', NoteField>> = {
  tick: { fallback: 0, min: 0, max: ROLL_LOOP_TICKS_MAX - 1 },
  ticks: { fallback: DIVISORS.sixteenth, min: 1, max: ROLL_LOOP_TICKS_MAX },
  pitch: { fallback: MIDI_MIDDLE_C, min: 0, max: MIDI_NOTE_MAX },
};

/** A whole number in its range. A note has no default onset, length or pitch, so one missing is reported. */
function required(
  raw: Record<string, unknown>,
  key: keyof typeof NOTE_FIELDS,
  path: string,
  n: FieldNormaliser,
): number {
  const { fallback, min, max } = NOTE_FIELDS[key];
  const at = `${path}.${key}`;
  if (raw[key] === undefined) n.correction(`${at}: missing — using ${fallback}`);
  return n.int(raw[key], fallback, min, max, at);
}

/**
 * The sorted notes with each exact duplicate dropped (the first kept) and
 * each note that runs into the next onset at its pitch trimmed to end there,
 * each reported.
 */
function withoutOverlaps(sorted: DraftNote[], path: string, n: FieldNormaliser): DraftNote[] {
  const out: DraftNote[] = [];
  const lastAt = new Map<number, DraftNote>();
  for (const note of sorted) {
    const prev = lastAt.get(note.pitch);
    const where = `tick ${note.tick} pitch ${note.pitch}`;
    if (prev && prev.tick === note.tick) {
      n.correction(`${path}: a second note at ${where} — dropped`);
      continue;
    }
    if (prev && prev.tick + prev.ticks > note.tick) {
      prev.ticks = note.tick - prev.tick;
      n.correction(
        `${path}: the note at tick ${prev.tick} pitch ${note.pitch} runs into the next — trimmed to ${prev.ticks} ticks`,
      );
    }
    lastAt.set(note.pitch, note);
    out.push(note);
  }
  return out;
}
