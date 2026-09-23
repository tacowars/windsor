/**
 * Part-list operations on a song document (#597), pure: what the console
 * calls to restructure a song, and the one name a slot's engine part and
 * strip are registered under. A part's display name keys nothing, so the
 * engine name comes from the slot alone.
 */
import { normaliseSongSidechains } from './sidechainNormalise';
import type { ArrangementDocument, DocumentPart, DocumentPartial } from './arrangementDocument';

/** The `FmEngine` part and strip name for a music slot; never a song's label. */
export const musicPartName = (slot: number): string => `music-${slot}`;

/** The part on a slot, or undefined. */
export function partAt(
  document: Pick<ArrangementDocument, 'parts'>,
  slot: number,
): DocumentPart | undefined {
  return document.parts.find((part) => part.slot === slot);
}

/**
 * The document without the part on `slot`. Its embedded patch goes too, but
 * only when no remaining part plays the same preset id — two parts may share
 * one patch, and removing one must not silence the other. The last part is
 * never removed: a song has at least one. Returns the document unchanged
 * when the slot holds no part or is the only one.
 */
export function removePart(document: ArrangementDocument, slot: number): ArrangementDocument {
  const removed = partAt(document, slot);
  if (!removed || document.parts.length <= 1) return document;
  const parts = document.parts.filter((part) => part.slot !== slot);
  const stillUsed = parts.some((part) => part.preset === removed.preset);
  if (stillUsed || !document.patches || !Object.hasOwn(document.patches, removed.preset)) {
    return normaliseSongSidechains({ ...document, parts });
  }
  const patches = { ...document.patches };
  delete patches[removed.preset];
  const next: { -readonly [K in keyof ArrangementDocument]: ArrangementDocument[K] } = {
    ...document,
    parts,
    patches,
  };
  if (Object.keys(patches).length === 0) delete next.patches;
  return normaliseSongSidechains(next);
}

/**
 * The live partial that removes the part on `slot` (#629): `null` at the slot,
 * and `null` at its patch id when `removePart` would have pruned it — the
 * same rule, so the document after `merge` equals the document `removePart`
 * returns. Null when the slot holds no part or is the only one.
 */
export function removePartChange(
  document: ArrangementDocument,
  slot: number,
): DocumentPartial | null {
  const removed = partAt(document, slot);
  const next = removePart(document, slot);
  if (!removed || next === document) return null;
  const pruned =
    document.patches?.[removed.preset] !== undefined && !next.patches?.[removed.preset];
  const parts: Record<number, NonNullable<DocumentPartial['parts']>[number]> = { [slot]: null };
  for (const part of next.parts) {
    if (part.strip.inserts !== partAt(document, part.slot)?.strip.inserts) {
      parts[part.slot] = { strip: { inserts: part.strip.inserts } };
    }
  }
  return {
    parts,
    ...(pruned ? { patches: { [removed.preset]: null } } : {}),
    ...(next.master && next.master.inserts !== document.master?.inserts
      ? { master: { inserts: next.master.inserts } }
      : {}),
  };
}
