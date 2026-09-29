# Retire the headroom record, the content hash and userKey

- **Date:** 2026-09-28
- **Status:** accepted (tacowars, 2026-09-28, windsor#60)
- **Supersedes:** the headroom record of `2026-09-15-561-patch-library-file-shape`,
  the hash refresh #586 added for a schema change, and the bank-wide clip
  test of `2026-09-02-bass-digital-clip-headroom`. Those records are
  Aotearoa204 history and stay as they are.
- **Amends:** decision 1 of `2026-09-28-format-versions-refuse-never-destroy`

## Context

The headroom record is a test result stored in data, from Aotearoa204 #78,
where a game played presets straight to the output with no mixer. Nothing
at runtime reads `peak`, `worstSeed` or `seedsSwept`. The content hash exists
only to keep that record honest, and it pins the record to the patch, not the
engine, so a DSP level change already leaves every peak silently wrong. The
guarantee only ever covered the shipped bank, never a user's patches.

Windsor has strips, a master fader, a compressor insert and a master meter:
a hot patch is visible and the user's to fix. `userKey` keyed the wave cache
until #511 keyed it by the partials themselves; nothing reads it.

The record also made every schema change expensive. The loader refused a file
missing any field, so an additive field meant rewriting all 160 files and
refreshing every hash (#586), and a user saving to their own folder was told
that a CI check would fail until they ran a sweep.

## Decisions

1. **The file loses `headroom`; the operator loses `userKey`.** The
   `HeadroomRecord` type, `SWEEP_COMMAND`, `patchContentHash`, the loader's
   headroom checks and the headroom key list are gone. `OPERATOR_DEFAULTS`
   and the worklet's normaliser no longer carry `userKey`. The worklet
   normaliser reads known fields only, so a stray `userKey` in a song's
   embedded snapshot is ignored.
2. **The loader fills, and still refuses.** `loadPatchFile` refuses an
   unknown key at any level, a leaf of the wrong type, an array of the wrong
   length, a name that is not the patch's name and an id that is not a slug.
   A patch key that `makePatch` fills may be missing, and the entry returned
   carries the completed patch. The file's own keys (`name`, `category`,
   `tags`, `description`, `patch`) stay required. There is no longer a
   "swept" state, so `loadUnsweptPatchFile` and `UnsweptLibraryEntry` are gone:
   the built-ins, the developer's folder and the user's IndexedDB library all
   read through `loadPatchFile`.
3. **Patch format 2.** `PATCH_FILE_FORMAT` is 2. `PATCH_MIGRATIONS[1]` drops
   `userKey` from every operator, and `PATCH_FILE_MIGRATIONS[1]` drops
   `headroom` from the file; nothing else changes. The two are separate
   tables because `PATCH_MIGRATIONS` works on the patch object alone, which a
   song's embedded snapshot shares, and a song never carried a headroom
   record. A file with no `format` is still format 1 and upgrades. The
   serialiser writes `format: 2` and no `headroom`.
4. **The shipped bank was rewritten once** by
   `packages/app/rewrite-patches.mjs`: every file through the loader and the
   serialiser, then prettier. Every file is format 2, with `headroom` and
   `userKey` gone and every other byte the same. The FM golden test passed
   unchanged on the rewritten bank and the rebuilt worklet, which is the proof
   that no sound changed. The script stays as the tool for the next format
   bump, in place of the one-off `migrate-patches-586.mjs`.
5. **Deleted:** `packages/app/sweep-headroom.mjs`,
   `packages/app/migrate-patches-586.mjs`, `lib/afterWriteCommands.mjs` and
   its test, `synth/fmProcessorHeadroom.test.ts`,
   `patch/patchLibraryUnswept.test.ts` and `__fixtures__/headroomSweep.ts`.
   The loudness check's real-render test renders `LOUDNESS_RENDER` through
   the worklet harness itself, so it needs no fixture.
6. **The console.** `AFTER_WRITE_COMMANDS` is gone, and the metadata modal no
   longer says that `verify` fails until a sweep runs. The folder-mode save
   toast no longer names the sweep. `loudnessCheck.ts` stays: it renders
   live, never read the record, and still warns on a clipping patch.
7. **Docs.** `CLAUDE.md` invariant 2 says a new or edited file needs the
   index regenerated, which `verify` checks. The engine skill,
   `packages/app/CLAUDE.md`, the worklet guide and `AGENTS.md` drop the sweep.

## Consequences

- A field added to the patch with a default costs one line in the defaults
  table: no rewrite of the bank, no stale hash, no format bump.
- No test holds a preset's peak under 1 any more. A level problem shows on
  the meters and in the editor's loudness warning, and `patchLibraryEnvelope`
  still checks the sustained families' chord headroom.
- A song saved before this change carries `userKey` in every embedded
  operator, and those snapshots declare no `format`. The song normaliser
  drops the key and reports it as a correction ("unknown key dropped") until
  the song is saved again. No song version was bumped: the snapshot plays
  the same.
- A user patch stored at format 1 in IndexedDB or the folder upgrades on
  every read and is rewritten at format 2 on its next save.
