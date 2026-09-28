/**
 * The whole-bank table: every `patches/<id>.json`, loaded, as `PRESETS` /
 * `PRESET_NAMES` and as `PATCH_LIBRARY` with each file's metadata. This is
 * the console's and the tests' surface (#561 "two surfaces").
 * The playback path never imports it: a song carries its own patches (#562)
 * and the fallback click imports its one file through `fallbackPatch.ts`.
 *
 * Loading checks every file (`patchLibrary.ts`), so a malformed file fails
 * at import — `npm run verify` is the gate.
 */
import type { Patch } from './patch';
import { loadPatchLibrary } from './patchLibrary';
import type { LibraryEntry } from './patchLibrary';
import { PATCH_FILES } from '../patches/index';

/** Every library file, validated, keyed by id. */
export const PATCH_LIBRARY: Readonly<Record<string, LibraryEntry>> = loadPatchLibrary(PATCH_FILES);

export const PRESETS: Record<string, Patch> = Object.fromEntries(
  Object.entries(PATCH_LIBRARY).map(([id, entry]) => [id, entry.patch]),
);

export const PRESET_NAMES = Object.keys(PRESETS);
