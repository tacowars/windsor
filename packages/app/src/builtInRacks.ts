/**
 * The console's copy of the built-in rack bank (windsor#877), the twin of
 * `builtInLibrary.ts`: the engine loads it on demand (`loadBuiltInRacks`, its
 * own chunk), `bootLibrary` starts the load after the patch bank's, and
 * `rackLibrary.ts` lists the entries under the user's own racks. Empty until
 * the load resolves.
 */
import type { BuiltInRacks } from '@windsor/engine';
import { loadBuiltInRacks as loadBank } from '@windsor/engine';

let entries: BuiltInRacks = {};
let pending: Promise<BuiltInRacks> | null = null;

/** The built-in racks by id; empty until `loadBuiltInRacks` resolves. */
export const builtInRackEntries = (): BuiltInRacks => entries;

/** Load the bank once; every later call shares the first load. */
export function loadBuiltInRacks(): Promise<BuiltInRacks> {
  pending ??= loadBank().then((loaded) => {
    entries = loaded;
    return loaded;
  });
  return pending;
}
