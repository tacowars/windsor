/**
 * A part's unedited automatic copy goes when the part moves on (windsor#671,
 * record `2026-10-10-each-part-owns-its-patch`, addendum). Each part owns
 * its patch (windsor#669), so a part that loads a patch another part plays
 * gets a copy; stepping on would leave that copy behind. When the copy holds
 * no edit — it is leaf-identical to a patch that stays reachable — it is
 * dropped in the same change that moves the part, so the load stays one
 * undo step and undo brings the copy back. Pure: the load paths
 * (`choosePreset`, `initPatch`, `copyToNew`) spread what this returns into
 * the `patches` of the change they already make.
 */
import type { ArrangementDocument } from '@windsor/engine';
import { partAt, patchLeafDifferences } from '@windsor/engine';
import { isInitPreset } from './libraryConstants';
import type { LibraryModel } from './libraryModel';
import { libraryPatch } from './libraryModel';

/** The id `uniqueId` (`patchMetadata.ts`) gives a copy: `<base>-<n>`, n from 2. */
const COPY_ID = /^(.+)-(\d+)$/;
const FIRST_COPY_NUMBER = 2;

/** The id `id` was copied from, when `id` has the shape a copy's fresh id takes. */
function copyBase(id: string): string | undefined {
  const match = COPY_ID.exec(id);
  if (!match || Number(match[2]) < FIRST_COPY_NUMBER) return undefined;
  return match[1];
}

/**
 * True when `id` is an automatic copy (decision 2): its id has a copy's
 * shape, and the part kept the library link (`patchSource`), or the id it
 * was copied from is still in the song (the open-time split and a load's
 * copy of a song-only patch). A renamed copy has lost the shape.
 */
function isAutoCopy(
  doc: Pick<ArrangementDocument, 'patches'>,
  id: string,
  patchSource: string | undefined,
): boolean {
  const base = copyBase(id);
  if (base === undefined) return false;
  return patchSource !== undefined || Object.hasOwn(doc.patches ?? {}, base);
}

/**
 * The `patches` removal that drops the copy part `slot` leaves as it moves
 * to `next`, or null (decisions 2 and 3); `doc` is the song before the move.
 * The copy goes only when no other part plays it, its id is no library id,
 * it is an automatic copy, and it is leaf-identical (name included) to its
 * `patchSource` library entry or to another patch already in the song, so
 * dropping it loses no sound. The patch the move loads is no witness: Save
 * as… writes the part's edits into it, and the copy holding the same edits
 * stays, as an edited copy always does.
 */
export function leftCopyDrop(
  doc: Pick<ArrangementDocument, 'parts' | 'patches'>,
  slot: number,
  next: string,
  library: LibraryModel,
): Record<string, null> | null {
  const part = partAt(doc, slot);
  if (!part || part.preset === next) return null;
  const left = part.preset;
  const patch = doc.patches && Object.hasOwn(doc.patches, left) ? doc.patches[left] : undefined;
  if (!patch || isInitPreset(left) || Object.hasOwn(library.entries, left)) return null;
  if (doc.parts.some((other) => other.slot !== slot && other.preset === left)) return null;
  if (!isAutoCopy(doc, left, part.patchSource)) return null;
  const kept = Object.entries(doc.patches ?? {})
    .filter(([id]) => id !== left && !isInitPreset(id))
    .map(([, other]) => other);
  const source =
    part.patchSource === undefined ? undefined : libraryPatch(library, part.patchSource);
  const reachable = source ? [source, ...kept] : kept;
  const unedited = reachable.some((other) => patchLeafDifferences(patch, other).length === 0);
  return unedited ? { [left]: null } : null;
}
