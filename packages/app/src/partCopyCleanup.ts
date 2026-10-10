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
import { isInitPreset } from './libraryConstants';
import type { LibraryModel } from './libraryModel';
import { libraryPatch } from './libraryModel';

/** The id `uniqueId` (`patchMetadata.ts`) gives a copy: `<base>-<n>`, n from 2. */
const COPY_ID = /^(.+)-(\d+)$/;
const FIRST_COPY_NUMBER = 2;

/** True when `id` is exactly `<base>-<n>`, the id `uniqueId` gives a copy of `base`. */
function isCopyOf(id: string, base: string): boolean {
  const match = COPY_ID.exec(id);
  return match?.[1] === base && Number(match[2]) >= FIRST_COPY_NUMBER;
}

/**
 * The patches an automatic copy `id` must be leaf-identical to, or null when
 * `id` is no automatic copy (decision 2). The copy's base is the part's
 * `patchSource` when it has one, and `id` must be exactly `<patchSource>-<n>`;
 * its witnesses are that library entry and the song's other patches. With no
 * `patchSource` (the open-time split and a load's copy of a song-only patch)
 * the base is the id it was copied from, still in the song, and the copy must
 * match that patch. A renamed copy has lost its base's shape, even when it
 * kept the link: `custom-2` linked to `bell` is no automatic copy.
 */
function autoCopyWitnesses(
  doc: Pick<ArrangementDocument, 'patches'>,
  id: string,
  patchSource: string | undefined,
  library: LibraryModel,
): Patch[] | null {
  const patches = doc.patches ?? {};
  if (patchSource === undefined) {
    const base = COPY_ID.exec(id)?.[1];
    if (base === undefined || !isCopyOf(id, base) || !Object.hasOwn(patches, base)) return null;
    return [patches[base]!];
  }
  if (!isCopyOf(id, patchSource)) return null;
  const kept = Object.entries(patches)
    .filter(([other]) => other !== id && !isInitPreset(other))
    .map(([, other]) => other);
  const source = libraryPatch(library, patchSource);
  return source ? [source, ...kept] : kept;
}

/**
 * The `patches` removal that drops the copy part `slot` leaves as it moves
 * to `next`, or null (decisions 2 and 3); `doc` is the song before the move.
 * The copy goes only when no other part plays it, its id is no library id,
 * it is an automatic copy, and it is leaf-identical (name included) to one
 * of that copy's witnesses, so dropping it loses no sound. The patch the
 * move loads is no witness: Save as… writes the part's edits into it, and
 * the copy holding the same edits stays, as an edited copy always does.
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
  const witnesses = autoCopyWitnesses(doc, left, part.patchSource, library);
  if (!witnesses) return null;
  const unedited = witnesses.some((other) => patchLeafDifferences(patch, other).length === 0);
  return unedited ? { [left]: null } : null;
}
