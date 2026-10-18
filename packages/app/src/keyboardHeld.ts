/**
 * Where a held note and a held pointer land when the keys change under them
 * (record `2026-10-17-keyboard-geometry-follows-the-layout` decision 2,
 * amended for a fold by `2026-10-18-keyboard-fold` decision 5). Pure over
 * the notes the keys carry, so every boundary case is tested in Node.
 *
 * A note is its holder's identity, not its key: it lights every shown key
 * carrying it (two, where two rows share their closing note), and none when
 * no shown key does. A pointer follows its note to the key now carrying it,
 * and lifts when none does, after a re-render, a resize or an octave shift.
 * A fold's rename (a chord change, or a Fold switch) changes the notes on the
 * keys, not the pointer's key: the pointer keeps its key and its note, and
 * its next move is judged by the keys as they are.
 */

/** The keys of `notes` (each key's note, by offset) carrying `note`. */
export function keysCarrying(note: number, notes: readonly number[]): number[] {
  const keys: number[] = [];
  notes.forEach((carried, offset) => {
    if (carried === note) keys.push(offset);
  });
  return keys;
}

/** A pointer on the keys as they change: the key it was on, and its note's keys now. */
export interface FingerChange {
  /** The key it was on, or null off every key. */
  readonly offset: number | null;
  /** The keys now carrying the note it holds, or null when it holds none. */
  readonly carriers: readonly number[] | null;
  /** How many keys are shown now. */
  readonly count: number;
  /** True when a fold's rename changed the keys: a chord change or a Fold switch. */
  readonly renamed: boolean;
}

/** Where the pointer is after the change: on a key (or off every key, null), or lifted. */
export type FingerAfter = { readonly offset: number | null } | 'lift';

/**
 * The pointer after the keys change. Holding no note, it stays unless its
 * key is past the row. Holding one at a rename, it keeps its key and its
 * note, wherever the note now is. Otherwise it moves to its note's key (its
 * own when that still carries the note), and lifts when no shown key does.
 */
export function followFinger(change: FingerChange): FingerAfter {
  const { offset, carriers, count, renamed } = change;
  if (carriers === null) return (offset ?? 0) >= count ? 'lift' : { offset };
  if (renamed) return { offset };
  if (offset !== null && carriers.includes(offset)) return { offset };
  const first = carriers[0];
  return first === undefined ? 'lift' : { offset: first };
}
