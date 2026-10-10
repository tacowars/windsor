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
import type { ArrangementDocument, Patch } from '@windsor/engine';
import { partAt, patchLeafDifferences } from '@windsor/engine';
import type { AutoCopies } from './autoCopies';
import { isInitPreset } from './libraryConstants';
import type { LibraryModel } from './libraryModel';
import { libraryPatch } from './libraryModel';

/**
 * The patches an automatic copy `id` must be leaf-identical to (decision 2):
 * the library entry its part links to (`patchSource`), when there is one,
 * and every other patch in the song (an Init sentinel aside). With no link
 * (the open-time split and a load's copy of a song-only patch), the patch it
 * was copied from is still in the song, so it is among them.
 */
function autoCopyWitnesses(
  doc: Pick<ArrangementDocument, 'patches'>,
  id: string,
  patchSource: string | undefined,
  library: LibraryModel,
): Patch[] {
  const kept = Object.entries(doc.patches ?? {})
    .filter(([other]) => other !== id && !isInitPreset(other))
    .map(([, other]) => other);
  const source = patchSource === undefined ? undefined : libraryPatch(library, patchSource);
  return source ? [source, ...kept] : kept;
}

/**
 * The `patches` removal that drops the copy part `slot` leaves as it moves
 * to `next`, or null (decisions 2 and 3); `doc` is the song before the move.
 * The copy goes only when `auto` recorded it as one the app made this
 * session (`AutoCopies`: a load's copy or the open-time split, never a
 * rename), no other part plays it, its id is no library id, and it is
 * leaf-identical (name included) to one of its witnesses, so dropping it
 * loses no sound. The patch the move loads is no witness: Save as… writes
 * the part's edits into it, and the copy holding the same edits stays, as
 * an edited copy always does.
 */
export function leftCopyDrop(
  doc: Pick<ArrangementDocument, 'parts' | 'patches'>,
  slot: number,
  next: string,
  library: LibraryModel,
  auto: Pick<AutoCopies, 'has'>,
): Record<string, null> | null {
  const part = partAt(doc, slot);
  if (!part || part.preset === next || !auto.has(part.preset)) return null;
  const left = part.preset;
  const patch = doc.patches && Object.hasOwn(doc.patches, left) ? doc.patches[left] : undefined;
  if (!patch || isInitPreset(left) || Object.hasOwn(library.entries, left)) return null;
  if (doc.parts.some((other) => other.slot !== slot && other.preset === left)) return null;
  const witnesses = autoCopyWitnesses(doc, left, part.patchSource, library);
  const unedited = witnesses.some((other) => patchLeafDifferences(patch, other).length === 0);
  return unedited ? { [left]: null } : null;
}
