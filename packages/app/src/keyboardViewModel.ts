/**
 * The expanded keyboard view's rules (windsor#864, record
 * `2026-10-17-the-keyboard-on-a-tablet` decision 8), pure over the room the
 * view's keys box leaves: which Octaves and Rows picks a room allows and why
 * not, the rows an Octaves tap takes, the pick the view draws, a pick's white
 * key and row sizes, and the octave bound for the octaves shown.
 *
 * A pick is allowed when its white key is at least the touch minimum, and
 * two rows split the octaves evenly. One octave in one row is always
 * allowed: the minimum decides which larger picks are offered, never whether
 * one octave can show, so below 7 × the minimum its keys share the room.
 *
 * Folded (record `2026-10-18-keyboard-fold` decision 4), a row's slots stand
 * in for its white keys: every rule takes the row's `RowSlots`, white keys
 * by default.
 */
import { MIDI_NOTE_MAX, SEMITONES_PER_OCTAVE } from '@windsor/engine';
import {
  OCTAVE_MAX,
  VIEW_HINTS,
  VIEW_ROW_GAP_PX,
  VIEW_ROWS,
  WHITE_KEY_MIN_PX,
} from './keyboardConstants';
import type { KeysPick } from './keyboardConstants';
import { type RowSlots, whiteSlots } from './keyboardLayout';

/** One octave in one row: what every room shows. */
const SMALLEST: KeysPick = { octaves: 1, rows: 1 };

const isSmallest = (pick: KeysPick): boolean =>
  pick.octaves === SMALLEST.octaves && pick.rows === SMALLEST.rows;

/** A pick's white key width in a room `roomWidth` px wide: the room over the white keys (slots) a row holds. */
export const whiteKeyPx = (
  roomWidth: number,
  pick: KeysPick,
  slots: RowSlots = whiteSlots,
): number => roomWidth / slots(pick);

/** A row's height in a room `roomHeight` px high, `rows` rows split by the gap. */
export const rowPx = (roomHeight: number, rows: number, gapPx = VIEW_ROW_GAP_PX): number =>
  (roomHeight - gapPx * (rows - 1)) / rows;

/**
 * Why a room `roomWidth` px wide does not allow `pick`, or '' when it does:
 * the reason a dimmed Rows option shows. Rows that do not split the octaves
 * evenly come first; then a white key under the minimum.
 */
export function whyNot(
  roomWidth: number,
  pick: KeysPick,
  slots: RowSlots = whiteSlots,
  whiteMinPx = WHITE_KEY_MIN_PX,
): string {
  if (isSmallest(pick)) return '';
  if (pick.octaves % pick.rows !== 0) return VIEW_HINTS.evenRows;
  if (whiteKeyPx(roomWidth, pick, slots) >= whiteMinPx) return '';
  return pick.rows === 1
    ? VIEW_HINTS.needsTwoRows(pick.octaves)
    : VIEW_HINTS.needsWidth(pick.octaves);
}

/** Whether a room `roomWidth` px wide allows `pick`. */
export const allows = (roomWidth: number, pick: KeysPick, slots: RowSlots = whiteSlots): boolean =>
  whyNot(roomWidth, pick, slots) === '';

/**
 * The rows an Octaves tap on `octaves` takes from `rows`: those rows when
 * they allow it, else another count that does, else null, and the option is
 * dimmed.
 */
export function rowsFor(
  roomWidth: number,
  { octaves, rows }: KeysPick,
  slots: RowSlots = whiteSlots,
  options: readonly number[] = VIEW_ROWS,
): number | null {
  if (allows(roomWidth, { octaves, rows }, slots)) return rows;
  return (
    options.find((other) => other !== rows && allows(roomWidth, { octaves, rows: other }, slots)) ??
    null
  );
}

/** Why the Octaves option `octaves` is dimmed beside `rows`, or '': only when no row count allows it. */
export const octavesWhyNot = (
  roomWidth: number,
  pick: KeysPick,
  slots: RowSlots = whiteSlots,
): string => (rowsFor(roomWidth, pick, slots) === null ? VIEW_HINTS.needsWidth(pick.octaves) : '');

/**
 * The pick the view draws for `pick` in a room `roomWidth` px wide: the pick
 * when the room allows it, else the same rows with fewer octaves, else one
 * row with fewer octaves, else one octave in one row. The stored pick is the
 * caller's and stays what the user picked.
 */
export function normalizePick(
  roomWidth: number,
  pick: KeysPick,
  slots: RowSlots = whiteSlots,
): KeysPick {
  if (allows(roomWidth, pick, slots)) return pick;
  for (const rows of [pick.rows, SMALLEST.rows])
    for (let octaves = pick.octaves - 1; octaves >= 1; octaves--)
      if (allows(roomWidth, { octaves, rows }, slots)) return { octaves, rows };
  return SMALLEST;
}

/**
 * The highest octave the keys may start at with `octaves` octaves shown: the
 * highest key, 12 × octave + 12 × octaves − 1, stays within the engine's note
 * range, and never above the Parts row's bound, so the row and the view agree
 * at 1 and 2 octaves.
 */
export function octaveMaxFor(octaves: number, ceiling = OCTAVE_MAX): number {
  const fits = Math.floor((MIDI_NOTE_MAX + 1) / SEMITONES_PER_OCTAVE) - octaves;
  return Math.min(ceiling, fits);
}
