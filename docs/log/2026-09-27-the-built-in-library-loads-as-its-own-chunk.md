# The built-in library loads as its own chunk

- **Date:** 2026-09-27
- **Status:** accepted
- **Supersedes:** the bundle-size known follow-up in
  `2026-09-27-windsor-forked-from-aotearoa204.md`

## Context

The console's single bundle was 623 kB (118 kB gzip), and Vite warned about
it. Most of it was the patch library: `@windsor/engine`'s index re-exported
`PRESETS` and `PATCH_LIBRARY` from `patch/presets.ts`, which imports and
validates every `patches/<id>.json` when it loads. The app read them
synchronously in three places: the page library model, the documents'
library fill (#562) and the revert status line. The console doesn't need the
library to start, because a new song plays only the Init patch (#598).

## Decision

Lazy-load the library. Pat chose this over raising the warning limit or
splitting the drum and scoring banks.

1. **The engine exports a loader, not the table.** The index drops
   `PRESETS`, `PATCH_LIBRARY`, `PRESET_NAMES` and `PRESET_CATALOG`, and
   exports `loadBuiltInLibrary(): Promise<BuiltInLibrary>`
   (`patch/builtInLibrary.ts`). That function is a dynamic `import('./presets')`,
   so the bundler emits the library as its own chunk. Engine code and tests
   import `patch/presets.ts` directly, and the app's tests import
   `@windsor/engine/patch/presets`, which the boundary rule allows for tests.
2. **The app caches it in one module.** `app/src/builtInLibrary.ts` holds the
   loaded entries and their patches, empty until the load resolves.
   `bootLibrary` starts the load at boot and puts the entries on the shared
   page-library model. A file import waits for the load before it
   normalises, so an older song's names always resolve against the full
   library.
3. **`PRESET_CATALOG` is gone.** Its only user was a test, and it forced
   `presetCatalog.ts` to import the whole library. The browser's metadata
   has come from each entry since #561.

## Consequences

- Measured with `vite build` on this branch: the entry chunk is 259 kB
  (85 kB gzip) and `presets-*.js` is 366 kB (32 kB gzip). The warning is
  gone.
- The preset browser is empty for the moment between first paint and the
  library chunk arriving.
- The user library in IndexedDB will be another source the same way: loaded
  asynchronously and merged into the page library model.
