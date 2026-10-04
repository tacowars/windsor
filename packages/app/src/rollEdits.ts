/**
 * The Roll's edits (windsor#603 decision 7), without the DOM: add, move,
 * resize, delete, box-select, velocity and the loop. Each takes the roll's
 * config and returns the next; the pointer handlers only translate
 * positions into the ticks and rows these take.
 *
 * A selection is the indices of its notes in the config's list. A move or a
 * resize keeps every note at its index, so a drag recomputes from the
 * config it started on at each pointer move; `settle` then sorts the list
 * as the normaliser keeps it and carries the selection through, once, on
 * release.
 *
 * The loop the notes are kept inside is the loop as drawn, never past the
 * region (`RollFrame.loop`); the config's own `loopTicks` changes only
 * through `setLoop`.
 */
import type { RollNote, RollSequencerConfig } from '@windsor/engine';
import { ROLL_LOOP_TICKS_MAX, ROLL_NOTES_MAX } from '@windsor/engine';
import { ROLL_EDIT } from './rollTables';

/** A config and the selection in it, by index. */
export interface RollEdit {
  readonly config: RollSequencerConfig;
  readonly selected: readonly number[];
}

/** Where an edit happens: the loop as drawn, the region's length and the snap, in ticks. */
export interface RollFrame {
  readonly loop: number;
  readonly region: number;
  readonly snap: number;
}

/** `ticks` in whole snaps, rounded. */
const wholeSnaps = (ticks: number, snap: number): number => Math.round(ticks / snap) * snap;

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

const withNotes = (
  config: RollSequencerConfig,
  notes: readonly RollNote[],
): RollSequencerConfig => ({
  ...config,
  notes,
});

/** Where a note is added: the press's tick and row's pitch, and the last length used. */
export interface AddAt {
  readonly tick: number;
  readonly pitch: number;
  readonly lastTicks: number;
}

/**
 * A note at `at`'s pitch, its onset floored to the snap, `lastTicks` long
 * and cut to the loop's end, selected alone; null at or past the loop, and
 * null when the roll already holds `ROLL_NOTES_MAX` notes: the normaliser
 * keeps only that many, so a note past the cap would cost another.
 */
export function addNote(
  config: RollSequencerConfig,
  at: AddAt,
  frame: RollFrame,
  velocity: number = ROLL_EDIT.addVelocity,
): RollEdit | null {
  if (config.notes.length >= ROLL_NOTES_MAX) return null;
  const tick = Math.floor(at.tick / frame.snap) * frame.snap;
  if (tick < 0 || tick >= frame.loop) return null;
  const ticks = Math.max(1, Math.min(at.lastTicks, frame.loop - tick));
  const notes = [...config.notes, { tick, ticks, pitch: at.pitch, velocity }];
  return { config: withNotes(config, notes), selected: [notes.length - 1] };
}

/** The pitches of the rows on show, top down, which a move steps through. */
export type RowPitches = readonly number[];

/**
 * The time delta, in whole snaps, clamped for the whole selection as one
 * block: none starts before 0, and none starts so late that less than a
 * snap of it (or of itself, if shorter) is left in the loop. A note past the
 * loop pulls the block in on any move in time, so it comes inside with the
 * spacing kept; a pitch-only drag (no whole snap) moves nothing in time.
 * When the block is longer than the loop, it stops with its first note at 0
 * and the rest past the loop, parked: a move never stacks two notes.
 */
function blockTicks(picked: readonly RollNote[], dTicks: number, frame: RollFrame): number {
  const d = wholeSnaps(dTicks, frame.snap);
  if (picked.length === 0 || d === 0) return d;
  const latest = (note: RollNote): number =>
    frame.loop - Math.min(note.ticks, frame.snap) - note.tick;
  const lo = Math.max(...picked.map((note) => -note.tick));
  // A note inside already in the loop's last part-snap holds the block still, not back.
  const hi = Math.min(
    ...picked.map((note) => (note.tick < frame.loop ? Math.max(0, latest(note)) : latest(note))),
  );
  // A block longer than the loop has lo > hi, and the clamp's floor wins: its first note at 0.
  return clamp(d, lo, hi);
}

/** The row delta, clamped so every row the selection is on stays on the rows. */
function blockRows(rowsAt: readonly number[], dRows: number, rowCount: number): number {
  if (rowsAt.length === 0) return 0;
  return clamp(dRows, -Math.min(...rowsAt), rowCount - 1 - Math.max(...rowsAt));
}

