/**
 * The Arp card's pure rules (#706): what Reseed and the Seed field write.
 * The card draws; these return the partial, so the rule is tested in Node
 * without a DOM.
 */
import type { DocumentPartial } from '@windsor/engine';
import { partChange } from './context';
import { ARP_RESEED_SPAN } from './sequencerKnobTables';

/** A partial writing the arp's `seed` on `slot`. */
export const arpSeedChange = (slot: number, seed: number): DocumentPartial =>
  partChange(slot, { sequencer: { seed } });

/** A new safe-integer seed in `[0, ARP_RESEED_SPAN)`, never the current one. */
export function freshSeed(current: number, random: () => number): number {
  const seed = Math.floor(random() * ARP_RESEED_SPAN);
  return seed === current ? (seed + 1) % ARP_RESEED_SPAN : seed;
}

/** What the Seed field accepts: a safe integer, or null to leave the document alone. */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const seed = Number(trimmed);
  return Number.isSafeInteger(seed) ? seed : null;
}
