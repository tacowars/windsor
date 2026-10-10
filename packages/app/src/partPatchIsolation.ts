/**
 * Each part owns its patch (windsor#669, record
 * `2026-10-10-each-part-owns-its-patch`): in the open song no two parts play
 * the same `patches` id, so a knob turned on one part never moves another.
 * A part's own copy of a library patch keeps its link to the library entry
 * in `patchSource`. Pure: the load path (`choosePreset`) and the open path
 * (`AppContext.replaceDocument`) send what these return through the
 * document write they already make.
 */
import type { ArrangementDocument, DocumentPart, DocumentPartial, Patch } from '@windsor/engine';
import { clonePatch } from '@windsor/engine';
import { uniqueId } from './patchMetadata';

/** The library ids a copy's `patchSource` may name and a new id must not take. */
export type LibraryIds = ReadonlySet<string>;

/** A part other than `slot` that plays `id`, if one does. */
export const playerElsewhere = (
  doc: Pick<ArrangementDocument, 'parts'>,
  slot: number,
  id: string,
): DocumentPart | undefined => doc.parts.find((part) => part.slot !== slot && part.preset === id);

/**
 * The `patchSource` a copy of `shared` takes (decisions 2 and 5): the link
 * of the part it is copied from or for, if that part has one, else `shared`
 * when that is a library id, else none.
 */
export function copySource(
  part: Pick<DocumentPart, 'patchSource'>,
  shared: string,
  libraryIds: LibraryIds,
): string | undefined {
  return part.patchSource ?? (libraryIds.has(shared) ? shared : undefined);
}

/** A fresh id for a copy of `shared`: free in the library and the song, and among `also`. */
export function copyId(
  doc: Pick<ArrangementDocument, 'patches'>,
  shared: string,
  libraryIds: LibraryIds,
  also: Iterable<string> = [],
): string {
  return uniqueId(shared, [...libraryIds, ...Object.keys(doc.patches ?? {}), ...also]);
}

/**
 * The edit a song needs as it opens so no two parts share a patch (decision
 * 5): for each id more than one part plays, the lowest slot keeps it and
 * every other part gets an identical copy under a fresh id, its
 * `patchSource` set by `copySource`. Part names stay; nothing is deleted.
 * Null when no id is shared.
 */
export function isolatePartPatches(
  doc: Pick<ArrangementDocument, 'parts' | 'patches'>,
  libraryIds: LibraryIds,
): DocumentPartial | null {
  const kept = new Set<string>();
  const added: string[] = [];
  const parts: Record<number, { preset: string; patchSource?: string }> = {};
  const patches: Record<string, Patch> = {};
  for (const part of [...doc.parts].sort((a, b) => a.slot - b.slot)) {
    const patch = doc.patches?.[part.preset];
    if (!kept.has(part.preset) || !patch) {
      kept.add(part.preset);
      continue;
    }
    const id = copyId(doc, part.preset, libraryIds, added);
    added.push(id);
    patches[id] = clonePatch(patch);
    const source = copySource(part, part.preset, libraryIds);
    parts[part.slot] = source === undefined ? { preset: id } : { preset: id, patchSource: source };
  }
  return added.length > 0 ? ({ parts, patches } as DocumentPartial) : null;
}