/** One note moved by the block's deltas: cut at the loop's end if it lands inside, whole if still past it. */
function movedNote(note: RollNote, dTicks: number, pitch: number, loop: number): RollNote {
  const tick = note.tick + dTicks;
  const ticks = tick < loop ? Math.min(note.ticks, loop - tick) : note.ticks;
  return { ...note, tick, ticks, pitch };
}

/**
 * The selection moved as one block: `dTicks` in whole snaps and `dRows`
 * rows down `rows` (so Fold and Scale step through the rows on show), both
 * clamped so no note leaves the loop or the rows and a chord keeps its
 * shape. A note inside the loop is cut at the loop's end; a note past the
 * loop comes inside on a move in time and stays parked on a pitch-only one.
 */
export function moveNotes(
  config: RollSequencerConfig,
  selected: readonly number[],
  by: { readonly dTicks: number; readonly dRows: number },
  frame: RollFrame & { readonly rows: RowPitches },
): RollEdit {
  const chosen = new Set(selected);
  const picked = config.notes.filter((_, i) => chosen.has(i));
  const dTicks = blockTicks(picked, by.dTicks, frame);
  const rowsAt = picked.map((note) => frame.rows.indexOf(note.pitch)).filter((i) => i >= 0);
  const dRows = blockRows(rowsAt, by.dRows, frame.rows.length);
  const notes = config.notes.map((note, i) => {
    if (!chosen.has(i)) return note;
    const row = frame.rows.indexOf(note.pitch);
    const pitch = row < 0 ? note.pitch : (frame.rows[row + dRows] ?? note.pitch);
    return movedNote(note, dTicks, pitch, frame.loop);
  });
  return { config: withNotes(config, notes), selected };
}

/**
 * The selection resized by `dTicks` in whole snaps: each note at least one
 * snap long, and at most to the loop's end, or for a note past the loop to
 * the region's end. Returns the edit and `anchor`'s new length, the next
 * note's length.
 */
export function resizeNotes(
  config: RollSequencerConfig,
  selected: readonly number[],
  dTicks: number,
  frame: RollFrame & { readonly anchor: number },
): { edit: RollEdit; lastTicks: number | null } {
  const d = wholeSnaps(dTicks, frame.snap);
  const chosen = new Set(selected);
  const notes = config.notes.map((note, i) => {
    if (!chosen.has(i)) return note;
    const end = note.tick < frame.loop ? frame.loop : Math.max(frame.region, frame.loop);
    const most = Math.min(end, ROLL_LOOP_TICKS_MAX) - note.tick;
    const ticks = Math.max(1, Math.min(most, Math.max(frame.snap, note.ticks + d)));
    return { ...note, ticks };
  });
  const lastTicks = notes[frame.anchor]?.ticks ?? null;
  return { edit: { config: withNotes(config, notes), selected }, lastTicks };
}

/** The notes at `remove` deleted; the rest of `selected` kept, at their new indices. */
export function deleteNotes(
  config: RollSequencerConfig,
  remove: readonly number[],
  selected: readonly number[] = [],
): RollEdit {
  const gone = new Set(remove);
  const next: number[] = [];
  config.notes.forEach((_, i) => {
    if (!gone.has(i)) next.push(i);
  });
  const kept = new Set(selected);
  return {
    config: withNotes(
      config,
      next.map((i) => config.notes[i] as RollNote),
    ),
    selected: next.flatMap((old, i) => (kept.has(old) && !gone.has(old) ? [i] : [])),
  };
}

/** A box on the roll: the ticks it spans and the pitches of the rows it touches. */
export interface RollBox {
  readonly from: number;
  readonly to: number;
  readonly pitches: ReadonlySet<number>;
}

/** The indices of the notes a box touches. */
export function boxSelect(notes: readonly RollNote[], box: RollBox): number[] {
  const out: number[] = [];
  notes.forEach((note, i) => {
    if (box.pitches.has(note.pitch) && note.tick < box.to && note.tick + note.ticks > box.from) {
      out.push(i);
    }
  });
  return out;
}

/** A velocity as a stem drag sets it: 0.05..1 in steps of 0.01. */
export const stemVelocity = (value: number, table = ROLL_EDIT): number =>
  Math.round(clamp(value, table.velocityMin, table.velocityMax) * table.velocitySteps) /
  table.velocitySteps;

