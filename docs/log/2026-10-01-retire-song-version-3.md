# Retire song version 3

- **Date:** 2026-10-01
- **Status:** accepted (main session, 2026-10-01, windsor#224 option B;
  windsor#238)
- **Refines:** `2026-09-28-format-versions-refuse-never-destroy` decision 2
  (which upgrades ship)
- **Follows:** `2026-09-30-tape-magnetic-integration-design` (the Tape E2
  version bump) and `2026-09-30-tape-greenfield-direction`

## Context

`SONG_MIGRATIONS[3]` (`sendBusesFromReturns`, windsor#172) upgraded a
version-3 song's fixed `room` and `echo` returns to Send A and Send B. Tape E2
(windsor#224) changes what a saved Drive value means, so it bumps
`ARRANGEMENT_VERSION` from 4 to 5 with no upgrade, as the integration design
requires. With no 4 → 5 step, a version-3 song would climb to 4 and stop
there, refused anyway. The 3 → 4 upgrade becomes dead code that nothing can
reach to completion.

The E2 worker found that the bump broke 61 tests in 18 files. They
hard-coded song versions 3 and 4, or tested the 3 → 4 upgrade. Each future
bump would repeat that. The main session chose a seam before the bump
(windsor#224, option B), under tacowars's standing direction that old-song
compatibility never blocks work.

## Decision

1. **Version 3 is retired with no upgrade**, the way #705 retired version 2.
   `SONG_MIGRATIONS` is empty, and `sendBusesFromReturns` and its tests are
   deleted. A version-3 song is refused with the standard message ("saved
   with song format 3, this build reads 4"), not destroyed: the console
   still offers the saved text back. Version 2 keeps its #705 reason.
2. **Tests build songs from `ARRANGEMENT_VERSION`**, never from a literal
   current version. They use the constant directly, or `song()` in
   `documentCases.ts`, which stamps it. The expected
   messages are template strings. The version-gate test names
   `ARRANGEMENT_VERSION - 1` and `+ 1`. A test that deliberately reads an
   old version (the refusals of 1, 2 and 3) keeps its literal.
3. **The JSON test songs carry no `version`.** The four current-format files
   under `__fixtures__/arrangementDocuments/` load through
   `__fixtures__/arrangementDocumentFiles.ts`. Its `currentDocument` stamps
   `ARRANGEMENT_VERSION` on each file as it loads. They are not regenerated
   at a version. Before this change nothing loaded them. A test now checks
   that each still does what its name says. `retired-four-slot.json` is a
   retired shape and is read unstamped.

## Consequences

- A format bump changes one constant. Before merging, windsor#238 set
  `ARRANGEMENT_VERSION` to 5 locally and ran the song document, arrangement,
  console and autosave tests (83 files, 1035 tests). All passed. The one
  case that should change, a song one version behind now refused, passed
  through the version-gate test's `ARRANGEMENT_VERSION - 1`.
- The bump that adds a version still writes its own refusal test for the
  version it leaves behind, as the Tape design asks.
- A version-3 song saved before windsor#172 no longer opens. Its text is
  kept, and the user can download it.
