# The DSP worklets

`tape/` is the `tape` insert: REELS Lite's controls, EQ, motion and noise
(CC0, `docs/log/2026-09-30-reels-inspired-tape-insert.md`, which stands as
history) around Windsor's magnetic core, which replaced REELS's saturation
polynomial and makeup in windsor#224. Per channel: Bias and model EQ, ×
`driveGain(Drive)`, the core at 2× or 4×, the DC block, the transport delay,
hiss, dropouts, trim; Mix and bypass read the dry signal delayed by the core's
fixed 48 samples. `tapeProcessor.ts` owns lifetime/telemetry and the
parameters (`oversampling` is one, never a knob), `tapeDsp.ts` the signal
path, `tapeMagneticStage.ts` the two preallocated oversampler pairs, the
smoothed core controls and the dry ring, `tapeMagneticRows.ts` the models'
fixed core controls and their load-time floor check, `tapeFilter.ts` the
preallocated EQ and `tapeMotion.ts` seeded wear/noise. `TapeDsp.channel`
drives the pair through its `input`, `advance()` and `output` fields.
It builds `generated/tape-processor.js` and has its own TS project.
`inserts/tape*.test.ts` exercise the shipped bundle via `__fixtures__/tapeHarness.ts`;
`__fixtures__/tapeDspProbe.ts` runs it a sample at a time for the
`tapeMagneticIntegration*.test.ts` calibration, guard, delay and switch tests.
Record: `docs/log/2026-09-30-tape-magnetic-integration.md`.

