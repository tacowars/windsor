# Format versions: refuse, never destroy

- **Date:** 2026-09-28
- **Status:** accepted (Pat, 2026-09-28, windsor#43)
- **Refines:** `2026-09-26-harmony-v2-document-v3-timeline-and-regions`
  decision 1 (the #705 retirement of song version 2), which stands

## Context

Breaking the song and patch formats is expected while Windsor is young. Until
now a break was silent in the wrong places: a song of an unreadable version
was normalised to the metronome fallback and adopted as the open song, which
the autosave then wrote over the stored record. A patch file of an unknown
format was a load problem among the rest. Nothing said which format the file
was, and nothing offered the saved text back.

## Decision

1. **One integer version per format.** Songs keep `version`
   (`ARRANGEMENT_VERSION`, 3). Patch files keep `format`
   (`PATCH_FILE_FORMAT`, 1), written by `serialisePatchFile`. A patch file
   with no `format` is format 1, so the shipped library and every stored user
   patch stay valid. A version is bumped only for a change that makes old
   files load wrong or fail: a rename, a re-scale, a removed field or a
   changed meaning. An additive field whose default reproduces the old
   behaviour bumps nothing, because the tolerant normalisers already handle it.
   The library loader fills an additive field's default too
   (`2026-09-28-retire-the-headroom-record`).
2. **Upgrades run first, and are never required.** `SONG_MIGRATIONS[n]`
   (`song/songMigrations.ts`) and `PATCH_MIGRATIONS[n]`
   (`patch/patchMigrations.ts`) upgrade version `n` to `n + 1`. They run
   before the version check and chain (1→2→3). A PR that bumps a version may
   add an upgrade from the previous one, or leave none. Both tables ship
   empty. Version 2 songs stay retired, with no upgrade.
3. **Refuse, never destroy.** A song or patch the chain can't bring to this
   build's version is not loaded and not deleted. `makeArrangement` returns
   `refused` (a `FormatRefusal`) beside the fallback, and the patch loader
   throws a `PatchFormatError`. The console acts on the refusal before it
   replaces anything:
   - **The autosaved song:** the restore question says "saved with song
     format N, this build reads M". It offers **Download the old song** (the
     stored text, byte for byte) and **Start fresh**. The record stays until
     the first edit replaces it, as before.
   - **An imported song file:** refused in an error toast with the same
     words. The open song is not replaced.
   - **User patches**, in IndexedDB or in the developer's folder, are listed
     under the library row with an "old format" badge. They never enter the
     library's entries, so they can't be played or assigned. Each has Export
     (the stored text) and Delete, which asks first.
4. **A song's snapshot is read at the patch format its version implies.** A
   song is self-contained (#562), and its embedded patches carry no `format`.
   A patch-format bump that changes the patch object therefore also bumps the
   song version, and that song upgrade, if one is written, upgrades the
   snapshot through `PATCH_MIGRATIONS`. An embedded patch that does declare
   its own `format` is upgraded through the patch table, and the key is
   dropped. If the chain can't reach this build's format, the whole song is
   refused with the same message, naming the patch.
5. **A rule for PRs.** `CLAUDE.md` ("Format versions") asks a breaking PR to
   bump the version, say so and add or decline an upgrade. `AGENTS.md` asks
   Codex to flag a shape change that doesn't bump.

## Consequences

- A document with no integer `version`, such as the retired four-slot shape
  or junk, is not a version question. It is normalised as before and falls
  back to the metronome. Only a declared, unreadable version is refused.
- The confirm dialog takes an optional `cancel` label, so the restore
  question can say "Start fresh".
- Nothing about the shipped patch files changes: the index and the headroom
  records are untouched.
