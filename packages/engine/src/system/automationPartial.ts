/**
 * The live engine takes a part's `automation` and ignores it (windsor#342,
 * record `2026-10-01-song-automation-lanes`): nothing plays a lane until the
 * automation player (windsor#344). `AudioSystem.apply` takes the key out of
 * each slot's partial before the player's merge, which would otherwise report
 * it as unknown on a part that had no lanes when it was built.
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
