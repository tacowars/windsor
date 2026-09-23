import type { DocumentPartial } from '../song/arrangementDocument';
/**
 * A document parts partial split in two (#597): what the player merges, and
 * each slot's `strip` partial, which lands on the live graph instead.
 */
export function splitStrips(parts: DocumentPartial['parts']): {
  arrangementParts: Record<string, unknown> | undefined;
  strips: Array<readonly [string, unknown]>;
} {
  if (parts === undefined) return { arrangementParts: undefined, strips: [] };
  if (typeof parts !== 'object' || parts === null || Array.isArray(parts)) {
    return { arrangementParts: parts as Record<string, unknown>, strips: [] };
  }
  const arrangementParts: Record<string, unknown> = {};
  const strips: Array<readonly [string, unknown]> = [];
  for (const [slot, raw] of Object.entries(parts as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      arrangementParts[slot] = raw;
      continue;
    }
    const { strip, ...rest } = raw as Record<string, unknown>;
    if (strip !== undefined) strips.push([slot, strip]);
    arrangementParts[slot] = rest;
  }
  return { arrangementParts, strips };
}
