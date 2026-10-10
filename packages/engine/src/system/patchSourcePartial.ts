/**
 * A part's `patchSource` (windsor#669, record
 * `2026-10-10-each-part-owns-its-patch`) is the app's link from the part's own
 * copy of a patch back to the library entry it came from. Nothing that plays
 * reads it, so `AudioSystem.apply` takes it out of each slot's partial before
 * the arrangement player's merge, which would otherwise report it as an
 * unknown field, as `meta` is taken out of the whole partial.
 */
import type { DocumentPartial } from '../song/arrangementDocument';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `parts` with no slot's `patchSource`; anything else, a removal or junk included, as it came. */
export function withoutPatchSource(parts: DocumentPartial['parts']): DocumentPartial['parts'] {
  if (!isRecord(parts)) return parts;
  return Object.fromEntries(
    Object.entries(parts).map(([slot, entry]) => {
      if (!isRecord(entry) || !('patchSource' in entry)) return [slot, entry];
      const rest = { ...entry };
      delete rest.patchSource;
      return [slot, rest];
    }),
  );
}
