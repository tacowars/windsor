/**
 * One part selection for the Song view and the Parts tab (windsor#462). The
 * shared slot is `ctx.parts.selected`; a pick goes through `selectPart`
 * (`partsSession.ts`), which counts it. The Song view writes a pick when it
 * selects a part or one of its regions (`pickedSlot`), and when it is shown
 * it adopts a pick it has not seen (`adoptPartsPick`). Both are pure, so the
 * rules are tested here and the tab only calls them.
 */
import type { SongSelection } from './songTab';

/** The Parts selection as the Song view reads it: the slot, and how many picks the session has counted. */
export interface PartsPick {
  readonly slot: number;
  readonly picks: number;
}

/** The Song view's selection after a check, and the pick count it has now seen. */
export interface Adopted {
  readonly selection: SongSelection;
  readonly seen: number;
}

/**
 * The Song view's selection once it has looked at the Parts selection
 * (decisions 3 and 4). A pick it has already seen changes nothing, so its own
 * selection, a harmony event included, stays. A new pick of the part it
 * already selects keeps its region; a new pick of another part selects that
 * part with no region named, which `validSelection` turns into its first
 * region, or none.
 */
export function adoptPartsPick(selection: SongSelection, pick: PartsPick, seen: number): Adopted {
  if (pick.picks === seen) return { selection, seen };
  const same = selection?.kind === 'part' && selection.slot === pick.slot;
  return {
    selection: same ? selection : { kind: 'part', slot: pick.slot, region: null },
    seen: pick.picks,
  };
}

/**
 * The slot a Song view selection picks for the Parts tab (decision 1): the
 * part's, for a part or one of its regions. A harmony event or no selection
 * picks nothing (null) and leaves the Parts selection as it is.
 */
export const pickedSlot = (selection: SongSelection): number | null =>
  selection?.kind === 'part' ? selection.slot : null;
