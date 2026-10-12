/**
 * A Roll note's accent and ratchet as the roll draws and edits them
 * (windsor#754; record `2026-10-12-roll-note-accent-and-ratchet` decisions
 * 5 to 8), without the DOM: which notes may carry them, the Acc and Rat
 * cells' place under a drawn note, the click's next state and the write it
 * makes, and where a ratcheted note's hits are cut.
 *
 * The rules are the engine's, read rather than restated: the chord onsets
 * are `rollSharedOnsets`, the shortest ratchet `ROLL_RATCHET_MIN_TICKS`, the
 * most hits `RATCHET_MAX`, and a write goes through `withRollNoteAccent` /
 * `withRollNoteRatchet`, so a plain note is written as the normaliser keeps
 * it.
 */
import type { RollNote, RollSequencerConfig } from '@windsor/engine';
import {
  RATCHET_MAX,
  ROLL_RATCHET_MIN_TICKS,
  rollSharedOnsets,
  withRollNoteAccent,
  withRollNoteRatchet,
} from '@windsor/engine';
import type { RollEdit } from './rollEdits';
import type { RollInstance } from './rollRepeats';
import { ROLL_MARK_CELL } from './rollTables';

/** What the lane under the notes shows (decision 7): the stems, the accents or the ratchets. */
export type RollLane = 'vel' | 'acc' | 'rat';

/** The two lanes a click edits. */
export type MarkLane = Exclude<RollLane, 'vel'>;

/** A note's hits: its ratchet, absent being one. */
export const ratchetOf = (note: RollNote): number => note.ratchet ?? 1;

/** Whether a note may carry an accent: it starts alone, not in a chord (decision 5). */
export const canAccent = (note: RollNote, shared: ReadonlySet<number>): boolean =>
  !shared.has(note.tick);

/** Whether a note may carry a ratchet: alone, and at least a 1/32 long (decisions 5 and 6). */
export const canRatchet = (
  note: RollNote,
  shared: ReadonlySet<number>,
  minTicks = ROLL_RATCHET_MIN_TICKS,
): boolean => canAccent(note, shared) && note.ticks >= minTicks;

/** Whether `note` may take what `lane` sets. */
export const canTake = (lane: MarkLane, note: RollNote, shared: ReadonlySet<number>): boolean =>
  lane === 'acc' ? canAccent(note, shared) : canRatchet(note, shared);

/** One step of a Rat click: ×1 → ×2 … → ×`max` → ×1, or back with Shift. */
export function nextRatchet(ratchet: number, back: boolean, max = RATCHET_MAX): number {
  const at = Math.max(1, Math.min(max, Math.round(ratchet)));
  if (back) return at <= 1 ? max : at - 1;
  return at >= max ? 1 : at + 1;
}

/** The note set to `lane`'s `value`: an accent on or off, or a number of hits. */
const withMark = (note: RollNote, lane: MarkLane, value: number | boolean): RollNote =>
  lane === 'acc'
    ? withRollNoteAccent(note, value === true)
    : withRollNoteRatchet(note, Number(value));

/** A click on a cell: its lane, the note it is under, and whether Shift was held. */
export interface MarkClick {
  readonly lane: MarkLane;
  readonly index: number;
  readonly back: boolean;
}

/**
 * The write a click on note `click.index`'s cell makes (decision 6): the
 * clicked note's next state, given to every selected note that can take it
 * when the clicked one is selected, else to it alone; a chord's notes and,
 * for a ratchet, a note under a 1/32 are left as they are. Null when the
 * clicked note cannot take it, or nothing changes. The selection is kept.
 */
export function markClick(
  config: RollSequencerConfig,
  selected: readonly number[],
  click: MarkClick,
): RollEdit | null {
  const clicked = config.notes[click.index];
  const shared = rollSharedOnsets(config.notes);
  if (!clicked || !canTake(click.lane, clicked, shared)) return null;
  const value =
    click.lane === 'acc' ? clicked.accent !== true : nextRatchet(ratchetOf(clicked), click.back);
  const targets = new Set(selected.includes(click.index) ? selected : [click.index]);
  let changed = false;
  const notes = config.notes.map((note, i) => {
    if (!targets.has(i) || !canTake(click.lane, note, shared)) return note;
    const next = withMark(note, click.lane, value);
    if (next.accent !== note.accent || next.ratchet !== note.ratchet) changed = true;
    return next;
  });
  return changed ? { config: { ...config, notes }, selected } : null;
}

/** How a cell under a note is drawn: hidden (a chord's note, a parked one, a run), disabled, or live. */
export type CellState = 'none' | 'disabled' | 'live';

/** Whether `instance` is a band of repeats drawn as one (`rollInstances`' runs), not one note. */
export const isRun = (note: RollNote, instance: RollInstance): boolean =>
  instance.pass > 0 && instance.ticks > note.ticks;

/** What the `lane` cell under `instance` of `note` is. */
export function cellState(
  lane: MarkLane,
  note: RollNote,
  instance: RollInstance,
  shared: ReadonlySet<number>,
): CellState {
  if (instance.parked || isRun(note, instance) || !canAccent(note, shared)) return 'none';
  if (lane === 'rat' && !canRatchet(note, shared)) return 'disabled';
  return 'live';
}

/** A cell's place in the lane, in px. */
export interface CellBox {
  readonly left: number;
  readonly width: number;
}

/**
 * Where the `lane` cell under a note drawn from `leftPx`, `widthPx` wide
 * goes: inset by a px; an Acc cell a square under the onset, never wider
 * than the note leaves; a Rat cell the note's width, never under its least.
 */
export function cellBox(
  lane: MarkLane,
  note: { readonly leftPx: number; readonly widthPx: number },
  table = ROLL_MARK_CELL,
): CellBox {
  const left = note.leftPx + table.insetPx;
  const room = note.widthPx - 2 * table.insetPx;
  if (lane === 'acc') {
    return { left, width: Math.max(table.accMinPx, Math.min(table.accMaxPx, room)) };
  }
  return { left, width: Math.max(table.ratMinPx, room) };
}

/** A drawn note's marks: the accent's top edge and the hits' cuts, in ticks from its drawn onset. */
export interface NoteMarks {
  readonly accent: boolean;
  readonly cuts: readonly number[];
}

const NO_MARKS: NoteMarks = { accent: false, cuts: [] };

/**
 * The marks `instance` of `note` carries (decision 8): none on a chord's
 * note, which plays plain, or on a run. A ratchet's cuts split the span it
 * plays over, the note cut at the loop's end (or its own length when
 * parked), evenly, as the engine spaces its hits; a span under a 1/32
 * plays one hit, so it is not cut. Cuts past the drawn length are dropped.
 */
export function noteMarks(
  note: RollNote,
  instance: RollInstance,
  at: { readonly loopTicks: number; readonly shared: ReadonlySet<number> },
): NoteMarks {
  if (!canAccent(note, at.shared) || isRun(note, instance)) return NO_MARKS;
  const accent = note.accent === true;
  const hits = ratchetOf(note);
  const span = instance.parked ? note.ticks : Math.min(note.ticks, at.loopTicks - note.tick);
  if (hits <= 1 || span < ROLL_RATCHET_MIN_TICKS) return { accent, cuts: [] };
  const cuts: number[] = [];
  for (let k = 1; k < hits; k++) {
    const cut = (k * span) / hits;
    if (cut < instance.ticks) cuts.push(cut);
  }
  return { accent, cuts };
}
