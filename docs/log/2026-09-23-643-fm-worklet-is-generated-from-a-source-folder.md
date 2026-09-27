# The FM worklet is generated from a source folder

- Date: 2026-09-23
- Area: audio
- Links: issue #643 · epic #638 · amends `2026-08-31-audio-worklet-single-file` (the split it punted, behind the bundle step it named) · `2026-09-23-638-worklet-refactor-optimised-for-agents` (the plan this executes) · `2026-09-15-fm-voice-kernel-fixed-index-bit-identical` (what the bundle must not disturb)

## Decision

`packages/client/src/audio/worklet/fm/` is the FM worklet's source and
`worklet/generated/fm-processor.js` is its build output, written by
`scripts/build-worklets.mjs` and refused by `--check` (in `npm run verify`,
and by `scripts/lib/workletBundle.test.mjs` under `npm test`) when it differs
from a fresh bundle. The three consumers (Vite's `new URL`, the console's
blob-URL inline, the harness's `readFileSync`) read the generated file. This
ticket moved the file whole; #644 and #645 split it.

1. **The output moved; the consumers changed.** The ticket as first written
   kept `worklet/fm-processor.js` at its path so no consumer changed. It now
   lives under `generated/`, and each consumer's path is edited, because the
   code's maintainers are agents and a symbol grep must not land one in the
   output under an edit-inviting name. The folder is ignored by ESLint and
   Prettier and marked `linguist-generated` (collapsed in review), and the
   file is still tracked.
2. **The bundle transforms nothing.** esbuild with `bundle: true`,
   `format: 'esm'`, `target: 'esnext'`, `minify: false`,
   `treeShaking: false`, no legal comments, a two-line banner. Lowering or
   minifying could reorder an operation; tree shaking would drop the constants
   the harness reads by name (`ST_SUSTAIN`, `MIN_SEG_TIME`, …) that the DSP
   itself never references. The generated file is the source without its
   comments, 1488 lines against 1985, the same 13 `Math.fround` calls.
   Vite's `?worker&url` was weighed and rejected: it serves the game build
   only, and the console and the harness still need one file.
3. **Bit-identity is a kept test, landed first.** `fmProcessorGolden.test.ts`
   renders one chord per factory preset (151 today) through the default
   path, the generic loop (`specialise: false`) and the non-dormant path
   (`dormancy: false`), hashes each render and compares with
   `__fixtures__/fmGolden.json`. The table was written from the unmoved file
   in this PR's first commit, so passing after the move is the proof, and it
   stays as the gate for #644, #645 and every later DSP ticket. Refresh:
   `A204_REFRESH_FM_GOLDEN=1`, only when a render change is intended and said
   in the PR. Precedent: `headroom.contentHash` (#586).
   - **The non-dormant path is not bit-identical with the default**, on
     eight percussive presets (`kick`, `snare`, `weapon-zap`, `build-thunk`,
     four `score-*`). #547's contract is −120 dB
     (`fmProcessorDormancy.test.ts`), not the bit: a voice that sleeps is
     silenced exactly where the non-dormant one keeps a sub-floor residue.
     The epic's text called both reference paths sample-for-sample; the
     kernel's is, the dormant one is not. So the test holds the generic loop
     to the kernel's bits and pins the non-dormant path by its own row only.
     A move still cannot change any of the three rows.
4. **The rules live in `worklet/CLAUDE.md`**, in full: the output is
   generated, no allocation on the audio thread, bit-identity by construction
   with the #548 list of what breaks it, the golden test and its refresh
   command, the mirrored tables, and the module shape #644 and #645 follow.
   A nested `CLAUDE.md` loads whenever an agent touches a file under it,
   which the records do not.
5. **The header text is what an agent reads.** `--check`'s failure names
   the entry, the source folder and the rebuild command; the generated file's
   first two lines say the same. The `scripts/lib/workletBundle.mjs` table
   admits a second worklet as a second row; the reverb is not moved.

## Why

Pat, 2026-09-23: the code is maintained by AI agents, so the refactor is
optimised for them (`2026-09-23-638-worklet-refactor-optimised-for-agents`).
Every item above is that plan applied to this step. The single-file record's
reasoning was sound and is kept: the shipped artefact is still one
dependency-free script that `new URL` resolves with no bundler configuration,
and the bundle's job is to produce exactly that from many files.

The golden test caught a wrong premise on its first run, which is the kind
of thing it is for. An agent that trusted the epic's "sample-for-sample" for
dormancy would have written a comparison that fails on eight presets and then
had to discover why; the record now says why, and the `CLAUDE.md` says it
where the next agent will read it.

## Punted / alternatives

- **A merge driver for the generated file**, like the console page's
  (#628). Two audio branches that both rebuild it will conflict; a text
  merge of the bundle is usually right and `--check` confirms it. Add the
  driver when a conflict actually costs a round.
- **Source maps.** The bundle is the source minus comments, with esbuild's
  `// path` line at each module; a stack trace is readable enough without one.
- **Declaring `esbuild` at the root.** It arrives through `vite` and `tsx`,
  the way `tools/patch-editor/lib/audioBundle.mjs` already relies on it.
  Pinning it is a `package-lock` change for another ticket if it ever moves.
- **Running `--check` in CI as its own step.** CI runs `npm test`, which
  runs `workletBundle.test.mjs`'s "fresh bundle" case with real esbuild, the
  same way `patchLibraryIndex.test.mjs` covers the patch index. The
  `--check` script is the `verify` step, and its message is for a human or
  an agent at a terminal.
- **Bundling the reverb now.** A second row when a ticket wants it.
