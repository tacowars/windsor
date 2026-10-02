# Your songs: a song library in the browser, with tags and templates

- **Date:** 2026-10-02
- **Status:** accepted; windsor#433 and windsor#434 build it. tacowars agreed the design and approved the mockup
  (`docs/design/song-library-mockup.html`) on 2026-10-02.
- **Extends:** `2026-09-27-user-library-in-indexeddb.md`, whose first cut was
  autosave only and left named songs for later, as more records in the same
  database.

## Context

A song lives in two places today:

- **The open document.** It autosaves to the `songs` store under `current`,
  and on a reload the console asks whether to restore it.
- **Exported files.** Export downloads one and Import reads one back.

tacowars wants to save songs in the app and open any of them at any time,
grouped by genre, with a place for templates. Storage stays in the browser.

## Decisions (tacowars, 2026-10-02)

1. **Placement.** The library is a **Songs** section at the top of the
   Settings gear tab, above Document. Document (New song, the file name,
   Export, Import), Export audio, Normalisation report and Live readout
   stay as they are.
2. **A named song saves itself.** Save as… gives an untitled song a name
   and tags. From then on every change autosaves into that song, so there is
   no Save button. Save as copy… forks a named song into a new one. An
   untitled song keeps today's session autosave and restore prompt.
3. **Tags, not folders.** A song carries any number of free-text tags. The
   list filters by one tag at a time (all, each tag, template, untagged),
   searches by name and sorts by last edited, name or created.
4. **Templates are songs tagged `template`.** Their row action is **New
   from**, which opens a copy as a new untitled song. The template itself
   is never written by that copy.
5. **A reload with a named song open reopens it straight away**, with a
   toast saying so, because nothing in it is at risk. An untitled song still
   asks before it restores.
6. **The name and tags live on the stored record, not in the document.**
   The song format does not change, so nothing bumps
   `ARRANGEMENT_VERSION`, and old exports load as they do now. An exported
   file carries no name or tags beyond its file name.
7. **Deleting the open song** leaves it open and playing as untitled, so
   Save as… can bring it back. Delete always asks first.
8. **Names need not be unique.** Every song has its own id.
9. **Save as… suggests the tags already in use**, with `template` always
   among them, and preselects the active tag filter.
10. **The export file name follows the open song's name** (`<name>.json`,
    and Export audio's names follow it, since it reads that field). An
    untitled song exports as `untitled.json`. An imported song opens
    untitled, and the file name it came from is offered as its name.
11. **Opening needs no question when the song you leave is named**, because
    it is saved. Leaving an untitled song that has changed asks first, as
    New song does: "Discard the changes to this untitled song? Save as…
    first to keep it."

## Design

### Store

The `windsor` database goes to version 2 and gains two object stores.
Version 2 is additive: `patches` and `songs` are untouched.

| Store | Key | Value |
|---|---|---|
| `songIndex` | song id | `{ id, name, tags, created, updated, bpm, bars, key }` |
| `songDocs` | song id | the song's export text, exactly what Export writes |

- **Why two stores.** The list reads only the small index records, so it
  never loads every song's patch snapshots to draw a table.
- **One transaction.** A save writes both records in a single transaction,
  so an index entry never points at a missing document.
- **Song facts.** `bpm`, `bars` and `key` are copied from the document at
  each write, for the table.
- **The session record.** `songs/current` gains an optional `songId` naming
  the open named song. While a named song is open, its text is written into
  `songDocs` and is not copied into `current`. While an untitled song is
  open, `current` holds its text as it does today.

### Keeping the rules already in force

- **Refuse, never destroy**
  (`2026-09-28-format-versions-refuse-never-destroy.md`). A stored song in a
  format this build cannot read stays in the list, marked as unopenable,
  and still offers Export .json and Delete. Opening it is refused with
  Import's words, and nothing in it is rewritten.
- **A repaired open is not written back** (`userSessionAutosave.ts`).
  Opening a named song that the normaliser corrected, left dangling or
  filled from the library writes nothing until the first edit, exactly as
  a restore does today.
- **Autosave goes to the song it read.** Switching songs flushes the
  pending autosave into the song being left before the next one opens. A
  write never lands in the wrong record.
- **No IndexedDB.** In a browser without it, the Songs section says the
  library is unavailable here, and Document works as before.

## Out of scope

- A backup of the whole library as one file, and importing such a bundle.
  Export per song is the backup for now.
- Sync across devices, and sharing.
- Nested folders.

## Delivery

Two tickets, sequenced:

1. **The model and storage** (windsor#433). The store, the open-song session, routing
   autosave to the open song, and the reload rule. Nothing visible changes.
2. **The Songs section** (windsor#434), built to the approved mockup, plus the export
   file name.