`tape/tapeMagnetic.ts` and `tape/tapeOversample.ts` are the magnetic core
(windsor#219, epic #146 E1), written from the published Jiles–Atherton model:
the RK4 core with its field guard and knee, and the span-48 FIR pair that
reconstructs H and its exact derivative at every RK4 stage time.
Tunables and `driveGain` are in `inserts/tapeMagneticConstants.ts`.
Neither calls a transcendental `Math` function, whose results differ by an
ulp between V8's arm64 and x64 builds: sine, cosine, tanh and 2^x come from
`inserts/tapePortableMath.ts`, in IEEE arithmetic alone, so the render is the
same bits on the M1 and on CI.
Stage points travel in a `Float64Array` and results in fields, so no double
crosses a call; `render` is the block entry. The tests import the sources
directly, so the test project reads them under `noUncheckedIndexedAccess` and
an indexed read takes a `!`. `inserts/tapeMagnetic.test.ts` holds the core to
the research ruler `__fixtures__/tapeMagneticReference.json`, which
`scripts/tape-magnetic-fixtures.mjs` writes once and which is the only file
that touches `docs/research/`. `inserts/tapeOversample.test.ts` checks the
pair. `inserts/tapeMagneticGolden.test.ts` pins the render (refresh only with
`WINDSOR_REFRESH_TAPE_MAGNETIC_GOLDEN=1`) and reads the heap across `render`.
Record: `docs/log/2026-09-30-tape-magnetic-core.md`.

`advancedDrive/` is the five-route insert (#701), bundled as
`generated/advanced-drive-processor.js`. Its processor owns lifetime and load
reporting; `advancedDriveDsp.ts` owns smoothing, modulation and oversampling;
`driveRouting.ts`, `driveStage.ts`, `driveCrossover.ts`, `driveTone.ts` and
`driveOversample.ts` own the preallocated graph; `driveSlots.ts` lays the
controls out as Float64Array slots in descriptor order. Shared curves and filter
coefficients live in `inserts/advancedDriveCurves.ts` and
`advancedDriveFilter.ts` for the editor's displays. Its separate TS project
uses erased fields. Render tests use `__fixtures__/advancedDriveHarness.ts`.
The render allocates nothing (windsor#226): no double crosses a call as an
argument or a return (samples and operands pass through fields, and the
decibel gains and clamps are written in place, since the render exhausts
V8's inlining budget and then even a tiny helper stays a call), and every
double field is first written as one. `inserts/advancedDriveAllocation.test.ts`
pins it on V8 through `__fixtures__/advancedDriveChangeScenario.ts`.

`delay/` is the stereo/dub insert (#698), built as
`generated/delay-processor.js`: `delayDsp.ts` owns preallocated delay/filter
state and routing, and `delayProcessor.ts` owns controls/lifetime/telemetry.
Tests under `inserts/delay*.test.ts` use `__fixtures__/delayHarness.ts` to
exercise the shipped processor. Its separate `tsconfig.json` uses the
existing erased-field settings. Controls live in `inserts/delayConstants.ts`
and `delaySpec.ts`; song tempo is supplied through `tempoInsertRegistry.ts`.

`eq/` is the Parametric EQ (windsor#198), built as `generated/eq-processor.js`
with its own `tsconfig.json`. `eqProcessor.ts` owns the flat k-rate
parameters, stop and load reports; `eqDsp.ts` the block's route (bit-exact
copy when flat or bypassed, zeros when input and state are silent, else
pieces of 16 samples while anything moves) and the enable crossfade;
`eqBand.ts` one band's glides, type/slope/on fade and state; `eqSections.ts`
the TDF-II loops, the coefficient ramp across a gliding piece and the band
fade. The coefficients come from `inserts/eqCoefficients.ts` /
`eqSectionDesign.ts`, which the console's curve shares; the section forms pass
no double across a call, since V8 boxes one it does not inline, and every
double field (the band's, the DSP's, the forms' `v`) is first written as a
double, NaN until the first block snaps it (rule 7). Tests under
`inserts/eq*.test.ts` run the bundle through `__fixtures__/eqHarness.ts`,
which also reaches its hot functions by name for the rule 2 check;
`inserts/eqAllocation.test.ts` runs it in a child Node
(`__fixtures__/eqAllocationProbe.ts`) that reads the heap and V8's
`--trace-generalization` while every band toggles.

`phaser/` is the original four-stage stereo insert (#687):
`phaserProcessor.ts` owns controls/lifecycle/load reporting and `phaserDsp.ts`
owns the lossless lattice stages, feedback, envelope and sweep. It ships as
`generated/phaser-processor.js`, with its own `tsconfig.json`; tests under
`inserts/phaser*.test.ts` exercise it through `__fixtures__/phaserHarness.ts`.
Controls/defaults live in `inserts/phaserConstants.ts` / `phaserSpec.ts`,
and original editable starting points in `phaserPresetTables.ts`.
The render allocates nothing (windsor#231): samples pass through the DSP's
`input` and `output` Float64Array slots, not as arguments or returns, the
controls live in Float64Array slots rather than a record keyed by name, and
every double field is first written as NaN.
`inserts/phaserAllocation.test.ts` pins it on V8 through
`__fixtures__/phaserChangeScenario.ts`.

`retro/` is the original ROM-free vintage reverb insert (#682), built as
`generated/retro-reverb-processor.js`. `retroReverbProcessor.ts` owns the
worklet lifecycle/load reports; `retroReverbDsp.ts` owns host/internal-clock
conversion and mode blending; `retroTank.ts`, `retroReflections.ts`,
`retroDelay.ts` and `retroFilter.ts` own the two networks and storage/filter
primitives. Its separate `tsconfig.json` uses the same erased-field settings.
Tests under `inserts/retroReverb*.test.ts` run the generated processor through
`__fixtures__/retroReverbHarness.ts`. Settings and original tunables are in
`inserts/retroReverbSpec.ts` and `retroReverbConstants.ts`; the editable
approximation bank is `retroReverbPresets.ts` / `retroReverbPresetTables.ts`.
The render allocates nothing (windsor#230): samples cross every call in
fields (`inputLeft`/`inputRight`, `internalInput`, `convertInput`/`converted`,
each network's `input`, each line's `delay`/`output`/`input`, each filter's
`input`/`output`), never as arguments or returns, and every double field is
first written as NaN. `inserts/retroReverbAllocation.test.ts` pins it on V8
through `__fixtures__/retroReverbChangeScenario.ts`.

`meter/peakMeterProcessor.ts` is the opt-in stereo sample meter (#666),
bundled to `generated/peak-meter-processor.js` and checked by its own
`meter/tsconfig.json`. It samples every quantum on a silent, view-owned tap;
`mixer/peakMeterProcessor.test.ts` runs the generated processor and
`mixer/peakMeter.test.ts` checks its main-thread lifetime.

`outputStage/outputStageProcessor.ts` is the output stage's worklet adapter
(windsor#93), bundled to `generated/output-stage-processor.js`: the last node
before the destination, which the engine builds in `synth/fmEngine.ts`. It
owns the k-rate parameters (mode, ceiling, lookahead), the port and the
reused telemetry and load reports. The DSP is shared source in
`mixer/outputStageDsp.ts` over `outputStageLimiter.ts` and
`outputStageClipper.ts`: it also compiles in the main-thread project, but the
processor calls `OutputStageDsp.process` on every render quantum, so it is
audio-thread code and stays allocation-free. The node is in
`mixer/outputStage.ts`. Unlike the
other folders it has no `tsconfig.json` of its own: it compiles in the
engine's project under its stricter flags, declares the worklet-scope names
it reads, and `declare`s its class fields. `mixer/outputStageProcessor.test.ts`
runs the generated bundle through `__fixtures__/outputStageHarness.ts`, and
`mixer/outputStageGolden.test.ts` pins its render.

`compressor/compressorProcessor.ts` wraps the typed, tested compressor DSP in
`inserts/compressorDsp.ts`; it also bundles through the table below (#660).

The compressor adapter has its own `compressor/tsconfig.json`, included in
`npm run typecheck`. Like the FM project it erases declared class fields and
checks the audio thread separately from the main thread. It reuses
`fm/workletGlobals.d.ts`; the core and constants under `inserts/` also compile
under the main thread's stricter settings. `compressorDsp.test.ts` exercises
this generated processor, including its second input and telemetry.

`reverb/` is the plate's source (#671), bundled to
`generated/reverb-processor.js` and checked by its own `reverb/tsconfig.json`:
`reverbProcessor.ts` (the entry: `DattorroReverb`, its fields, the load
sampler, `process`, the sleep, `registerProcessor`), `delayLines.ts` (allocation,
the SIZE-scaled lengths and taps, the reads), `tank.ts` (`_writeInput` and
`_renderBlock`, the awake render) and `reverbConstants.ts` (the tunables and the
delay and tap tables). The delay lines and the tank are `this`-typed functions
installed on the processor's prototype, so each body is still the method the
hand-written file carried; `mixer/reverbGolden.test.ts` pins its render.

`fm/` is the FM part processor's source. `generated/fm-processor.js` is its
build output. The map of `fm/` (#644):

| Module | Owns |
|---|---|
| `fmProcessor.ts` | the entry: `FmPartProcessor` (the port, the event queue, voice allocation, `renderBlock`) and `registerProcessor` |
| `voice.ts` | `Voice`: one note's state and lifecycle (`start`, `rebind`, `retarget`, `release`, `kill`, `steal`, `dormant`); `render` and `updateControl` stay methods and delegate |
| `voiceControl.ts` | `bindVoiceConstants` and `updateVoiceControl`: the per-note constants and the control-rate update, functions over the voice |
| `voiceRender.ts` | `renderVoiceGeneric`: the generic sample loop, the reference the kernel matches |
| `voiceKernel.ts` | `renderVoiceKernel` (#548): the fixed-index kernel, one function, never sliced finer |
| `fmConstants.ts` | the tunables every other module imports, and `ENVELOPE_CURVE_STEEPNESS`, which the main thread re-exports (#656) |
| `waveIds.ts` | `WAVE`, the waveform ids, import-free: the main thread's `patch.ts` re-exports it (#656) |
| `modeIds.ts` | the `LOOP_*`, `FILT_*` and `LFO_*` ids and the `LOOP_MODE`, `FILTER_MODE` and `LFO_SHAPE` objects built from them, import-free: `patch.ts` re-exports the objects (#669) |
| `waveTables.ts` | `SIN_TAB`, the mip tables and their cache, `waveKind`, the load-time warm-up |
| `algorithms.ts` | `ALGORITHMS` with each topology's name and label, the topological order, the kernel's edge and carrier tables; the main thread's `audioConstants.ts` re-exports the table and its type (#656) |
| `envelope.ts` | `Envelope`, the `ST_*` ids, and the one curve — `curveShape`, `curveConstant`, `segmentLevel` — that `advance` runs and the console's display draws with (#656) |
| `lfo.ts` | `Lfo` |
| `svf.ts` | `Svf`, `softClip` |
| `prng.ts` | `makeRandom`, `randomSeed32` |
| `patchDefaults.ts` | every default a patch may omit, the `tone` and feedback clamp bounds and `OPERATOR_COUNT`, import-free but for the two id modules: `normalisePatch` and the main thread's `makePatch()` both fill from it, and `audioConstants.ts` re-exports `OPERATOR_COUNT` (#670) |
| `patchNormalise.ts` | `normalisePatch`, `num`: a partial patch to a full one, from `patchDefaults.ts` |
| `stepModTables.ts` | `STEP_MOD_TABLE` (windsor#17): one row per `StepModParam` (bounds, span, curve, `slideKeeps`) and `STEP_MOD_LANES_MAX`; the main thread's sequencer, song normaliser and index read it |
| `stepModValue.ts` | `stepModValue`: the one step modulation curve, a row and a lane value over the patch's own; 0 returns the base untouched. The voice binds with it and the index re-exports it |
| `voiceStepMod.ts` | `loadStepOffsets` and `bindStepMod`: a note-on's offsets into the voice's preallocated slots, and the per-voice values the control update, envelopes and render loops read in place of the patch's |
| `workletGlobals.d.ts` | the AudioWorkletGlobalScope names the DSP reads (`sampleRate`, `currentFrame`, `registerProcessor`, `AudioWorkletProcessor`), which `lib.dom` does not declare |
| `tsconfig.json` | the folder's own `tsc -p` project (#654): the engine's settings with `noUncheckedIndexedAccess` and `useDefineForClassFields` off, and why |
| `*.test.ts` | direct tests of the leaf modules (#654): a module that warms the wave cache at load needs `sampleRate` on `globalThis` before a dynamic import |

Each module opens with a header saying what it owns, the invariant it keeps and
the test that pins it; its exports are one list at the end, so a move never
touches a code line. These rules are stated here in full, and not
by reference, because whoever edits this folder reads this file and does not
reliably read the records (`2026-09-23-638-worklet-refactor-optimised-for-agents`).

1. **`generated/` is output. Never edit it.** After any change under `fm/`
   (or `reverb/`, `compressor/`, `meter/`, `retro/`, `phaser/`, `delay/`, `advancedDrive/`, `eq/`,
   `outputStage/`, `tape/`, or the `mixer/outputStage*` modules its processor imports),
   run `node scripts/build-worklets.mjs` and commit the result; `--check` in
   `npm run verify` refuses a copy that differs from a fresh bundle, and so
   does `scripts/lib/workletBundle.test.mjs`. Two consumers read the
   generated file and nothing else: the browser, through Vite
   (`workletMessages.ts`'s `new URL(…, import.meta.url)`, emitted by the
   app's build as a separate asset and loaded by `audioWorklet.addModule`,
   which is why the file must be one self-contained script) and the harness
   (`__fixtures__/workletHarness.ts`, `readFileSync` then `new Function`; the
   plate's is `__fixtures__/reverbHarness.ts`, which reads `MAX_SIZE`,
   `TANK_DELAYS`, `MAX_PRE_DELAY` and the sleep floors the same way).
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
   `A204_REFRESH_FM_GOLDEN=1 npx vitest run packages/engine/src/synth/fmProcessorGolden.test.ts`
   and says so in the PR. The plate's gate is
   `mixer/reverbGolden.test.ts` against `__fixtures__/reverbGolden.json` (#671):
   fifteen scenarios in the default, `sleep: false` and `settledSkip: false`
   paths, refreshed only with
   `A204_REFRESH_REVERB_GOLDEN=1 npx vitest run packages/engine/src/mixer/reverbGolden.test.ts`.
   The table is pinned to Node 24's V8 (`.nvmrc`; the laptop and CI agree):
   under Node 22, nine pad and score presets hash differently because `Math`
   differs between V8 versions. A run on the wrong Node is not a render change,
   and the test's guard says so in one failure before it renders (windsor#6).
5. **Eight modules are read by the main thread too** (#656): `algorithms.ts`,
   `waveIds.ts`, `envelope.ts`, `fmConstants.ts`, `modeIds.ts` (#669:
   `patch.ts` re-exports `LOOP_MODE`, `FILTER_MODE` and `LFO_SHAPE`),
   `patchDefaults.ts` (#670: `makePatch()` fills from it, and
   `patchDefaults.test.ts` pins its fill equal to `normalisePatch`'s), and
   `stepModTables.ts` and `stepModValue.ts` (windsor#17: the sequencer and
   the song normaliser read the table, and the index exports both, so a
   console and the voice compute a step's value with one curve). `audioConstants.ts` and
   `patch.ts` re-export `ALGORITHMS`, `WAVE` and `ENVELOPE_CURVE_STEEPNESS`
   from them, and the console draws envelopes with `segmentLevel`, so there
   is one table and one curve, and no pin test. The eight are listed in the
   engine project's `files` (`packages/engine/tsconfig.json`) and compile
   under its stricter flags as well:
   an indexed read in one of them takes a `!`, and none of them may touch
   the worklet scope (`sampleRate`) or the wave cache at load. The PRNG stays
   a copy of the main thread's `sequencing/mulberry32.ts`, pinned line for
   line by `prng.test.ts`, so the worklet bundle imports nothing it would
   have to carry.
6. **Module shape** (#644, #645, #654): one concern per file, named after
   it, 100–350 lines, TypeScript, each opening with a header that says what it
   owns, the invariant it keeps and the test that pins it. A new concern is a
   new module and an import where it is used, not a section in an existing
   file. The hot paths are **functions over the voice** (`voice` is the first
   parameter, `this` never appears), split at per-render-call granularity:
   one call per control block or render chunk, never per sample. The kernel
   stays one function read top to bottom.
   The plate is the one exception (#671): its delay lines and tank are
   `this`-typed functions installed on `DattorroReverb.prototype`, because the
   move kept every method body byte for byte; turning them into functions
   over the plate rewrites every line and is its own change, with a bench.
7. **Types erase; they never change the emitted code.** A class field is
   declared (`ic1: number;`) and written by the constructor, never
   initialised at the declaration: with define semantics a field would be
   emitted as `undefined` before the constructor writes a number, and V8
   then boxes every later double write to it (the #548 scenario read 336 ms
   against 182 ms, and the boxes are allocations on the audio thread), so
   `fm/tsconfig.json` turns `useDefineForClassFields` off (and so does
   `reverb/tsconfig.json`, whose `DattorroReverb` declares its thirty-four
   fields and `declare`s the prototype-installed functions, which emit nothing). A nullable field
   read on a hot path takes a `!` (`voice.patch!`), never a `??` (a branch)
   or a default object (an allocation). `noUncheckedIndexedAccess` is off for
   the folder so that `amp[i] += x` stays as written. The diff of
   `generated/fm-processor.js` against its last JS build is the proof that
   the types cost nothing; the bench is the proof that the emit did not
   change shape.

Verify with `npx tsc -p packages/engine/src/worklet/fm/tsconfig.json` (and
each other folder's `tsconfig.json`; all are in `npm run typecheck`), then
`node scripts/build-worklets.mjs --check`, the tests, and `npm run build`
(the app emits each generated file as its own asset); `npm run verify` runs
them all.
