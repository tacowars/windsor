/**
 * The library workflow's tunables (#563): the loudness check's render and
 * seed count, the volume suggestion's margin, the Init sentinel and where the
 * folder grant is remembered.
 */

/**
 * The browser-side clip check's render: note 60 held a quarter second at
 * velocity 0.9, 400 blocks of 128 frames, sixteen voices, 48 kHz.
 * `lib/loudnessRender.test.mjs` renders it through the real worklet in Node.
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

/** Seeds the quick check renders: a warning, not a proof over every seed. */
export const LOUDNESS_SEEDS = 16;

/** The suggested volume aims this far under the clip line: `volume × 0.98 / peak`. */
export const SUGGESTED_HEADROOM = 0.98;

/**
 * The document key a part's Init patch plays under: `(init:0)` for slot 0
 * (#597). Not a library id — the slug rule admits no parentheses — so it can
 * never collide with a saved patch, and one key per slot so two parts' Inits
 * never share.
 */
export const INIT_PRESET_PREFIX = '(init:';
export const initPresetId = (partId: string): string => `${INIT_PRESET_PREFIX}${partId})`;
export const isInitPreset = (id: string): boolean => id.startsWith(INIT_PRESET_PREFIX);

/** The display name Init starts with, and the base of a Copy to new from it. */
export const INIT_PATCH_NAME = 'Init';

/** The repo folder the grant is asked on, shown in the picker's hint and the mode line. */
export const LIBRARY_FOLDER_PATH = 'packages/engine/src/patches';

/**
 * The user's own state (`2026-09-27-user-library-in-indexeddb`): one
 * database. `patches` holds each patch file's text by id; `songs` holds the
 * session record under `current`. Version 2 (windsor#433, record
 * `2026-10-02-song-library`) adds the named songs, additively: `songDocs`
 * holds each song's export text by song id, and `songIndex` the list's
 * cache derived from it.
 */
export const USER_DB = {
  name: 'windsor',
  version: 2,
  patches: 'patches',
  songs: 'songs',
  currentSong: 'current',
  songIndex: 'songIndex',
  songDocs: 'songDocs',
} as const;

/** The warning shown once when the browser declines persistent storage (`storagePersistence.ts`). */
export const EVICTABLE_WARNING =
  'Your patches and autosaved song are kept in this browser, which may clear them if it runs short of space. Export a song to keep a copy.';

/** IndexedDB home of the remembered directory handle (the developer's folder grant). */
export const HANDLE_DB = { name: 'a204-patch-editor', store: 'handles', key: 'patches' } as const;

/** The metadata modal (#563, #620 decision 7): its category sentinel, focus-trap query and readout precision. */
export const NEW_CATEGORY = '__new__';
export const FOCUSABLE = 'button, input, select, textarea, [tabindex]';
export const VOLUME_DIGITS = 3;
