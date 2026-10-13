/**
 * A part's `ccMappings` (windsor#782, record `2026-10-13-midi-cc-mapping`
 * decision 9) are the console's setup: which controller knob moves which of
 * the part's targets. The engine plays a CC's value only when the console's
 * router sets it (`AudioSystem.setPerformance`), so nothing here reads the
 * mappings, and `AudioSystem.apply` takes them out of each slot's partial
 * before the arrangement player's merge, which would otherwise report them
 * as an unknown field, as `patchSource` is taken out. The key is read by
 * name, so a partial that carries it reports clean whether or not the
 * document type names it yet.
 */
import type { DocumentPartial } from '../song/arrangementDocument';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `parts` with no slot's `ccMappings`; anything else, a removal or junk included, as it came. */
export function withoutCcMappings(parts: DocumentPartial['parts']): DocumentPartial['parts'] {
  if (!isRecord(parts)) return parts;
  return Object.fromEntries(
    Object.entries(parts).map(([slot, entry]) => {
      if (!isRecord(entry) || !('ccMappings' in entry)) return [slot, entry];
      const rest = { ...entry };
      delete rest.ccMappings;
      return [slot, rest];
    }),
  );
}
