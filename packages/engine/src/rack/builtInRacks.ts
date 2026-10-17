/**
 * The built-in rack bank, loaded on demand (windsor#877). As the patch bank
 * (`patch/builtInLibrary.ts`, record
 * `2026-09-27-the-built-in-library-loads-as-its-own-chunk`), the index
 * exports this loader and not the table, so a bundler emits the racks as
 * their own chunk, fetched after the page is up. Engine code and tests
 * import `rackBank.ts` directly.
 */
import type { RackEntry } from './rackFile';

export type BuiltInRacks = Readonly<Record<string, RackEntry>>;

/** Every built-in rack file, validated, keyed by id. */
export async function loadBuiltInRacks(): Promise<BuiltInRacks> {
  const { RACK_BANK } = await import('./rackBank');
  return RACK_BANK;
}
