/** Whole-song references can only be checked after every part has been normalised. */
import { disconnectInvalid, documentSidechains, invalidSidechains } from '../mixer/sidechainGraph';
import type { ArrangementDocument } from './arrangementDocument';
import type { FieldNormaliser } from './arrangementFields';
export function normaliseSongSidechains(
  document: ArrangementDocument,
  n?: FieldNormaliser,
): ArrangementDocument {
  const graph = documentSidechains(document);
  const invalid = invalidSidechains(graph);
  if (!invalid.length) return document;
  for (const { path, reason } of invalid) {
    n?.dangling.push(`${path}: ${reason}`);
    n?.correction(`${path}: ${reason} — external disconnected`);
  }
  const next = disconnectInvalid(graph, invalid);
  return {
    ...document,
    parts: document.parts.map((part) => ({
      ...part,
      strip: { ...part.strip, inserts: next.get(part.slot)! },
    })),
    ...(document.master ? { master: { ...document.master, inserts: next.get('master')! } } : {}),
  };
}
