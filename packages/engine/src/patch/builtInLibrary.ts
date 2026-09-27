/**
 * The built-in patch library, loaded on demand. `presets.ts` validates every
 * `patches/<id>.json` when it is imported, and the files are most of the
 * console's bytes, so the index exports this loader instead of the table: a
 * bundler emits the library as its own chunk, fetched after the page is up
 * (`docs/log/2026-09-27-the-built-in-library-loads-as-its-own-chunk.md`).
 * Engine code and tests import `presets.ts` directly.
 */
import type { LibraryEntry } from './patchLibrary';

export type BuiltInLibrary = Readonly<Record<string, LibraryEntry>>;

/** Every built-in library file, validated, keyed by id. */
export async function loadBuiltInLibrary(): Promise<BuiltInLibrary> {
  const { PATCH_LIBRARY } = await import('./presets');
  return PATCH_LIBRARY;
}
