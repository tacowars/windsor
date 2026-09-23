# The FM worklet's leaf units are modules

- Date: 2026-09-23
- Area: audio
- Links: issue #644 · epic #638 · builds on `2026-09-23-643-fm-worklet-is-generated-from-a-source-folder` · the plan `2026-09-23-638-worklet-refactor-optimised-for-agents` · next `#645`

## Decision

Everything `Voice` and the processor depend on, and that depends on neither,
is now its own module under `worklet/fm/`: `fmConstants.js`, `waveTables.js`,
`algorithms.js`, `envelope.js`, `lfo.js`, `svf.js`, `prng.js`,
`patchNormalise.js`. `fmProcessor.js` is the entry and holds `Voice`, the
processor and `registerProcessor` until #645. The bundle is bit-identical:
the golden table (#643) passed unchanged for every preset in all three
paths, and every code line of the modules is a line of the original file.

1. **A constants module, though the ticket did not list one.** The tunables
   at the file top are read by the wave tables, the envelope, the filter and
   the voice alike, and the entry cannot export them to modules it imports.
   `fmConstants.js` is the repo's "data separately from logic" shape
   (`<area>Constants`), and #654's `no-magic-numbers` will want it anyway.
2. **`waveKind` and the load-time warm-up live with the wave tables.** Both
   are about waveforms, not the voice; the warm-up runs at module evaluation,
   which esbuild orders before the entry's body as it was before. `Svf` and
   `softClip` share a module, as the ticket allowed.
3. **Exports are one list at the end of each module.** `export { … };` after
   the code, never `export` on a declaration, so the diff is a move and a
   reviewer can see that no code line changed. Imports are named, from the
   sibling file, with the `.js` extension esbuild and Node both resolve.
4. **Top-level names stay unique across the folder.** The harness evaluates
   the bundle and reads `ALGORITHMS`, `WAVE`, `Envelope`, `ST_SUSTAIN` and
   the rest by name; esbuild hoists every module's declarations into one
   scope (as `var`, a `class` as `var X = class`) and renames only a
   collision. No collision, no rename, every handle intact. `worklet/CLAUDE.md`
   rule 1 states this for the next split.
5. **Each module opens with its contract** (the plan's item 4): what it owns,
   the invariant it keeps, the test that pins it. The `SIN_TAB` and
   `WAVE_CACHE` single-instance rule, the ascending-list rule of
   `kernelEdges`, the mirrored copies in `patch.ts` and `envelopeCurve.ts`,
   are each stated where the code is.
6. **The entry's header is rewritten here.** #643 meant to rewrite it and
   lost the edit to a `git restore` against the staged rename, so the merged
   file still said it "has no imports"; it now describes the folder and
   points at the module each architecture line lives in.

## Why

The ticket's cut, plus the four calls it left open. The constants module is
the only structural addition; the alternative, leaving the tunables in the
entry and passing them in, would change hot-path code, which a move may not.

The line-level purity check (every non-comment, non-import line of the new
modules is a line of the original, 1425 both ways) is what "pure move" means
for a reviewer who is an agent: the golden test says the bits are the same,
the purity check says why.

The Codex pass turned up one fact worth keeping: run under Node 22, nine
presets (`pad-drift` and eight `score-*`) fail the golden table, and fail it
against the original file too. The hashes are pinned to Node 24's V8
(`.nvmrc`), which the laptop and CI share; `worklet/CLAUDE.md` rule 4 now
says so, so the next agent on the wrong Node does not read it as a render
change.

## Punted / alternatives

- **Direct per-module tests.** #654: a `.ts` test importing an untyped `.js`
  module fails `tsc` under `strict`. Until then the harness reaches each unit
  through the bundle, as before.
- **Sharing `WAVE`, `ALGORITHMS` and the envelope curve with the main
  thread.** #656; the mirrored copies and their pin tests stay.
- **Finer modules** (a file per `ST_*`/`LOOP_*` enum, `curveShape` alone). A
  30-line module costs an agent a read without saving one.
