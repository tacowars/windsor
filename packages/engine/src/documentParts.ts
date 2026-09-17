/**
 * Part-list operations on a song document (#597), pure: what the console
 * calls to restructure a song, and the one name a slot's engine part and
 * strip are registered under. A part's display name keys nothing, so the
 * engine name comes from the slot alone.
 */
import type { ArrangementDocument, DocumentPart } from './arrangementDocument';

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
    return { ...document, parts };
  }
  const patches = { ...document.patches };
  delete patches[removed.preset];
  const next: { -readonly [K in keyof ArrangementDocument]: ArrangementDocument[K] } = {
    ...document,
    parts,
    patches,
  };
  if (Object.keys(patches).length === 0) delete next.patches;
  return next;
}
