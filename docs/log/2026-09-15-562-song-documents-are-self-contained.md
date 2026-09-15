# A song carries every patch it plays, and the game resolves from the document alone

- Date: 2026-09-15
- Area: audio
- Links: issue #562 · epic #564 (decision 2) · `2026-09-15-561-patch-library-file-shape` ·
  `2026-09-11-music-document-carries-patches-and-returns` ·
  `2026-08-31-arrangement-console-and-runtime-arrangements`

## Decision

An `arrangements/<name>.json` is the whole piece of music: its `patches` section
holds a full normalised `Patch` for every id its parts name, and on the game
path that section is the **only** table a part's `preset` resolves against.

- **One resolver, one option.** `PatchResolver` (`arrangementValidate.ts`) is
  the single definition. It takes the document's patches and an optional
  `libraryFill`. The game constructs it with no fill, so a name the document
  does not carry throws naming the part and the id
  (`kick: the song document defines no patch "kick"`) — there is no second
  copy of the rule and no branch inside it the game could take by accident.
  `makeArrangement(raw, { libraryFill })` is how that option reaches the
  normaliser.
- **The runtime `PRESETS` fallback is gone.** `audioSystem.ts`,
  `arrangementNormalise.ts`, `arrangementPlayer.ts` and `fmEngine.ts` no longer
  import the whole-bank table, `index.ts` no longer re-exports it, and
  `ArrangementPlayer`'s preset table is a required constructor argument rather
  than a defaulted `PRESETS`. `fmEngine.PartOptions.preset` is removed: the
  engine resolves no names at all, it takes a `Patch`.
- **Two things still resolve by library id, and both are bundled by id.**
  Gameplay sounds are not songs (`gameplayPatches.ts`, #561), so
  `AudioSystem.createSfxPart` takes a `GameplayPatchId`; and
  `FALLBACK_ARRANGEMENT` — the metronome click — now carries its one patch in
  its own `patches` section, which makes the fallback self-contained like every
  other document rather than an exception to the rule.
- **The editor fills an old document once, on open.** `DocumentModel` is the
  only caller that passes `libraryFill`. What it resolves that way is embedded
  into the document immediately, not carried as runtime state, so the export
  path needed no change at all: the export is the normalised document, and the
  normalised document is already self-contained. The Arrangement tab's
  normalisation report names the filled ids and says that exporting is what
  saves them.
- **`bed-01.json` gained its four patches** (`kick`, `hat`, `saw-arp`,
  `drone-sqr`), embedded by running the file through that same editor-open
  path — full precision, `JSON.stringify` of the live values, no rounding
  (#543 showed rounding moves transients). The file is now exactly normalised
  output, which also restored the `"pattern": null` fields a hand-trimmed
  export had dropped.

## Why

The library is going to keep improving (#563 makes it editable from the
browser), and until this ticket improving it silently re-authored the game's
music: `bed-01` named `kick` and got whatever `kick` had become. Pat's decision
2 on the epic is that a song plays exactly the patches it was exported with,
which only holds if the document is the whole record and the resolver has no
other table to reach for.

Removing the fallback also removes the library from the game bundle, which was
#561's punted item: nothing on the game path imports `presets.ts` or
`patches/index.ts` any more, so the bundler drops all 114 files. The client
chunk went from 896,440 B to 651,816 B (gzip 214,413 → 192,697) on this
machine, and `dist/` no longer contains `score-bronze-rain` or any other id no
song and no gameplay table names.

## The tunable this deliberately couples

`arrangementEquality.test.ts` renders four bars of `bed-01.json` twice — once
from the document's snapshots, once from `FULL_DOCUMENT`, whose patches are
read from the library — and asserts the two renders are sample-identical. That
is the computed proof that embedding changed no sound, and it is an in-test
baseline rather than a pinned hash, per Pat's rule on tunables.

It does couple that one test to four of the library's 114 patches: deliberately
re-tuning `kick`, `hat`, `saw-arp` or `drone-sqr` fails it. That failure is the
intended alarm, not churn — it is the moment someone decides whether `bed-01`
re-embeds the new patch or keeps the one Pat approved by ear on PR #81, which
is exactly the decision this ticket exists to make visible. Every other library
patch is free to move: no song references it.

## Punted / alternatives

- **Carrying the fill as runtime state**, so the editor resolved from the
  library on every lookup: rejected. Embedding at normalisation time means
  there is one document shape downstream, the export needs no special case, and
  "what the console holds is what an export produces" (record §3) survives.
- **Keeping `PartOptions.preset` with a caller-supplied table**: rejected as a
  second resolver in all but name. The engine takes a patch.
- **Migrating songs exported outside the repo**: out of scope by the issue —
  the editor-open fill covers them the first time they are opened.
- **Song-level patch metadata** (category, tags, description in the document):
  out of scope. Only `Patch` is embedded; the library keeps the metadata.
- **The editor's `patchHome` "built-in" badge** is now unreachable in practice,
  since every part's patch is embedded on open. Left alone on purpose: #563
  owns the editor's library actions and is in flight on the same file, and
  "Revert to built-in" still does the right thing — it drops the document's
  copy and the next normalisation refills it from the library.
