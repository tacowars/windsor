# The DSP worklets

`fm/` is the FM part processor's source. `generated/fm-processor.js` is its
build output. `reverb-processor.js` is the plate, still one hand-written file
(its own exception is at its top). The map of `fm/` (#644):

| Module | Owns |
|---|---|
| `fmProcessor.js` | the entry: `Voice` and `FmPartProcessor`, `registerProcessor` (the voice splits in #645) |
| `fmConstants.js` | the tunables every other module imports |
| `waveTables.js` | `WAVE`, `SIN_TAB`, the mip tables and their cache, `waveKind`, the load-time warm-up |
| `algorithms.js` | `ALGORITHMS`, the topological order, the kernel's edge and carrier tables |
| `envelope.js` | `Envelope`, `curveShape`, the `ST_*` and `LOOP_*` ids |
| `lfo.js` | `Lfo` and the `LFO_*` shapes |
| `svf.js` | `Svf`, `softClip`, the `FILT_*` modes |
| `prng.js` | `makeRandom`, `randomSeed32` |
| `patchNormalise.js` | `normalisePatch`, `num`: a partial patch to a full one |

Each module opens with a header saying what it owns, the invariant it keeps and
the test that pins it; its exports are one list at the end, so a move never
touches a code line. These rules are stated here in full, and not
by reference, because whoever edits this folder reads this file and does not
reliably read the records (`2026-09-23-638-worklet-refactor-optimised-for-agents`).

1. **`generated/` is output. Never edit it.** After any change under `fm/`,
   run `node scripts/build-worklets.mjs` and commit the result; `--check` in
   `npm run verify` refuses a copy that differs from a fresh bundle, and so
   does `scripts/lib/workletBundle.test.mjs`. Three consumers read the
   generated file and nothing else: Vite (`workletMessages.ts`, `new URL`),
   the console (`tools/patch-editor/build-editor.mjs` inlines it behind a blob
   URL, which cannot resolve an import) and the harness
   (`__fixtures__/workletHarness.ts`, `readFileSync` then `new Function`).
   The harness reaches internals by their **top-level names** (`ALGORITHMS`,
   `WAVE`, `Envelope`, `ST_SUSTAIN`, …), so a name stays unique across every
   module under `fm/`: esbuild renames a collision (`WAVE2`) and the harness
   then throws. The bundle transforms nothing (no minify, no lowering, no tree
   shaking); the settings and why are in `scripts/lib/workletBundle.mjs`.
2. **No allocation on the audio thread.** `process()` and everything it calls
   allocate nothing: no array, closure, spread, string or `Map` growth. A GC
   pause is an audible dropout. Preallocate in the constructor or `start`.
3. **Bit-identity by construction.** The fixed-index kernel (`renderKernel`,
   #548) and the generic loop (`specialise: false`) produce the same IEEE
   operations in the same order, and `fmProcessorKernel.test.ts` compares them
   to the bit. What breaks it: a reordered sum (`a + b + c` is not
   `a + (b + c)`); a `Math.fround` lost to a helper's return or a local hoisted
   onto `this` (a Float32Array store rounds, a double does not); a three-term
   list that is not ascending (`kernelEdges` refuses one); a term dropped that
   is not exactly ±0. A helper V8 inlines differently changes cost, not bits:
   bench it (#645). Dormancy (`dormancy: false`, #547) is held to −120 dB by
   `fmProcessorDormancy.test.ts`, not to the bit.
4. **The golden test is the gate.** `fmProcessorGolden.test.ts` hashes every
   factory preset's render in all three paths against
   `__fixtures__/fmGolden.json`. A refactor never refreshes it. A DSP change
   that is intended refreshes it with
   `A204_REFRESH_FM_GOLDEN=1 npx vitest run packages/client/src/audio/fmProcessorGolden.test.ts`
   and says so in the PR; the patch files' `headroom` records may then need
   `tools/patch-editor/sweep-headroom.mjs` too.
   The table is pinned to Node 24's V8 (`.nvmrc`; the laptop and CI agree):
   under Node 22, nine pad and score presets hash differently because `Math`
   differs between V8 versions. A run on the wrong Node is not a render change.
5. **Tables mirrored on the main thread.** `patch.ts` mirrors `ALGORITHMS` and
   `WAVE`; `envelopeCurve.ts` mirrors `Envelope`'s curve. `patch.test.ts` and
   `envelopeCurve.test.ts` fail when a copy drifts, until #656 shares them.
6. **Module shape** (#644 done, #645 next): one concern per file, named
   after it, 100–350 lines, each opening with a header that says what it owns,
   the invariant it keeps and the test that pins it. A new concern is a new
   module and an import in the entry, not a section in an existing file. The
   kernel stays one function read top to bottom. Plain JS until #654 converts
   the folder.

Verify with the client's command, then `node scripts/build-worklets.mjs --check`
and `node tools/patch-editor/build-editor.mjs` (the console page bundles the
generated file, so its bytes change with it).
