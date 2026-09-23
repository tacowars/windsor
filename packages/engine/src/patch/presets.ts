/**
 * The whole-bank table: every `patches/<id>.json`, validated, as `PRESETS` /
 * `PRESET_NAMES` and as `PATCH_LIBRARY` with each file's metadata and headroom
 * record. This is the editor's and the tests' surface (#561 "two surfaces");
 * game code names single patches through `gameplayPatches.ts` instead, so a
 * bundler can drop the rest of the library once #562 removes the runtime
 * `PRESETS` fallback from the song path.
 *
 * Loading validates every file (`patchLibrary.ts`), so a stale headroom record
 * or a malformed file fails at import — `npm run verify` is the gate.
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
