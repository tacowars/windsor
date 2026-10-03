/**
 * The patch bar's two steps (windsor#521; record `2026-10-03-parts-tab-layout`
 * decision 5): ◀ ▶ walk the current filter's order and wrap at both ends, and
 * ↑ ↓ move the search popover's highlight and stop at both ends. Pure: the
 * order is `filterPresets` over `stepListing`, read by the caller.
 */
import type { Patch, PresetListing } from '@windsor/engine';
import { listLibrary } from './libraryModel';
import type { LibraryEntries } from './patchMetadata';

/** Back (◀, ↑) or forward (▶, ↓). */
export type StepDirection = 1 | -1;

/**
 * The listing ◀ ▶ walk and the popover lists. A pick copies the patch into
 * the song, and `listLibrary` lists a song's patches first under "this song",
 * so over that listing every step would move the patch it loaded and the
 * walk would jump. Here the order comes from ids alone: a song's copy of a
 * library patch keeps the library's place, and only the song's own patches
 * list first. Each row is still `listLibrary`'s, so a song's copy shows the
 * song's name and lists as the song's (invariant 3), and the "this song"
 * filter finds it.
 */
export function stepListing(
  entries: LibraryEntries,
  documentPatches: Readonly<Record<string, Patch>> = {},
  userIds: ReadonlySet<string> = new Set(),
): PresetListing[] {
  const songOwn = Object.fromEntries(
    Object.entries(documentPatches).filter(([id]) => !Object.hasOwn(entries, id)),
  );
  const rows = new Map(listLibrary(entries, documentPatches, userIds).map((row) => [row.id, row]));
  return listLibrary(entries, songOwn, userIds).flatMap((row) => rows.get(row.id) ?? []);
}

/**
 * The patch ◀ or ▶ loads: the neighbour of `current` in `order`, wrapping at
 * the ends. A `current` the filter hides (or an Init) steps to the first
 * entry going forward and the last going back. Null when there is nothing
 * else to load: an empty order, or one entry that is already playing.
 */
export function stepPatch(
  order: readonly string[],
  current: string,
  by: StepDirection,
): string | null {
  if (order.length === 0) return null;
  const at = order.indexOf(current);
  const next =
    at < 0 ? order[by > 0 ? 0 : order.length - 1] : order[(at + by + order.length) % order.length];
  return next === undefined || next === current ? null : next;
}

/** The popover's highlight after ↑ or ↓ over `count` results; -1 when there are none. */
export function moveHighlight(index: number, count: number, by: StepDirection): number {
  if (count === 0) return -1;
  return Math.min(count - 1, Math.max(0, index + by));
}
