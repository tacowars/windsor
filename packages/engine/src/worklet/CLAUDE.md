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
The render allocates nothing (windsor#228): the processor writes each frame
to `TapeDsp.input` and calls `step` (`tick(left, right)` is the tests'
entry), a channel leaves its sample in `sample`, a tone filters its own
`value` in `advance`, the motion reads its amounts from fields and draws into
`drawn`, the controls are read by name each block into a class born NaN, and
every double field is first written as NaN. The dropout roll is written in
`TapeMotion.advance`, not called, and both oversampler pairs stay configured,
so a factor switch only resets: paths that rare stay in V8's lower tiers,
which box. `inserts/tapeAllocation.test.ts` pins it on V8 through
`__fixtures__/tapeChangeScenario.ts`.

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
The render allocates nothing (windsor#232): the controls are Float64Array
slots (`delaySlots.ts`), a sample and a line's read or write pass through
fields, and every double field is first written as NaN.
`inserts/delayAllocation.test.ts` pins it on V8 through
`__fixtures__/delayChangeScenario.ts`.

`eq/` is the Parametric EQ (windsor#198), built as `generated/eq-processor.js`
with its own `tsconfig.json`. `eqProcessor.ts` owns the flat k-rate
parameters, stop and load reports; `eqDsp.ts` the block's route (bit-exact
copy when flat or bypassed, zeros when input and state are silent, else
pieces of 16 samples while anything moves) and the enable crossfade;
`eqBand.ts` one band's glides, type/slope/on fade and state; `eqSections.ts`
the TDF-II loops, the coefficient ramp across a gliding piece and the band
fade; `eqListen.ts` Listen on drag (windsor#200), a band-pass of the input
at the held band crossfaded over the route's output, which runs only while
a band is heard, so the render with Listen off is the route's alone
(`inserts/eqListen.test.ts` pins it to the windsor#198 bundle's hash). Its
start computes no double, since it runs too seldom for V8 to optimise and
unoptimised code boxes every double; the first quantum's glide snaps
instead. The coefficients come from `inserts/eqCoefficients.ts` /
`eqSectionDesign.ts`, which the console's curve shares; the section forms pass
no double across a call, since V8 boxes one it does not inline, and every
double field (the band's, the DSP's, the forms' `v`) is first written as a
double, NaN until the first block snaps it (rule 7). Tests under
`inserts/eq*.test.ts` run the bundle through `__fixtures__/eqHarness.ts`,
which also reaches its hot functions by name for the rule 2 check;
`inserts/eqAllocation.test.ts` runs it in a child Node
(`__fixtures__/workletAllocationProbe.ts`, launched by
`__fixtures__/workletAllocation.ts` and driven by
`__fixtures__/eqToggleScenario.ts`) that reads the heap and V8's
`--trace-generalization` while every band toggles and Listen moves from
band to band.

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

`filter/` is the Filter insert (windsor#622), built as
`generated/filter-processor.js` with its own `tsconfig.json` (`fm/`'s flags,
since it compiles `fm/` modules through its imports, and Node's types for its
tests). It runs the voice's filter and copies none of it: `filterDsp.ts`
imports `Svf` and `tuneSvfSections` from `fm/svf.ts`, `Ladder` from
`fm/ladder.ts` and `tuneLadder` from `fm/ladderTune.ts`, one `svfA`, `svfB`
and `Ladder` a channel, so **an edit to any of those three rebuilds both
`fm-processor.js` and `filter-processor.js`**, and `--check` refuses either
left stale. `filterProcessor.ts` owns the params and lifetime, `filterGlide.ts`
the sweep (retuned every `CTRL_INTERVAL` frames, the cutoff geometric and the
Reso linear across a quantum). Controls and defaults are
`inserts/filterConstants.ts` / `filterSpec.ts`.
`worklet/filter/filterBundle.test.ts` holds the bundle to the bit against
`fm/`'s classes imported directly (so the folder is excluded from the engine's
test project, as `fm/` is); `inserts/filter*.test.ts` run the bundle through
`__fixtures__/filterHarness.ts`, and `inserts/filterAllocation.test.ts` pins
rules 2 and 7 through `__fixtures__/filterChangeScenario.ts`.

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

`meter/` holds the two sample meters, bundled together from
`meter/meterProcessors.ts` to `generated/peak-meter-processor.js` (so the
engine's one `addModule` loads both, and a harness picks one by its
registered name) and checked by its own `meter/tsconfig.json`.
`peakMeterProcessor.ts` is the opt-in stereo meter on a silent, view-owned
tap (#666); `partMeterBankProcessor.ts` is the part meter bank (windsor#540):
one node with an input per music part, posting one packed `Float32Array` of
every part's report, its layout in `mixer/partMeterBankConstants.ts`. Both
run each channel through `channelPeak.ts`, the one copy of the ballistics,
whose silence (a missing channel) has a loop of its own: merging
`samples?.[i] ?? 0` boxed every sample on V8. `mixer/peakMeterProcessor.test.ts`
and `mixer/partMeterBankProcessor.test.ts` run the generated processors,
`mixer/partMeterBankAllocation.test.ts` reads the bank's heap through
`__fixtures__/partMeterBankScenario.ts`, and `mixer/peakMeter.test.ts` and
`mixer/partMeterBank.test.ts` check the main-thread lifetimes.

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
| `fmProcessor.ts` | the entry: `FmPartProcessor` (the port, the note map as each voice's `keyed` flag, `renderBlock`, which admits posted notes and reads each message) and `registerProcessor` |
| `eventQueue.ts` | `EventQueue` (windsor#233): the note events in frame order, their frames in a `Float64Array` beside them, inserted in place and taken by an index, never `splice` or `shift`; and the messages `post`ed since the last quantum, unread until the render admits them (windsor#270) |
| `voiceAllocation.ts` | `allocateVoice`: which voice of the pool a note takes, and the stealing order (dormant, then the quietest released, then the oldest held; windsor#410) |
| `voiceSteal.ts` | what a steal does (windsor#410): the pool's size and its reserve slots' seeds, the 30 ms fade from the voice's current level, the quietest released voice, and the fading voice an exhausted pool cuts |
| `voice.ts` | `Voice`: one note's state and lifecycle (`start`, `rebind`, `retarget`, `release`, `kill`, `steal`, `dormant`); `render` and `updateControl` stay methods and delegate |
| `voiceControl.ts` | `bindVoiceConstants` and `updateVoiceControl`: the per-note constants and the control-rate update, functions over the voice |
| `voiceControlInterval.ts` | `controlInterval` and its table (windsor#326): each voice's next control interval from its state at each control boundary, `CTRL_INTERVAL` (32) while anything is fast (an envelope segment under 0.1 s, a looping amplitude envelope, a glide under 0.1 s, an LFO that reaches anything at 8 Hz or faster or in a shape that jumps, a feedback lane's ramp, and, in a voice with a synced operator, an operator's ratio under an LFO's `toRatio` or a lane, windsor#655) and `CTRL_INTERVAL_LONG` (128) while nothing is. Reads only, after the lanes are on the voice; `updateVoiceControlBlock` asks it. With the table's `long` at its `fine` the part renders as before, which `synth/fmProcessorControlInterval.test.ts` pins against `__fixtures__/fmGoldenFineInterval.json` |
| `voiceRender.ts` | `renderVoiceGeneric`: the generic sample loop, the reference the kernel matches, and the one path a synced voice takes (windsor#646), the direct shape's read and delay included (windsor#655) |
| `voiceKernel.ts` | `renderVoiceKernel` (#548): the fixed-index kernel, one function, never sliced finer |
| `voiceSync.ts` | hard sync (windsor#646, record `2026-10-09-operator-hard-sync`): `VoiceSync` (each operator's master, the synced, corrected and master bits, the chain order, the note master's phase, each corrected operator's held sample and owed correction), `bindVoiceSync` (from `bindVoiceConstants`; a synced voice is refused the kernel, a synced Noise operator is left unsynced) and `applySyncResets`, which the generic loop calls only on a sample where a master wrapped: in chain order, each synced operator whose master's phase sits below that master's increment restarts at `d` times its own, and a corrected wave's step, taken at the reset instant (the table at phase 0 less the table at the free-running phase just before the reset, at the sample's modulation and width, read at the table's own length), is split into the two-sample polyBLEP (`SYNC_BLEP_GAIN`) between the sample it holds and the next. Only the Sine, Triangle and User waves are corrected; a corrected operator sends its wave a sample late, after its feedback tap and before its own filters. A Saw, Square or Pulse the direct shape takes (`voiceSyncShape.ts`) is sent late the same way; any other, Saw D, Square D and the bit-crushed sines are neither corrected nor delayed |
| `voiceSyncShape.ts` | the synced Saw, Square and Pulse's direct shape (windsor#655, record `2026-10-09-sync-direct-shape`): `SyncShape` on `VoiceSync.shape`, `syncShapeKind` (at the bind: synced, no modulator edge into it in the algorithm, Tone 1), `beginSyncShapeBlock` (each render call: of those, the ones with live feedback exactly 0 and, but for a Pulse, width exactly 1; the level `g` read off the current table's fundamental at its own stride; one leaving the shape drops what its next sample owes) and `syncShapeEdges` (each sample after the resets: the free-running wraps and duty edges, a Pulse's duty edge moving with its width's ramp across the sample, the reset's step from the left limit, a duty edge after it, each a two-point polyBLEP summed into `held` and `after`; then the next sample's wave). An eligible operator is sent a sample late on its shape or its table, so a switch neither skips nor repeats a sample |
| `fmConstants.ts` | the tunables every other module imports, and `ENVELOPE_CURVE_STEEPNESS`, which the main thread re-exports (#656) |
| `waveIds.ts` | `WAVE`, the waveform ids, import-free: the main thread's `patch.ts` re-exports it (#656) |
| `modeIds.ts` | the `LOOP_*`, `FILT_*`, `LFO_*` and `DRIVE_*` ids and the `LOOP_MODE`, `FILTER_MODE`, `LFO_SHAPE` and `DRIVE_SHAPE` objects built from them, import-free: `patch.ts` re-exports the objects (#669, windsor#300) |
| `waveTables.ts` | `SIN_TAB`, the mip tables and their cache, `waveKind`, the load-time warm-up; each octave's table is sized to its highest harmonic (`MIP_TABLE_RATIO`, 2048 to `TABLE_SIZE_MAX`), so a table of few harmonics stays at 2048 and keeps its bits, and the loops scale the phase by each table's own length (record `2026-10-09-wavetables-sized-to-their-harmonics`) |
| `waveTableFft.ts` | `sineSeriesByFft`: the inverse FFT that builds a table longer than 2048 from its harmonics, over a preallocated scratch and Float32 twiddles read at a stride, about 3 ms for a saw's set where summing took 34 |
| `algorithms.ts` | `ALGORITHMS` with each topology's name and label, the topological order, the kernel's edge and carrier tables; the main thread's `audioConstants.ts` re-exports the table and its type (#656) |
| `envelope.ts` | `Envelope`, the `ST_*` ids, and the one curve — `writeSegmentLevel` over a segment's fields, which `advance` runs and the console's `segmentLevel` wraps, and its two steps `curveConstant` and `curveShape` (#656, windsor#233) |
| `lfo.ts` | `Lfo` |
| `svf.ts` | `Svf`, the TPT state-variable section (the soft clip it once held is the drive's `soft` since windsor#300); the voice holds three, `svfA`, `svfB` and `svfC`, the third for the Formant mode alone, and a section keeps its Formant peak's `gain` and level beside its coefficients (windsor#331); and `tuneSvfSections`, the serial modes' tuning that the voice and the filter insert share: `a` from its own cutoff and Q, and at the 24 dB slope `b` following `a`'s cutoff at `SVF24_SECOND_STAGE_Q` (windsor#595) |
| `voiceFormant.ts` | `updateVoiceFormant` and `FORMANT_SHIFT_SLOT` (windsor#331): the Formant mode's control-rate half, the three peaks' centres from the vowel's row morph times the filter modulation's `2^octaves`, one Q from the resonance, and each peak's gain, its level over that Q. A section whose inputs are unchanged keeps its coefficients, and an unchanged level its power of ten. Both render loops write the three bandpasses out in parallel and sum them A, B, C, with no call |
| `formantTables.ts` | `FORMANT_VOWELS` (windsor#331): a, e, i, o, u, each three formant centres (Hz) and levels (dB), the Csound Manual's bass voice; import-free, the index exports it |
| `ladder.ts` | `Ladder` (windsor#573, record `2026-10-04-acid-ladder-filter-mode`): the Acid mode's TB-303 diode ladder, Stinchcombe's four coupled capacitor states (the bottom one half the others) with the input and the feedback saturating together in the input pair and the feedback through a one-pole high-pass, and the output mix after the solve (windsor#577: the output plus `LADDER_MIX_GAIN` × p of it through a second one-pole high-pass, skipped at p = 0). `process` takes a sample from `point` and leaves it there: the trapezoidal step in integrator-memory form, a fixed `steps` Newton steps on the four states with the 4 × 4 Jacobian eliminated written out, tanh the rational of `ladderTables.ts` and its slope the rational's own derivative, so no `Math` transcendental and the same bits on arm64 and x64. The voice ships `oversample` 2 (two sub-steps on a linearly interpolated input, then the decimator) with three steps (windsor#593, record `2026-10-04-acid-ladder-ships-2x-and-reso-17-2`); 1× stays selectable for the research bench. Its `chunk` holds a render chunk's input; `reset` at a note's start, `quiet` for dormancy |
| `ladderTune.ts` | `tuneLadder` (windsor#573): the ladder's control-rate tuning (the cutoff held to 20 Hz..10 kHz and below the rate's ceiling, to the prewarped step through `tanInPlace`; the Reso to the feedback k = 17.2 p on its log scale through `log2InPlace` (windsor#593), to the output mix's gain and to the makeup; the two high-passes' coefficients once per rate; each only when its input changed). The filter insert imports it as well as the voice, so it imports nothing from `voice.ts` or any `voice*` module |
| `voiceLadder.ts` | `updateVoiceLadder` and `renderVoiceLadder` (windsor#573): the live Reso onto the ladder, then `tuneLadder`, once per control block; and the pass over a render chunk after either loop: the chunk through the ladder, then the steal fade and the pan, added into the part's accumulators |
| `ladderTables.ts` | `LADDER_SATURATOR` (windsor#573): tanh as the [7/6] Lambert rational held at ±1 past its limit, within 1e-4 of `Math.tanh`; and the 2× solver's decimator taps, read on every Acid sample since windsor#593 |
| `voiceDrive.ts` | `VoiceDrive` and `updateVoiceDrive` (windsor#300): the voice's drive stage between the carriers and the filter, heard with the filter on or off. Its state, its five curves by `DRIVE_SHAPE` id (`soft`, the filter's former soft clip to the bit, then Advanced Drive's `hard`, `diode`, `tube` and `fold` in portable arithmetic) and its control-rate half (the bypass, which is the patch's `drive.on` switch or unity gain with no bias, windsor#309; the bias's offset; the tone pole's coefficient). Both render loops write the per-sample stage out, `soft` and the tone inline. |
| `portablePowers.ts` | `log2InPlace` and `exp2InPlace` (windsor#300): base-2 log and power in place, from `+ − × ÷` and a double's bits, so the diode curve and the tone's cutoff give the same bits on arm64 and x64 |
| `operatorFilter.ts` | `OperatorFilter` and `bindOperatorFilter` (windsor#362; every wave since windsor#590, record `2026-10-04-operator-filters-on-every-wave`): an operator's own two-pole Butterworth lowpass and highpass on its wave, from its `opLp` and `opHp` (0 off), each moved by `opTrack` octaves an octave of the played note from middle C (`2^(opTrack (note − 60) / 12)` through `exp2InPlace`), held to 20 Hz..0.45 fs. Four to a voice; `bindVoiceConstants` tunes them when the voice binds a patch or its note (a note-on, a rebind, a slide's `retarget`), retuning a section only when its effective cutoff changed. The filter sits after the operator's feedback tap: `fb1`/`fb2` take the raw wave, `out` the filtered one. The generic loop calls `process` through `point` while one is on; the kernel writes `process` out per operator, its operations in its order, and never skips an operator whose filter is on |
| `portableTangent.ts` | `tanInPlace` (windsor#362): the tangent in place over `tapePortableMathTables.ts`, for the operator filters' prewarp, the same bits on arm64 and x64 |
| `prng.ts` | `makeRandom`, `randomSeed32` |
| `patchDefaults.ts` | every default a patch may omit, the `tone` and feedback clamp bounds and `OPERATOR_COUNT`, import-free but for the two id modules: `normalisePatch` and the main thread's `makePatch()` both fill from it, and `audioConstants.ts` re-exports `OPERATOR_COUNT` (#670) |
| `patchNormalise.ts` | `normalisePatch`, `num`: a partial patch to a full one, from `patchDefaults.ts` |
| `voiceTargetTables.ts` | the voice's modulation targets (windsor#419; each operator's ratio its sixth row, windsor#646, read where `advanceVoiceControl` works out the frequency, after which both LFOs' `toRatio` apply): one row per value a source may move on a sounding voice (path, curve `add` or `ratio`, bounds, ratio floor, step span, `slideKeeps`), in code order, the row's index its code everywhere (a song lane's slot, a note-on's step array, the voice's arrays); the `VT_*` codes and the rows as typed arrays. Data only, with no look or name: a target's look and name live once in the automation catalog (`VOICE_LOOKS` / `OPERATOR_LOOKS` in `automation/automationTargetTables.ts`, windsor#424). The extension point: a new target is a row here, one line in `layoutVoiceTargets`, a look in the catalog, and a read of `liveValues` at its point of effect |
| `voiceTargetValue.ts` | `voiceTargetValue` and `stepModValue`: the one curve on the main thread, an offset (or a step value times its span) over the patch's own; 0 returns the base untouched. The voice writes the same arithmetic out in place, and the index re-exports it |
| `voiceTargets.ts` | `layoutVoiceTargets` (windsor#419): the patch's value for every target, by code, into an array; the one place on the audio thread that maps a path to a code |
| `voiceStepMod.ts` | `loadStepOffsets` and `bindOwnValues`: a note-on's step array (one value per target, 0 past its end, junk 0) into the voice's preallocated `stepOffsets`, and `ownValues`, the patch's values by code with each step value moved in its row's curve; the note-on, retarget and rebind entry points |
| `macroMappings.ts` | `effectiveMacroMappings`, `macroMapsTarget` (windsor#560): the mappings the voice applies for a patch (the first `MACROS_MAX` macros, the first `MACRO_MAPPINGS_MAX` mappings of each, voice targets that are not macros, the first mapping per target), normalised; `normalisePatch` builds the macros' mappings from it and the main thread reads the same list |
| `macroShape.ts` | `macroMappedValue` (windsor#566): what a mapping plays at a macro value, the voice's shaping as one scalar for the main thread (the index exports it), held to `voiceMacros.ts` over a sweep by `macroShape.test.ts` |
| `voiceMacros.ts` | a patch's macros on the voice (windsor#560, record `2026-10-04-patch-macro-knobs`): `compileMacros`, the mappings as typed arrays on the normalised patch (`MacroTables`, so `WorkletPatch` is `Patch & MacroTables`), at construction and at each `patch` message, a ratio row's ends raised to its floor and `log2(max / min)` worked out there; and `applyMacroBases`, each mapped target's base from its macro's shaped value (Linear, Exp, Log, S, inverted first; geometric on a ratio row through `exp2InPlace`) with the step's push over it, ignoring any lane on it. `bindOwnValues` and `bindLiveValues` call it after the macro rows resolve; a patch with no mappings never does |
| `voiceOffsets.ts` | the song lanes on the voice (windsor#346, windsor#347): `VOICE_SLOT_COUNT` and the slots' parameter names, `mapVoiceSlots` (a slot map to target codes, at a message; the cutoff is a slot like any other since windsor#419), `latchVoiceOffsets` (the slots into the part's offsets, each quantum), `applyVoiceOffsets` (each control block: `liveValues`, the own value where no lane moves a target and otherwise the lane's absolute value with the step's push over it, then the feedback ramp's ends, the LFOs' absolute `rate`, and the decays into the envelopes, a changed curve through `Envelope.reshapeDecay`), and `primeVoiceOffsets` / `keepVoiceOffsets` + `rebindVoiceOffsets` for a note-on and a live retune. Only a lane's offset changing reshapes a decay, never a rebind: a curve a lane holds over an edited base stays as it plays until the lane resyncs (`decayRebound`). An offset of 0 changes nothing, to the bit, except that a decay time or an LFO rate a slot maps plays at least its row's floor, 1 ms or 0.02 Hz (`partFloors`); a part with no slot mapped floors nothing |
| `workletGlobals.d.ts` | the AudioWorkletGlobalScope names the DSP reads (`sampleRate`, `currentFrame`, `registerProcessor`, `AudioWorkletProcessor`), which `lib.dom` does not declare |
| `tsconfig.json` | the folder's own `tsc -p` project (#654): the engine's settings with `noUncheckedIndexedAccess` and `useDefineForClassFields` off, and why |
| `*.test.ts` | direct tests of the leaf modules (#654): a module that warms the wave cache at load needs `sampleRate` on `globalThis` before a dynamic import |

Each module opens with a header saying what it owns, the invariant it keeps and
the test that pins it; its exports are one list at the end, so a move never
touches a code line. These rules are stated here in full, and not
by reference, because whoever edits this folder reads this file and does not
reliably read the records (`2026-09-23-638-worklet-refactor-optimised-for-agents`).

1. **`generated/` is output. Never edit it.** After any change under `fm/`
   (or `reverb/`, `compressor/`, `meter/`, `retro/`, `phaser/`, `delay/`, `advancedDrive/`, `eq/`, `filter/`,
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
   No double crosses a call on the render's path, as an argument or a return
   (windsor#233): V8 inlines a call only where its budget and the call's
   frequency allow, and a double passed to or returned from one it does not
   inline is a new heap number. So `Envelope.advance` leaves its value in
   `value`, `Lfo.advance` in `output`, the part's bend and wheel
   reach the voices in `partControls`, the width update reads `opFreq` and
   the LFO levels from the voice, `Svf.setCoeffs` reads `cutoffHz` and `q`,
   and a note's pitch, velocity, detune, pan and glide go to `start` in the voice's
   fields. A frame counts: past 2^31 (about 12 hours at 48 kHz) it is a
   double, so the queue keeps frames in a `Float64Array` (`q.frames`), never
   in a field of the message, the render reads the next event's frame in
   place (`q.frames[q.head]`, no accessor), and the render reads a message's
   frame from the message and hands it to `insert` in `q.incoming`. Only the
   render reads a message (windsor#270): `schedule` posts it unread, the
   render admits what was posted at the start of the next quantum, and it
   copies a note-on's numbers into `noteIn` for `noteOn`, which takes the
   handle alone. A burst past the queue's room grows it in `post`, between
   quanta, and never in the render's admission. The first frame past 2^31 changes the representation of
   the message's `frame` field, deprecating its map and the optimised code
   of every function that read a message; one run per message then stayed
   in V8's baseline tier, boxing, for tens of thousands of quanta, where
   the render, run every quantum, is optimised again within a few hundred.
   The per-sample calls the kernel and the generic loop keep (`Svf.process`
   on `svfA` and `svfB`, `VoiceDrive.curve` for every drive shape but
   `soft`, `noise`, and in the generic loop `OperatorFilter.process`) are
   inlined first by frequency. Hard sync's `applySyncResets` (windsor#646)
   is called only on a sample where a master wrapped, never on a quiet one,
   and its wave reads pass their phase and value through a `Float64Array`.
   The direct shape's `syncShapeEdges` (windsor#655) is called once a sample
   only while an operator takes the shape, takes the voice alone, and
   writes its polyBLEP out at each edge, so no double crosses a call. The kernel writes `OperatorFilter.process`
   out for each operator (windsor#590): four calls outran its inlining
   budget, and an operator past the first then paid a real call.
   The Formant mode's three sections (`svfA`, `svfB`, `svfC`, windsor#331)
   are `Svf.process`'s bandpass written out in both loops, not called:
   three more inlined calls spent the kernel's inlining budget, and with a
   Formant voice anywhere in the bundle every other mode, Off included,
   ran about 25 % slower (`docs/research/2026-10-02-formant-filter/`).
   The Acid mode's ladder (windsor#573) is no call in either loop: a call
   that is not inlined spills the loop's doubles around it, and one there
   cost every mode about 1.5 ns a voice-sample once an Acid voice had
   played, so the loops leave each sample in the ladder's `chunk` and
   `renderVoiceLadder` runs the ladder, the fade and the pan over the chunk
   after the loop (`docs/research/2026-10-04-acid-ladder-filter/`).
   `synth/fmProcessorAllocation.test.ts` pins it through
   `__fixtures__/fmPartChangeScenario.ts`, with one run at frames past 2^31
   with notes posted ahead and the queue's accessors kept from inlining, one
   whose frames cross 2^31 (the messages' too), and two that hold a note while its `age`
   crosses 2^31; what the note-on path still allocates in V8's lower tiers
   is in `docs/research/2026-09-30-worklet-gc-in-chrome/README.md`.
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
5. **Eleven modules are read by the main thread too** (#656): `algorithms.ts`,
   `waveIds.ts`, `envelope.ts`, `fmConstants.ts`, `modeIds.ts` (#669:
   `patch.ts` re-exports `LOOP_MODE`, `FILTER_MODE` and `LFO_SHAPE`),
   `patchDefaults.ts` (#670: `makePatch()` fills from it, and
   `patchDefaults.test.ts` pins its fill equal to `normalisePatch`'s), and
   `voiceTargetTables.ts` and `voiceTargetValue.ts` (windsor#419: the
   catalog, the sequencer and the song normaliser read the table, and the
   index exports both, so a console and the voice compute a step's value
   with one curve), and
   `formantTables.ts` (windsor#331: the index exports the vowels the
   Formant mode reads), and `macroMappings.ts` (windsor#560: the
   normaliser keeps a patch's mappings by it, and the main thread's
   inert-lane check and the pickers ask it which targets are mapped), and
   `macroShape.ts` (windsor#566: the Macros card shows what a mapping
   plays with it; `macroShape.test.ts` pins it to `voiceMacros.ts`).
   `audioConstants.ts` and
   `patch.ts` re-export `ALGORITHMS`, `WAVE` and `ENVELOPE_CURVE_STEEPNESS`
   from them, and the console draws envelopes with `segmentLevel`, so there
   is one table and one curve, and no pin test. The eleven are listed in the
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
   declared (`ic1: number;`) and written by the constructor, a double field
   first as NaN and then its start value (windsor#233: one first written as
   a small integer is generalised by its first fraction, or by the first
   count past 2^31, as a voice's `age` in frames is after about 12 hours), never
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
