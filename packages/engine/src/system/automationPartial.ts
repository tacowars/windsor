/**
 * A part's `automation` in a live partial is the automation player's
 * (windsor#344, `songAutomation.ts`), not the arrangement player's:
 * `AudioSystem.apply` takes the key out of each slot's partial before the
 * player's merge, which would otherwise report it as unknown on a part that
 * had no lanes when it was built, and hands the whole partial to the
 * automation once everything else has landed.
 */
import type { DocumentPartial } from '../song/arrangementDocument';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `parts` with no slot's `automation`; anything else, a removal or junk included, as it came. */
export function withoutAutomation(parts: DocumentPartial['parts']): DocumentPartial['parts'] {
  if (!isRecord(parts)) return parts;
  return Object.fromEntries(
    Object.entries(parts).map(([slot, part]) => {
      if (!isRecord(part) || !('automation' in part)) return [slot, part];
      const rest = { ...part };
      delete rest.automation;
      return [slot, rest];
    }),
  );
}
