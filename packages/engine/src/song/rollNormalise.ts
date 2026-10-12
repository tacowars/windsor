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
 *
 * **Accents and ratchets** (windsor#753, record
 * `2026-10-12-roll-note-accent-and-ratchet`). A note's `accent` is a
 * boolean and its `ratchet` a whole number 1..`RATCHET_MAX`; anything else
 * is dropped, reported, and the note is plain. `accent: false` and
 * `ratchet: 1` leave no key. Once the list is settled, every note sharing
 * its onset with another (a chord) loses both, and a note shorter than
 * `ROLL_RATCHET_MIN_TICKS` (after any trim) loses its ratchet, each
 * reported. The roll's `accentVelocity` and `accentMod` are clamped into
 * 0..1, and a default (`ACCENT_VELOCITY_DEFAULT`, `ACCENT_MOD_DEFAULT`)
 * leaves no key, so a roll without them round-trips byte for byte.
 *
 * **Envelopes** (windsor#701, epic windsor#699). An envelope whose target is
 * not a voice target, one on a target an earlier envelope holds, and those
 * past `ROLL_ENVELOPES_MAX` are dropped; a missing `on` is true. A point
 * whose tick or value is not a finite number, or whose bend is present and
 * not one, is dropped. The tick is clamped into 0..`ROLL_LOOP_TICKS_MAX` − 1,
 * the value and the bend into −1..1 (a missing bend is 0). The points are
 * then sorted by tick; of two on one tick the later in the list is kept,
 * since it is the value the tick reads on a song lane's step; and those past
 * `ROLL_ENVELOPE_POINTS_MAX` are trimmed. An envelope left with no points is
 * kept: it reads 0. Each change is reported but the sort, and an empty list
 * leaves no key, as a velocity of 1 does. A point at or past `loopTicks` is
 * kept, silent like a note there.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  MIDI_MIDDLE_C,
  MIDI_NOTE_MAX,
  RATCHET_MAX,
  ROLL_NOTES_MAX,
} from '../audioConstants';
import { ticksPerBar } from '../sequencing/meter';
import {
  ROLL_ENVELOPES_MAX,
  type RollEnvelope,
  type RollEnvelopePoint,
} from '../sequencing/rollEnvelope';
import { ROLL_ENVELOPE_POINTS_MAX } from '../sequencing/rollEnvelopeTables';
import { ROLL_RATCHET_MIN_TICKS } from '../sequencing/rollNoteTables';
import { ROLL_LOOP_TICKS_MAX, rollSharedOnsets, type RollNote } from '../sequencing/rollSequencer';
import { isVoiceTargetPath } from '../sequencing/stepModLanes';
import type { VoiceTargetPath } from '../worklet/fm/voiceTargetTables';
import { DIVISORS } from '../sequencing/scheduler';
import type { RollDriver } from './arrangement';
import { isRecord, show, type FieldNormaliser } from './arrangementFields';

const ROLL_KEYS = ['loopTicks', 'notes', 'accentVelocity', 'accentMod', 'envelopes'];
const NOTE_KEYS = ['tick', 'ticks', 'pitch', 'velocity', 'accent', 'ratchet'];
const ENVELOPE_KEYS = ['target', 'on', 'points'];
const POINT_KEYS = ['tick', 'value', 'bend'];

/** A written note's mutable shape while the list is settled. */
type DraftNote = { -readonly [K in keyof RollNote]: RollNote[K] };

export function rollDriver(raw: unknown, path: string, n: FieldNormaliser): RollDriver {
  const o = n.section(raw, path);
  n.dropUnknown(o, ROLL_KEYS, path);
  const at = `${path}.loopTicks`;
  const driver: RollDriver = {
    loopTicks: n.int(o.loopTicks, ticksPerBar(n.meter), 1, ROLL_LOOP_TICKS_MAX, at),
    notes: rollNotes(o.notes, `${path}.notes`, n),
  };
  const accentVelocity = n.num(
    o.accentVelocity,
    ACCENT_VELOCITY_DEFAULT,
    0,
    1,
    `${path}.accentVelocity`,
  );
  if (accentVelocity !== ACCENT_VELOCITY_DEFAULT) driver.accentVelocity = accentVelocity;
  const accentMod = n.num(o.accentMod, ACCENT_MOD_DEFAULT, 0, 1, `${path}.accentMod`);
  if (accentMod !== ACCENT_MOD_DEFAULT) driver.accentMod = accentMod;
  const envelopes = rollEnvelopes(o.envelopes, `${path}.envelopes`, n);
  if (envelopes.length > 0) driver.envelopes = envelopes;
  return driver;
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
  return withMarksSettled(settled.slice(0, ROLL_NOTES_MAX), path, n);
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
  if (noteAccent(raw.accent, `${path}.accent`, n)) note.accent = true;
  const ratchet = noteRatchet(raw.ratchet, `${path}.ratchet`, n);
  if (ratchet > 1) note.ratchet = ratchet;
  return note;
}

