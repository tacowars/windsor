/**
 * The library workflow's tunables (#563): the loudness check's render and
 * seed count, the volume suggestion's margin, the Init sentinel and where the
 * folder grant is remembered.
 */

/**
 * The browser-side clip check's render — `fmProcessorHeadroom.test.ts`'s
 * render, with fewer seeds. `loudnessCheck.test.ts` pins it to the fixture's
 * `HEADROOM_RENDER`, which the browser bundle cannot import (it reads the
 * worklet from disk).
 */
export const LOUDNESS_RENDER = {
  voices: 16,
  blocks: 400,
  blockFrames: 128,
  note: 60,
  velocity: 0.9,
  noteOffFrame: 12000,
  sampleRate: 48000,
} as const;

/** Seeds the quick check renders; the offline sweep's 16,384 is the real reading. */
export const LOUDNESS_SEEDS = 16;

/** The suggested volume aims this far under the clip line: `volume × 0.98 / peak`. */
export const SUGGESTED_HEADROOM = 0.98;

/**
 * The document key an Init patch plays under. Not a library id — the slug
 * rule admits no parentheses — so it can never collide with a saved patch.
 */
export const INIT_PRESET_ID = '(init)';

/** The display name Init starts with, and the base of a Copy to new from it. */
export const INIT_PATCH_NAME = 'Init';

/** The repo folder the grant is asked on, shown in the picker's hint and the mode line. */
export const LIBRARY_FOLDER_PATH = 'packages/client/src/audio/patches';

/** IndexedDB home of the remembered directory handle. */
export const HANDLE_DB = { name: 'a204-patch-editor', store: 'handles', key: 'patches' } as const;

/** What to run after a write before `npm run verify` passes. */
export const AFTER_WRITE_COMMANDS = [
  'node tools/patch-editor/sweep-headroom.mjs --stale',
  'node scripts/patch-library-index.mjs --write',
  'npx prettier --write packages/client/src/audio/patches',
] as const;
