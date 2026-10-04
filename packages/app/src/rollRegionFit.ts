/**
 * An empty roll's loop follows its region's length (windsor#608, epic
 * windsor#596): while a region's own roll holds no notes, an edit that
 * changes the region's length sets its `loopTicks` to the new duration,
 * capped at `ROLL_LOOP_TICKS_MAX`. A roll with notes keeps its loop as the
 * author's own, and a region with no pattern of its own (it reads the
 * part's `sequencer`) is left alone. The lane's trims and seam rolls, a
 * split and the song-length follow apply this to the regions they commit,
 * in the same partial, so one undo takes back both.
 */
import type { ArrangementDocument, DocumentPartial, PartRegion } from '@windsor/engine';
import { ROLL_LOOP_TICKS_MAX, partAt } from '@windsor/engine';

/**
 * Whether `region`, at `index` of the edited list, has a length it did not
 * have in `before`: with as many regions, the one at the same index was
 * another length; with a region added or removed (a split, a draw), no
 * region of `before` starts and ends where it does.
 */
function resized(
  region: PartRegion,
  index: number,
  edited: readonly PartRegion[],
  before: readonly PartRegion[],
): boolean {
  if (edited.length === before.length) return before[index]?.duration !== region.duration;
  return !before.some((r) => r.start === region.start && r.duration === region.duration);
}

/**
 * `region` with its empty roll's loop fitted to its length; any other region
 * as it is. A drawn region's copied or default roll goes through this too
 * (`withNeighbourPattern`), so a click and a drag give the same loop.
 */
export function fitEmptyRoll(region: PartRegion): PartRegion {
  const { pattern } = region;
  if (pattern?.kind !== 'roll' || pattern.notes.length > 0) return region;
  const loopTicks = Math.min(region.duration, ROLL_LOOP_TICKS_MAX);
  return loopTicks === pattern.loopTicks
    ? region
    : { ...region, pattern: { ...pattern, loopTicks } };
}

/**
 * `regions`, an edit of `before`, with the loop of each empty roll whose
 * region changed length fitted to the region's new duration.
 */
export function fitEmptyRolls(
  regions: readonly PartRegion[],
  before: readonly PartRegion[],
): PartRegion[] {
  return regions.map((r, i) => (resized(r, i, regions, before) ? fitEmptyRoll(r) : r));
}

/**
 * `followed`, the song-length follow (`followSongLength`) of `edit` to `doc`,
 * with `fitEmptyRolls` applied to the regions of each part the follow
 * stretched; a part the edit itself set is left as the edit made it.
 */
export function fitFollowedRolls(
  doc: ArrangementDocument,
  edit: DocumentPartial,
  followed: DocumentPartial,
): DocumentPartial {
  if (!followed.parts || followed.parts === edit.parts) return followed;
  const parts = { ...followed.parts };
  for (const [key, entry] of Object.entries(followed.parts)) {
    const slot = Number(key);
    const before = partAt(doc, slot)?.regions;
    if (entry === edit.parts?.[slot] || !entry?.regions || !before) continue;
    parts[slot] = { ...entry, regions: fitEmptyRolls(entry.regions, before) };
  }
  return { ...followed, parts };
}
