/**
 * A part's library links play nothing: `patchSource` (windsor#669, record
 * `2026-10-10-each-part-owns-its-patch`) is the app's link from the part's own
 * copy of a patch back to the library entry it came from, and `rackSource`
 * (windsor#862, record `2026-10-17-racks`) the rack it was loaded from.
 * `AudioSystem.apply` takes both out of each slot's partial before the
 * arrangement player's merge, which would otherwise report them as unknown
 * fields, as `meta` is taken out of the whole partial.
 */
import type { DocumentPartial } from '../song/arrangementDocument';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fields that are the app's links to the library, read by nothing that plays. */
const LIBRARY_LINKS = ['patchSource', 'rackSource'] as const;

/** `parts` with no slot's `patchSource` or `rackSource`; anything else, a removal or junk included, as it came. */
export function withoutPatchSource(parts: DocumentPartial['parts']): DocumentPartial['parts'] {
  if (!isRecord(parts)) return parts;
  return Object.fromEntries(
    Object.entries(parts).map(([slot, entry]) => {
      if (!isRecord(entry) || !LIBRARY_LINKS.some((key) => key in entry)) return [slot, entry];
      const rest = { ...entry };
      for (const key of LIBRARY_LINKS) delete rest[key];
      return [slot, rest];
    }),
  );
}
