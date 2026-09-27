/**
 * The console's copy of the built-in library. The engine loads it on demand
 * (`loadBuiltInLibrary`), so the page starts without it: a new song needs
 * only the Init patch. `main.ts` starts the load at boot, and an import waits
 * for it, because the library fill (#562) resolves an older song's names
 * against it. Until it resolves, both views below are empty.
 */
import type { BuiltInLibrary, Patch } from '@windsor/engine';
import { loadBuiltInLibrary } from '@windsor/engine';

let entries: BuiltInLibrary = {};
let presets: Readonly<Record<string, Patch>> = {};
let pending: Promise<BuiltInLibrary> | null = null;

/** The built-in entries by id; empty until `loadBuiltIns` resolves. */
export const builtInEntries = (): BuiltInLibrary => entries;

/** Each built-in's patch by id, the documents' library fill; empty until loaded. */
export const builtInPresets = (): Readonly<Record<string, Patch>> => presets;

/** Load the built-ins once; every later call shares the first load. */
export function loadBuiltIns(): Promise<BuiltInLibrary> {
  pending ??= loadBuiltInLibrary().then((loaded) => {
    entries = loaded;
    presets = Object.fromEntries(Object.entries(loaded).map(([id, entry]) => [id, entry.patch]));
    return loaded;
  });
  return pending;
}