/** A note's accent: a boolean; anything else is dropped, reported, and the note is plain. */
function noteAccent(raw: unknown, path: string, n: FieldNormaliser): boolean {
  if (raw === undefined || typeof raw === 'boolean') return raw === true;
  n.correction(`${path}: ${show(raw)} is not a boolean — dropped`);
  return false;
}

/** A note's ratchet: a whole 1..`RATCHET_MAX`; anything else is dropped, reported, and the note is one hit. */
function noteRatchet(raw: unknown, path: string, n: FieldNormaliser): number {
  if (raw === undefined) return 1;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= RATCHET_MAX) {
    return raw;
  }
  n.correction(`${path}: ${show(raw)} is not a whole number 1..${RATCHET_MAX} — dropped`);
  return 1;
}

/**
 * The settled notes with the marks they may not carry cleared, each
 * reported: both from a note that shares its onset (the record's decision
 * 5), and the ratchet from one shorter than `ROLL_RATCHET_MIN_TICKS`
 * (decision 6).
 */
function withMarksSettled(notes: DraftNote[], path: string, n: FieldNormaliser): DraftNote[] {
  const shared = rollSharedOnsets(notes);
  for (const note of notes) {
    const where = `${path}: the note at tick ${note.tick} pitch ${note.pitch}`;
    if (shared.has(note.tick) && (note.accent !== undefined || note.ratchet !== undefined)) {
      delete note.accent;
      delete note.ratchet;
      n.correction(`${where} shares its onset with another — its accent and ratchet cleared`);
    }
    if (note.ratchet !== undefined && note.ticks < ROLL_RATCHET_MIN_TICKS) {
      delete note.ratchet;
      n.correction(
        `${where} is shorter than ${ROLL_RATCHET_MIN_TICKS} ticks — its ratchet cleared`,
      );
    }
  }
  return notes;
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

/** The envelopes: each read, with a junk or repeated target and those past the cap dropped. */
function rollEnvelopes(raw: unknown, path: string, n: FieldNormaliser): RollEnvelope[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of envelopes — no envelopes`);
    return [];
  }
  const envelopes: RollEnvelope[] = [];
  const seen = new Set<VoiceTargetPath>();
  raw.forEach((item, i) => {
    const at = `${path}[${i}]`;
    const drop = (why: string): void => n.correction(`${at}: ${why} — envelope dropped`);
    if (!isRecord(item)) return drop(`${show(item)} is not an envelope`);
    n.dropUnknown(item, ENVELOPE_KEYS, at);
    const { target } = item;
    if (!isVoiceTargetPath(target)) return drop(`${show(target)} is not a voice target`);
    if (seen.has(target)) return drop(`${target} already has an envelope`);
    if (envelopes.length >= ROLL_ENVELOPES_MAX) {
      return drop(`more than ${ROLL_ENVELOPES_MAX} envelopes`);
    }
    seen.add(target);
    const on = n.bool(item.on, true, `${at}.on`);
    envelopes.push({ target, on, points: envelopePoints(item.points, `${at}.points`, n) });
  });
  return envelopes;
}

/** An envelope's points: read, sorted, one to a tick (the later kept), and capped. */
function envelopePoints(raw: unknown, path: string, n: FieldNormaliser): RollEnvelopePoint[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of points — no points`);
    return [];
  }
  const read: RollEnvelopePoint[] = [];
  raw.forEach((item, i) => {
    const point = envelopePoint(item, `${path}[${i}]`, n);
    if (point) read.push(point);
  });
  // `sort` is stable: of two points on one tick, the later written stays the later.
  read.sort((a, b) => a.tick - b.tick);
  const single = read.filter((point, i) => read[i + 1]?.tick !== point.tick);
  if (single.length < read.length) {
    n.correction(
      `${path}: ${read.length - single.length} points shared a tick — the earlier dropped`,
    );
  }
  if (single.length > ROLL_ENVELOPE_POINTS_MAX) {
    n.correction(`${path}: ${single.length} points trimmed to ${ROLL_ENVELOPE_POINTS_MAX}`);
  }
  return single.slice(0, ROLL_ENVELOPE_POINTS_MAX);
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** One point, clamped, or null (reported) when a field is not a finite number. */
function envelopePoint(raw: unknown, path: string, n: FieldNormaliser): RollEnvelopePoint | null {
  const o = isRecord(raw) ? raw : {};
  if (!finite(o.tick) || !finite(o.value) || (o.bend !== undefined && !finite(o.bend))) {
    n.correction(`${path}: ${show(raw)} is not a point — dropped`);
    return null;
  }
  n.dropUnknown(o, POINT_KEYS, path);
  return {
    tick: n.num(o.tick, 0, 0, ROLL_LOOP_TICKS_MAX - 1, `${path}.tick`),
    value: n.num(o.value, 0, -1, 1, `${path}.value`),
    bend: n.num(o.bend, 0, -1, 1, `${path}.bend`),
  };
}
