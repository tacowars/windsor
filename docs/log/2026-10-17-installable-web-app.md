# Windsor installs as a Home Screen web app, with no service worker, and plays through the ringer switch

- **Date:** 2026-10-17
- **Status:** accepted
- **Links:** this record's issue, windsor#888 · PR previews
  `2026-09-28-pr-previews-on-github-pages` · the user's state in the browser
  `2026-09-27-user-library-in-indexeddb` · the keyboard on a tablet
  `2026-10-17-the-keyboard-on-a-tablet`

## Context

On the tablet the console runs in a browser tab, under an address bar and a
tab strip that take screen height the console needs. Added to the Home
Screen, a page with a web app manifest opens standalone, edge to edge under
a translucent status bar, with its own icon. Separately, Web Audio on the
tablet follows the ringer switch by default, so a muted tablet plays
nothing, unlike a music app.

## Decision

1. **A web app manifest, no service worker.**
   `packages/app/public/manifest.webmanifest` is linked from `index.html`,
   with `id`, `start_url` and `scope` at `./`, relative to the manifest, so
   the main site and each PR preview install from their own folder. There
   is no service worker. One registered under `/windsor/` would also
   control every `/windsor/pr-preview/pr-<N>/` page below it and could
   serve a stale build to a review. Offline use, if it is ever wanted, is a
   ticket of its own that solves that first.
2. **The audio session plays through the ringer switch.** Right before
   `EngineHost.start()` creates its `AudioContext`, `host.ts` sets
   `navigator.audioSession.type = 'playback'` when `navigator.audioSession`
   exists (the Audio Session API, in the tablet's browser since its version
   17). A `playback` session is the one a music app uses, and it ignores
   the ringer switch. A browser without the property starts audio exactly
   as before. The property is typed locally at the call, not by a global
   declaration, since `lib.dom` may not carry it. The line lives in the app,
   beside the context it precedes; the engine is untouched.

## What the installed app does differently

- **Its storage is its own.** The installed app's IndexedDB is separate
  from the browser tab's, so the user library and the autosaved song do not
  carry over. A song moves in by Export in the tab and Import in the app.
- **Its storage is not evicted.** A Home Screen web app is exempt from the
  browser's 7-day eviction of script-written storage for sites not visited.
- **No folder grant.** The File System Access folder grant is not available
  in the tablet's browser, installed or not; the library stays in
  IndexedDB.
