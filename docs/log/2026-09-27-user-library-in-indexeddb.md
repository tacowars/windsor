# The user's patches and songs live in IndexedDB

- **Date:** 2026-09-27
- **Status:** accepted and built. tacowars chose IndexedDB over OPFS and settled
  the open questions on 2026-09-27; built on 2026-09-28 (see "As built").
- **Supersedes:** the user-state known follow-up in
  `2026-09-27-windsor-forked-from-aotearoa204.md`

## Context

Windsor is a static site with no server, so user state has to live in the
browser. Today a user's work survives only by export:

- **Patches.** The console lists the built-in library, loaded as its own
  chunk (`2026-09-27-the-built-in-library-loads-as-its-own-chunk.md`). Save
  either downloads `<id>.json` or, with a File System Access grant on
  `packages/engine/src/patches/`, writes into the repo. That grant
  (`libraryFolder.ts`, #563) is a factory-library authoring workflow. It is
  Chromium-only and meaningless to someone using the hosted page.
- **Songs.** Songs exist only as the open document plus Export/Import. A
  reload loses unsaved work.

## Proposal

### Store

One IndexedDB database, `windsor`, version 1, with two object stores:

| Store | Key | Value |
|---|---|---|
| `patches` | patch id | the patch file's text, exactly what `serialisePatchFile` writes and a download would contain |
| `songs` | `current` (the only key for now) | `{ updated, document }`, where `document` is the exported JSON text |

Storing each record as the same text as its file keeps the format single:
one loader (`loadUnsweptPatchFile`, `makeArrangement`) reads a download, a
folder file and a stored record alike, and export is a copy. The store never
holds a schema of its own that can drift from the file format.

`navigator.storage.persist()` is requested on the first save, so the browser
does not evict the library under storage pressure. A refusal is reported,
not fatal.

### Patches: the user library is a `PatchFolder`

`PatchFolder` (`list`, `read`, `write`, `remove`) is already the whole of
what Save, Copy to new, Delete and the preset browser need from a folder. An
IndexedDB-backed `PatchFolder` (`app/src/userLibraryStore.ts`) therefore
plugs into the existing actions without new write paths:

- **Sources.** The preset browser's `source` filter gains `library` (the
  user's patches in IndexedDB) beside `built-in` and `document`. The page
  model lists built-ins and user patches together.
- **Save.** Saving over a built-in never shadows it. The edit gets a new
  id in the user library (the existing Copy-to-new naming, `kick-2` and so
  on), and the part switches to it. Built-in ids stay read-only, so a
  built-in always sounds the same. Saving a user patch writes over its own
  id. (Decided by tacowars, 2026-09-27.)
- **Copy to new.** A new id goes to the user library.
- **Delete.** The action applies to user patches only. Built-ins stay
  read-only, and the `FALLBACK_PATCH_ID` guard remains.
- **The folder grant.** It stays as a developer mode that replaces the user
  library as Save's target while connected, exactly as it replaces the page
  library now.
- **Headroom.** Headroom records are not required in the store; they are
  read through the unswept loader, like the folder.

### Songs

- **Autosave.** The open document is saved to the `current` record,
  debounced a few seconds after each change. New song replaces it after the
  existing "discard changes?" guard.
- **Restore asks first.** On boot, when a `current` record exists, the
  console starts on a new song as it does today and asks whether to restore
  the last session (showing when it was saved). Restoring opens it the way
  Import does, including waiting for the built-in library. Declining keeps
  the record until the first change overwrites it, so a mis-click can be
  undone by reloading.
- **Autosave only.** There is no "Save song" / "Open song" yet. Export and
  Import stay as they are: one file is the whole piece (invariant 3). Named
  songs can be added later as more keys in the same store.
- **Self-contained.** Stored songs are unaffected by library edits: a stored
  song is the exported document with its `patches` snapshot.

### Out of scope for the first cut

- Named songs (a song list on the Song tab).
- Sync across devices, and sharing.
- Import and export of the whole library as one bundle. It is a natural
  follow-up: a zip, or one JSON of records.
- OPFS. Revisit only if audio samples ever need storing, since those are
  the large binary case where OPFS earns its keep.

## Decisions (tacowars, 2026-09-27)

1. On a reload, the console asks before restoring the last session.
2. Autosave only for the first cut; no named songs.
3. Saving over a built-in patch creates a new id; built-ins are never
   shadowed.

## As built (2026-09-28)

The design above holds. Details settled while building it:

- **Files.** `app/src/userLibraryStore.ts` is the IndexedDB adapter (the
  only code that touches the API); `userSession.ts` boots it;
  `songAutosave.ts`, `songRestore.ts` and `storagePersistence.ts` are the
  tested rules. `LibraryModel` gains `user` (the store) and `userIds` (the
  writable ids); `isWritable` and `saveForks` are the read-only rule.
- **The engine's listing type.** `PresetListing.source` in
  `patch/presetCatalog.ts` gains `'library'`. That is a type change only;
  no engine behaviour changes.
- **A stored id that matches a built-in** (a future built-in taking an id a
  user already saved) stays hidden behind the built-in and is named in the
  library line's refused list (in the Parts tab's library row since
  `2026-09-28-notices-are-toasts`). The user's record is kept, not deleted.
- **No IndexedDB** (some private modes): the library is the built-ins alone,
  Save forks and downloads `<id>.json` as before, and nothing autosaves.
- **The autosave also flushes when the page is hidden**, so an edit made
  just before closing the tab is kept. It skips a write whose text equals
  the last one it wrote.
- **The persistence request is not awaited.** It runs before the first
  write, and a browser that prompts for it never holds up a save. Chrome
  declines it for most sites a visitor hasn't bookmarked or used much, so a
  refusal is the common case. It is a one-time warning toast
  (`2026-09-28-notices-are-toasts`), shown beside the save's own notice
  rather than in place of it.
- **After Save on a built-in, the song keeps its edited copy of the
  built-in** even though no part plays it any more. tacowars wants this: you
  sometimes come back to that patch later (2026-09-28).
- **Save over a built-in** opens the Copy-to-new modal, titled "Save your
  own …" and prefilled `<name> copy`. The id comes from the name, as for
  Copy to new, because display names must stay unique.
