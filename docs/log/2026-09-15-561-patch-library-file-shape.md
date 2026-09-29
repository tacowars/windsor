# Patches are one JSON file each; the headroom record lives in the file

- Date: 2026-09-15
- Area: audio
- Links: issue #561 · epic #564 (decisions 1, 3, 4, 6 and 10) ·
  `2026-09-02-bass-digital-clip-headroom` · `2026-09-15-543-modulation-depth-25-rad-at-full-level`

## Decision

Every factory patch is one file, `packages/client/src/audio/patches/<id>.json`,
and there is no other source of a patch: the `makePatch` literal files, the
editor-export literals and the recipe-generated scoring bank are gone. The
file is

```json
{
  "format": 1,
  "name": "Bell Lead",
  "category": "Plucks",
  "tags": ["bell", "original"],
  "description": "Original FM bell. Try C4–C5 with sparse delay.",
  "patch": { "…the full normalised Patch…": 0 },
  "headroom": { "worstSeed": 8808, "peak": 0.72, "seedsSwept": 16384, "contentHash": "…" }
}
```

- **The id is the filename slug** (`^[a-z0-9]+(-[a-z0-9]+)*$`), immutable,
  equal to the old `PRESETS` key so no song reference moved; `name` is the
  editable display name and must equal `patch.name`.
- **`patch` is complete and exact**: every field `makePatch` would emit, no
  field it would not, numbers at full double precision. The loader
  (`patchLibrary.ts`) refuses an unknown field, a missing one, a wrong leaf
  type, a name mismatch, a bad id and a missing or stale headroom record.
- **`format: 1`** is the file's version. A future shape change bumps it and
  the loader converts or refuses; a file with a format it does not know is
  refused, never half-read. The number is the file's, distinct from the
  arrangement document's version, because the two evolve on different
  tickets (#562 owns the document).
- **The headroom record lives in the file**, not in a test or a fixture.
  `worstSeed` and `peak` are the offline sweep's reading, `seedsSwept` is
  how wide that sweep was, and `contentHash` is a 32-bit FNV-1a of the
  normalised, key-sorted `patch` — a staleness detector that runs
  synchronously in the browser and in Node, not a security hash. The hash
  pins the record to the patch and deliberately not to the engine: a DSP
  change is a re-sweep decided by its own ticket, not a verify failure on
  114 files. `tools/patch-editor/sweep-headroom.mjs <id…|--stale>` writes
  the record (16,384 seeds by default, about 6 s per patch on a dev machine,
  `--seeds` to lower it); `fmProcessorHeadroom.test.ts` renders the recorded
  seed and fails naming that command.
- **Two surfaces.** `presets.ts` builds the whole-bank table (`PRESETS`,
  `PATCH_LIBRARY`, the catalogue) from a generated `patches/index.ts` of one
  static import per file — the mechanism all three bundlers (Vite, esbuild,
  Vitest) share, since `import.meta.glob` is Vite-only — and
  `scripts/patch-library-index.mjs --check` in `npm run verify` refuses a
  stale index. `gameplayPatches.ts` imports the patches game code plays by
  id (`GAMEPLAY_PATCH_IDS`), each from its own file, so a bundler can drop
  the rest of the bank once #562 removes the runtime `PRESETS` fallback.
- **Recipe generation is retired.** The scoring bank's rows and voicing
  module were a way to author 100 patches quickly; once expanded and frozen
  as data they were the one part of the bank the editor could not write.
  The expanded patches are the source now (epic decision 6), bit-identical
  to what the recipes produced.
- **`modDepth.test.ts` is retired.** Its job was to prove #543's one-time
  migration (levels × √2, engine scale ÷ 2); this ticket's bit-identity
  fixture (`__fixtures__/patchLibraryBefore561.json`, captured from main
  before any patch moved, compared field by field with `Object.is`)
  completes that proof. Its one lasting check — the worklet's
  `MOD_INDEX_SCALE` equals the fixture's `modIndexScale / 2`, which is what
  stops the engine constant moving while the files stay authored against
  it — lives in `fmProcessorKernel.test.ts`. The #543 fixtures stay for
  provenance.

## Why

The editor (#563) and self-contained songs (#562) both need a single source
they can read and write; code cannot be rewritten safely by a tool and a
recipe row is not a patch. The headroom record had to move with the patch
because a hand-kept seed map in a test would fail verify for every patch
saved from the editor; in the file, a save is a sweep plus a write, and the
hash makes an unswept edit visible.

Seeds were carried, not re-swept: the originals' 16,384-seed draws (#78;
4,096 for `saw-arp` and `drone-sqr`) and the scoring bank's 256-seed draws
(#475). The peak written is one render at that seed with the test's own
render — the originals had none recorded, and seven scoring peaks predated
#543's top-of-travel clamp and no longer matched what their seed renders (the
other 93 matched bit for bit). A 16,384-seed sweep of `kick` on the dev
machine re-found seed 2765 exactly, so the file's render is #78's.

The envelope bar (`patchLibraryEnvelope.test.ts`) is driven by the files'
categories, so a patch saved into `Pads` is held to the scoring bar; the
pre-#475 bank, levelled for the game mix rather than that bar (`lead-bell`
peaks 2.4 on a four-note chord at full velocity), is recognised by its own
`original` / `authored` / `legacy` tags and checked only for finiteness,
audibility and release.

## Punted / alternatives

- A tags-as-string field, as the recipe rows had: split into an array so
  the editor's tag suggestions (#563) read a list.
- Hashing the engine into `contentHash`: rejected above; a DSP change gets
  its own re-sweep decision.
- Removing the runtime `PRESETS` fallback and the bank from the game bundle:
  #562. Until then the game carries the whole library (about 275 KB of JSON
  uncompressed), reported in the PR, not judged.
- A `patches/` write path from the browser: #563 (epic decision 5).

## Addendum, 2026-09-16 (#583): the identity proof is history

`patchLibraryIdentity.test.ts` pinned every id and every `Patch` field to the
pre-migration fixture. That was the migration's proof, and it stopped being a
gate the moment the library became data the editor saves over: tacowars's first
save (`kick`, "updated kick - shorter") failed it even after the headroom
sweep, and its id check would have failed on the 115th file. #583 deletes the
test, the way #561 retired #543's `modDepth.test.ts`. The fixture and its
generator stay as provenance; the proof is PR #567's history.

The library's live gates are the loader (shape, name, id, headroom hash),
`fmProcessorHeadroom.test.ts` on each file's recorded seed, and
`patchLibraryEnvelope.test.ts` on the sustained categories.