/** The notes at `indices` set to `value` (`stemVelocity`); a velocity of 1 leaves no key, as the normaliser writes it. */
export function setVelocity(
  config: RollSequencerConfig,
  indices: readonly number[],
  value: number,
): RollSequencerConfig {
  const velocity = stemVelocity(value);
  const chosen = new Set(indices);
  return withNotes(
    config,
    config.notes.map((note, i) => {
      if (!chosen.has(i)) return note;
      const { tick, ticks, pitch } = note;
      return velocity === 1 ? { tick, ticks, pitch } : { tick, ticks, pitch, velocity };
    }),
  );
}

/**
 * The loops a region allows: whole bars from one bar up to the region's
 * length, and the region's own length when it is not a whole number of
 * bars (a region shorter than a bar loops its own length).
 */
export function loopStops(regionTicks: number, barTicks: number): number[] {
  const region = Math.min(regionTicks, ROLL_LOOP_TICKS_MAX);
  if (region <= barTicks) return [Math.max(1, region)];
  const stops: number[] = [];
  for (let ticks = barTicks; ticks <= region; ticks += barTicks) stops.push(ticks);
  if (stops.at(-1) !== region) stops.push(region);
  return stops;
}

/**
 * One − (−1) or + (+1) of the Loop stepper from the loop as drawn: the next
 * stop down or up. − never lengthens and + never shortens, so with no stop
 * that way (a loop under the first stop, or at the last) it stays.
 */
export function loopStep(loop: number, dir: number, stops: readonly number[]): number {
  if (dir > 0) return stops.find((ticks) => ticks > loop) ?? loop;
  return [...stops].reverse().find((ticks) => ticks < loop) ?? loop;
}

/** The stop nearest `ticks`: where a drag of the brace's end lands. */
export function nearestLoop(ticks: number, stops: readonly number[]): number {
  let best = stops[0] ?? ticks;
  for (const stop of stops) if (Math.abs(stop - ticks) < Math.abs(best - ticks)) best = stop;
  return best;
}

/** The loop set to `loopTicks`; the notes past it are kept, parked and silent. */
export const setLoop = (config: RollSequencerConfig, loopTicks: number): RollSequencerConfig => ({
  ...config,
  loopTicks,
});

/**
 * One − or + of the Loop stepper on `config`, from the loop as drawn
 * (`at.loop`, never past the region): the next config, or null when the
 * step writes nothing. It is judged against the stored `loopTicks` too, so
 * + never writes a loop shorter than the stored one (a four-bar loop shown
 * as two in a two-bar region) and − never a longer one.
 */
export function stepLoop(
  config: RollSequencerConfig,
  dir: number,
  at: { readonly loop: number; readonly stops: readonly number[] },
): RollSequencerConfig | null {
  const next = loopStep(at.loop, dir, at.stops);
  if (next === at.loop) return null;
  const moves = dir > 0 ? next > config.loopTicks : next < config.loopTicks;
  return moves ? setLoop(config, next) : null;
}

/** Same onset, same pitch: the order the normaliser keeps. */
const byOnset = (a: RollNote, b: RollNote): number => a.tick - b.tick || a.pitch - b.pitch;

/**
 * The list as the normaliser keeps it, so the write changes nothing and the
 * selection survives it: sorted by onset then pitch; of two notes at one
 * onset and pitch, the selected (else the first) kept; and a note running
 * into the next onset at its pitch trimmed to end there.
 */
export function settle(edit: RollEdit): RollEdit {
  const chosen = new Set(edit.selected);
  const order = edit.config.notes
    .map((note, i) => ({ note, selected: chosen.has(i) }))
    .sort((a, b) => byOnset(a.note, b.note) || Number(b.selected) - Number(a.selected));
  const kept: { note: RollNote; selected: boolean }[] = [];
  const lastAt = new Map<number, { note: RollNote; selected: boolean }>();
  for (const item of order) {
    const prev = lastAt.get(item.note.pitch);
    if (prev && prev.note.tick === item.note.tick) continue;
    if (prev && prev.note.tick + prev.note.ticks > item.note.tick) {
      prev.note = { ...prev.note, ticks: item.note.tick - prev.note.tick };
    }
    const entry = { ...item };
    lastAt.set(item.note.pitch, entry);
    kept.push(entry);
  }
  return {
    config: withNotes(
      edit.config,
      kept.map((item) => item.note),
    ),
    selected: kept.flatMap((item, i) => (item.selected ? [i] : [])),
  };
}
