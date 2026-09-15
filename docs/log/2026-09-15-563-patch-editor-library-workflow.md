# The patch editor writes the library: Init is a document sentinel, Delete needs the folder, one serialiser

- Date: 2026-09-15
- Area: audio
- Links: issue #563 · epic #564 (decisions 4–11) ·
  `2026-09-15-561-patch-library-file-shape` ·
  `2026-09-11-music-document-carries-patches-and-returns`

## Decision

The console's Parts tab gains Init, Save, Copy to new and Delete over the
`patches/<id>.json` library, a metadata modal, and a Chrome folder grant.
What the ticket left open, settled here:

- **Init plays through the document under the sentinel key `(init)`.** A
  part sounds only what the document names, so an Init patch has to be a
  document patch; the key has parentheses, which the id rule
  (`^[a-z0-9]+(-[a-z0-9]+)*$`) never admits, so no saved patch can collide
  with it, and `patchOrigin` reads it as "init" rather than "library". The
  sentinel is dropped from the document the moment no part plays it
  (`dropInit`, after a load or a Copy to new), so an unsaved Init is never
  exported and Init again always starts from `makePatch()`.
- **Delete needs the connected folder.** In page mode there is no file to
  remove and no import that could remove one; the button is disabled with
  that reason. Save and Copy to new download in page mode, as the epic says.
- **One serialiser.** `audio/patchFileSerialise.ts` writes exactly what the
  #561 migration wrote (key order `format, name, category, tags,
  description, patch, headroom`, two-space `JSON.stringify`, trailing
  newline; no `headroom` key for an unswept file). The sweep, the editor's
  folder write and its download all go through it; `patchFileSerialise.test.ts`
  pins the bytes against the migration's expression. Prettier then reshapes
  the file the same way for every writer, which is why the modal names three
  commands after a write: `sweep-headroom.mjs --stale`,
  `patch-library-index.mjs --write`, `prettier --write …/patches`.
- **A written file is re-read through `loadUnsweptPatchFile`.** It runs every
  check of `loadPatchFile` except the record's currency — a fresh write has a
  missing or stale record by construction — and a malformed record is still
  refused. The game, the index and the tests keep the strict loader;
  `npm run verify` stays the gate that demands the sweep.
- **The loudness check renders through `renderPatchToBuffer`.** The brief
  limited audio-package edits to the serialiser and a load option, but the
  console's build forbids any local worklet, and the package's offline
  render had no way to take a seed or a module URL a `file://` page can
  load. `BakeOptions` gains `seed`, `maxVoices` and `workletUrl`, defaults
  unchanged (`offlineRender.test.ts` pins both), and the check is the
  headroom test's render — note 60, velocity 0.9, 400 blocks, sixteen voices
  — over sixteen seeds, pinned to the fixture's `HEADROOM_RENDER` by
  `lib/loudnessRender.test.mjs`. It warns and never blocks.
- **The editor lists from its own library model.** `presetCatalog.listPresets`
  reads the baked `PATCH_LIBRARY`; a connected folder has to show a save
  without a rebuild, so `libraryModel.listLibrary` lists over whichever
  entries are live, and `libraryModel.test.ts` pins it equal to
  `listPresets` on the baked library (the one-definition rule's equality
  test). `patchHome`, `choosePreset` and the working-patch load consult the
  model instead of `PRESETS`.
- **Import takes Chrome's download suffix.** `kick (1).json` maps to `kick`;
  when several downloads carry one id the newest wins and the rest are
  reported as skipped. A rejected file prints the loader's message and the
  exit code is 1, so a script can notice.
- **Focus is a pure contract.** Tab wraps inside the dialog and close
  returns focus to the opener, else the patch controls' Load button
  (`focusTrap.ts`, tested without a DOM); the QWERTY handler ignores keys
  whose target is inside an open dialog, so a modal's buttons are not keys.

## Why

The epic wants the library improved from the editor, and everything it
writes must be a file the game and the tests read unchanged. Putting Init in
the document keeps the one rule the console already has — the part plays the
document — instead of a second sound path; one serialiser keeps the three
writers byte-identical; the unswept loader lets the editor see its own write
without weakening the gate the game and CI run.

## Punted / alternatives

- A no-DOM Init kept only in editor state: the live part would not sound it.
- Delete in page mode as a downloaded "tombstone" for the import script:
  not worth a second file format; connect the folder.
- The `source` column of the browser still reads `built-in` for a folder
  entry; `PresetListing` is `presetCatalog.ts`'s type, not this ticket's.
- Song self-containment and the runtime resolver: #562, in parallel.
