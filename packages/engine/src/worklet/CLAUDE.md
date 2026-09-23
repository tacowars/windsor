# The DSP worklets

`meter/peakMeterProcessor.ts` is the opt-in stereo sample meter (#666),
bundled to `generated/peak-meter-processor.js` and checked by its own
`meter/tsconfig.json`. It samples every quantum on a silent, view-owned tap;
`mixer/peakMeterProcessor.test.ts` runs the generated processor and
`mixer/peakMeter.test.ts` checks its main-thread lifetime.

`compressor/compressorProcessor.ts` wraps the typed, tested compressor DSP in
`inserts/compressorDsp.ts`; it also bundles through the table below (#660).

The compressor adapter has its own `compressor/tsconfig.json`, included in
`npm run typecheck`. Like the FM project it erases declared class fields and
checks the audio thread separately from the main thread. It reuses
`fm/workletGlobals.d.ts`; the core and constants under `inserts/` also compile
under the main thread's stricter settings. `compressorDsp.test.ts` exercises
this generated processor, including its second input and telemetry.

`fm/` is the FM part processor's source. `generated/fm-processor.js` is its
build output. `reverb-processor.js` is the plate, still one hand-written file
(its own exception is at its top). The map of `fm/` (#644):

| Module | Owns |
|---|---|
| `fmProcessor.ts` | the entry: `FmPartProcessor` (the port, the event queue, voice allocation, `renderBlock`) and `registerProcessor` |
| `voice.ts` | `Voice`: one note's state and lifecycle (`start`, `rebind`, `retarget`, `release`, `kill`, `steal`, `dormant`); `render` and `updateControl` stay methods and delegate |
| `voiceControl.ts` | `bindVoiceConstants` and `updateVoiceControl`: the per-note constants and the control-rate update, functions over the voice |
| `voiceRender.ts` | `renderVoiceGeneric`: the generic sample loop, the reference the kernel matches |
| `voiceKernel.ts` | `renderVoiceKernel` (#548): the fixed-index kernel, one function, never sliced finer |
| `fmConstants.ts` | the tunables every other module imports, and `ENVELOPE_CURVE_STEEPNESS`, which the main thread re-exports (#656) |
| `waveIds.ts` | `WAVE`, the waveform ids, import-free: the main thread's `patch.ts` re-exports it (#656) |
| `waveTables.ts` | `SIN_TAB`, the mip tables and their cache, `waveKind`, the load-time warm-up |
| `algorithms.ts` | `ALGORITHMS` with each topology's name and label, the topological order, the kernel's edge and carrier tables; the main thread's `audioConstants.ts` re-exports the table and its type (#656) |
| `envelope.ts` | `Envelope`, the `ST_*` and `LOOP_*` ids, and the one curve — `curveShape`, `curveConstant`, `segmentLevel` — that `advance` runs and the console's display draws with (#656) |
| `lfo.ts` | `Lfo` and the `LFO_*` shapes |
| `svf.ts` | `Svf`, `softClip`, the `FILT_*` modes |
| `prng.ts` | `makeRandom`, `randomSeed32` |
| `patchNormalise.ts` | `normalisePatch`, `num`: a partial patch to a full one |
| `workletGlobals.d.ts` | the AudioWorkletGlobalScope names the DSP reads (`sampleRate`, `currentFrame`, `registerProcessor`, `AudioWorkletProcessor`), which `lib.dom` does not declare |
| `tsconfig.json` | the folder's own `tsc -p` project (#654): the client's settings with `noUncheckedIndexedAccess` and `useDefineForClassFields` off, and why |
| `*.test.ts` | direct tests of the leaf modules (#654): a module that warms the wave cache at load needs `sampleRate` on `globalThis` before a dynamic import |

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
   `A204_REFRESH_FM_GOLDEN=1 npx vitest run packages/client/src/audio/synth/fmProcessorGolden.test.ts`
   and says so in the PR; the patch files' `headroom` records may then need
   `tools/patch-editor/sweep-headroom.mjs` too.
   The table is pinned to Node 24's V8 (`.nvmrc`; the laptop and CI agree):
   under Node 22, nine pad and score presets hash differently because `Math`
   differs between V8 versions. A run on the wrong Node is not a render change.
5. **Four modules are read by the main thread too** (#656): `algorithms.ts`,
   `waveIds.ts`, `envelope.ts` and `fmConstants.ts`. `audioConstants.ts` and
   `patch.ts` re-export `ALGORITHMS`, `WAVE` and `ENVELOPE_CURVE_STEEPNESS`
   from them, and the console draws envelopes with `segmentLevel`, so there
   is one table and one curve, and no pin test. The four are listed in the
   client project's `files` and compile under its stricter flags as well:
   an indexed read in one of them takes a `!`, and none of them may touch
   the worklet scope (`sampleRate`) or the wave cache at load. The PRNG stays
   a copy of the shared package's `mulberry32`, pinned by `prng.test.ts`,
   because the worklet bundle cannot import `@aotearoa/shared` without
   carrying the whole package.
6. **Module shape** (#644, #645, #654): one concern per file, named after
   it, 100–350 lines, TypeScript, each opening with a header that says what it
   owns, the invariant it keeps and the test that pins it. A new concern is a
   new module and an import where it is used, not a section in an existing
   file. The hot paths are **functions over the voice** (`voice` is the first
   parameter, `this` never appears), split at per-render-call granularity:
   one call per control block or render chunk, never per sample. The kernel
   stays one function read top to bottom.
7. **Types erase; they never change the emitted code.** A class field is
   declared (`ic1: number;`) and written by the constructor, never
   initialised at the declaration: with define semantics a field would be
   emitted as `undefined` before the constructor writes a number, and V8
   then boxes every later double write to it (the #548 scenario read 336 ms
   against 182 ms, and the boxes are allocations on the audio thread), so
   `fm/tsconfig.json` turns `useDefineForClassFields` off. A nullable field
   read on a hot path takes a `!` (`voice.patch!`), never a `??` (a branch)
   or a default object (an allocation). `noUncheckedIndexedAccess` is off for
   the folder so that `amp[i] += x` stays as written. The diff of
   `generated/fm-processor.js` against its last JS build is the proof that
   the types cost nothing; the bench is the proof that the emit did not
   change shape.

Verify with the client's command, `npx tsc -p packages/client/src/audio/worklet/fm/tsconfig.json`
(also in `npm run typecheck`), then `node scripts/build-worklets.mjs --check`
and `node tools/patch-editor/build-editor.mjs` (the console page bundles the
generated file, so its bytes change with it).
