# The user's patches and songs live in IndexedDB

- **Date:** 2026-09-27
- **Status:** proposed. Pat chose IndexedDB over OPFS; the shape below is
  awaiting review before any code.
- **Supersedes, when accepted:** the user-state known follow-up in
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
| `songs` | song id | `{ id, name, updated, document }`, where `document` is the exported JSON text |

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
- **Save.** Writing a built-in id into the user library shadows the
  built-in. The file keeps its id, as a document copy does today. Deleting
  the user copy brings the built-in back.
- **Copy to new.** A new id goes to the user library.
- **Delete.** The action applies to user patches only. Built-ins stay
  read-only, and the `FALLBACK_PATCH_ID` guard remains.
- **The folder grant.** It stays as a developer mode that replaces the user
  library as Save's target while connected, exactly as it replaces the page
  library now.
- **Headroom.** Headroom records are not required in the store; they are
  read through the unswept loader, like the folder.

### Songs

- **Autosave.** The open document is saved to a fixed `current` record,
  debounced a few seconds after each change. On boot the console reopens it
  instead of a new song, so a reload loses nothing. New song replaces it
  after the existing "discard changes?" guard.
- **Named songs.** "Save song" / "Open song" on the Song tab store and list
  named records. Export and Import stay as they are: one file is the whole
  piece (invariant 3).
- **Self-contained.** Stored songs are unaffected by library edits: a stored
  song is the exported document with its `patches` snapshot.

### Out of scope for the first cut

- Sync across devices, and sharing.
- Import and export of the whole library as one bundle. It is a natural
  follow-up: a zip, or one JSON of records.
- OPFS. Revisit only if audio samples ever need storing, since those are
  the large binary case where OPFS earns its keep.

## Questions for Pat

1. Should autosave-and-reopen be the boot behaviour, or should the console
   offer "restore last session?"
2. Should saving over a built-in id shadow it (proposed), or always fork to
   a new id?
3. Named songs in the first cut, or autosave only?
