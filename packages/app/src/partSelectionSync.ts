/**
 * One part selection for the Song view and the Parts tab (windsor#462). The
 * shared slot is `ctx.parts.selected`, which only `PartsSession` writes
 * (windsor#470), always through `resolveSlot`; a pick goes through
 * `ctx.parts.pick`, which counts it. The Song view writes a pick when it
 * selects a part or one of its regions (`pickedSlot`), and when it is shown
 * it lines its own selection up with the shared one (`syncSongSelection`).
 * Both are pure, so the rules are tested here and the tab only calls them.
 */
import type { SongSelection } from './songTab';

/**
 * The one resolve rule (windsor#470 decision 2): a requested slot the
 * document has is kept, otherwise the first part's slot, and 0 with no parts.
 */
export const resolveSlot = (slots: readonly number[], slot: number): number =>
  slots.includes(slot) ? slot : (slots[0] ?? 0);

/** The Parts selection as the Song view reads it: the slot, and how many picks the session has counted. */
export interface PartsPick {
  readonly slot: number;
  readonly picks: number;
}

/** The Song view's selection after a check, and the pick count it has now seen. */
export interface Synced {
  readonly selection: SongSelection;
  readonly seen: number;
}

/**
 * The Song view's selection once it has looked at the Parts selection
 * (decisions 3, 4 and the amended 6). The Song view never holds a part other
 * than the shared one, resolved by the session's own rule (`resolveSlot`).
 * A part selection on that
 * slot keeps its region; one on another slot, whether a pick or a reset (a
 * song switch, an undo) moved the shared slot, moves to it with no region
 * named, which `validSelection` turns into its first region, or none. A
 * harmony event, or no selection, stays unless a pick it has not seen
 * landed, which selects the shared part.
 */
export function syncSongSelection(
  selection: SongSelection,
  pick: PartsPick,
  seen: number,
  slots: readonly number[],
): Synced {
  const shared = slots.length > 0 ? resolveSlot(slots, pick.slot) : undefined;
  const onPart = selection?.kind === 'part';
  const keep = onPart ? selection.slot === shared : pick.picks === seen;
  const moved: SongSelection =
    shared === undefined ? null : { kind: 'part', slot: shared, region: null };
  return { selection: keep ? selection : moved, seen: pick.picks };
}

/**
 * The slot a Song view selection picks for the Parts tab (decision 1): the
 * part's, for a part or one of its regions. A harmony event or no selection
 * picks nothing (null) and leaves the Parts selection as it is.
 */
export const pickedSlot = (selection: SongSelection): number | null =>
  selection?.kind === 'part' ? selection.slot : null;
