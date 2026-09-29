# The music document carries the synth patches and the returns; the game plays a chosen committed document

- Date: 2026-09-11
- Area: audio
- Links: issue #435 · extends
  `2026-08-31-arrangement-document-schema-and-optional-parts` (lifts its
  punted `returns`/`spaces` row) · keeps
  `2026-08-31-arrangement-console-and-runtime-arrangements` §3 (build-time
  import, no runtime fetch) and §4–§5 (the loud fallback, the verify gate)

tacowars asked for one file: the synth and the reverb predate the mixer, sequencer
and arrangement work, so a patch edited on the console's Parts tab was
live-only and left the page as a separate patch JSON that had to be
hand-landed in `presetsAuthored.ts`, and the return level, delay time and
reverb space on the Mixer tab had no export at all. tacowars wants to program
every patch and every musical and mix element in the console, export one
JSON, and swap that file in the game to audition it.

## Decision

1. **`ArrangementDocument` gains `patches` and `returns`.** `patches` is a
   record of named, complete `Patch` objects (`patchNormalise.ts`
   normalises each against the `makePatch()` template: a field takes the raw
   value when its type matches, the default with a correction otherwise;
   unknown keys are dropped and reported; ranges stay the worklet's
   business, as it already clamps every patch value it reads). `returns` is
   a record of overlays over the code's `RETURNS`, by name, the way `mix`
   overlays `MIX` (`deskNormalise.ts`): a reverb return takes `level` and a
   full `space` clamped to the plate's declared ranges
   (`REVERB_SPACE_RANGES` in `audioConstants.ts`, asserted equal to the
   worklet's `parameterDescriptors` by `reverbSpace.test.ts`); a delay
   return takes `level`, `delayTime`, `feedback`, `damp`.

2. **A part's `preset` resolves against the document first, then the
   built-ins.** A document patch named like a built-in shadows it for that
   document's parts and nothing else — SFX parts still read `PRESETS`. The
   console forks a built-in into the document under the same name on the
   first knob edit, so the badge, the export and the part's `preset` field
   all tell one story; rename and revert are explicit controls. The
   `ArrangementPlayer` takes its preset table as a constructor parameter
   defaulting to `PRESETS` (data separate from logic), and `applyPatches`
   edits that table live and pushes the merged patch to every part playing
   it.

3. **Which returns exist stays code-owned; what they are set to is the
   document's.** A `returns` entry the code does not define is dangling
   (fails the gate), and a `kind` that disagrees with the code's is kept as
   the code's with a correction — a document cannot turn the plate into a
   delay, only set what the plate is. This keeps the mixer record's "no
   unmeasured DSP runs for nothing": one plate, one delay, until a ticket
   adds a return in `mix.ts`. `initMusic` lands the overlay on the live buses
   through the same `applyReturnsLive` the live `apply` path uses
   (`deskApply.ts`), so the committed path and the live path clamp
   identically.

4. **Every `arrangements/*.json` is bundled at build time and
   `?music=<name>` picks one.** `arrangementLibrary.ts` uses the
   `import.meta.glob` idiom of `splatTextures.ts`; `bed-01` stays the
   default (`DEFAULT_ARRANGEMENT_NAME`), `?music=0` still suppresses the
   transport. Auditioning a console export is: save it under
   `packages/client/src/audio/arrangements/<name>.json`, open the game with
   `?music=<name>`. Nothing in code names the file. The gate test iterates
   the whole library, so every committed document is shippable or `verify`
   fails.

5. **An unknown `?music=` name plays the fallback click and logs the miss.**
   Per the console record §4, a silent or musical stand-in would be
   invisible; the click plus a `music` event naming the missing file is
   loud. `installMusicControls` now takes the selection (`enabled`, `name`,
   `raw`) that `selectMusic` made from the query string — main.ts composes
   the two, and `index-for-editor.ts` does not export the library (the glob
   is Vite's; the console bundles through esbuild and boots on `bed-01.json`
   directly).

## Why

The through-line of the console record — one source of truth per thing —
was broken for exactly the two things that existed before it: the patch
lived in the console's working state and in a hand-copied TypeScript file,
the space lived only on a live `AudioParam`. Putting both in the document
makes the export the piece, and makes the normaliser, the gate and the live
`apply` path cover them like every other field.

The runtime-fetch alternative for swapping music was rejected in the console
record on an argument that still holds (a failed load is inaudible when the
content is generative). A build-time glob gives the swap tacowars asked for
without reopening it: a new file is one more bundled module, a typo in the
name is a click and a log line, and Vite's dev server picks up a dropped-in
file on reload.

## Punted / alternatives

| Rejected | Why not |
|---|---|
| Inline `patch` on each part slot instead of a named `patches` section | Two parts could not share a patch, and the `preset` name would mean two things |
| Fork a built-in under a generated name (`kick-2`) on first edit | The part's `preset` would silently change; same-name shadowing keeps the slot's identity and is one line in the export |
| Let a document define new returns | Would put an unmeasured plate in the graph from data; a return is still one entry in `mix.ts` |
| Runtime `fetch` of `public/music/<name>.json` | The console record's §3 objection verbatim; the glob gives the swap without it |
| Fall back to `bed-01` on an unknown `?music=` name | A musical stand-in for a typo — the record's invisibility objection |
| Range-clamp every patch field in the normaliser | ~100 fields whose ranges the worklet already enforces; the shape check catches what JSON can get wrong |
