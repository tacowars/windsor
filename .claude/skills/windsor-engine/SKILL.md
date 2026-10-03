---
name: windsor-engine
description: Design patches and compositions or develop Windsor's FM music engine (@windsor/engine), song documents, mixer and the browser app (@windsor/app). Use for synth behavior, presets, sequencing, harmony, returns, inserts, the console UI and audio verification.
---

# Windsor engine

Work on Windsor's instrument: the engine (`@windsor/engine`) and the app
that drives it (`@windsor/app`, the arrangement console). Repository paths
below are relative to the active worktree root; `engine/` means
`packages/engine/src/` and `app/` means `packages/app/`. Follow the root
`CLAUDE.md` — and `packages/app/CLAUDE.md` for the console,
`packages/engine/src/worklet/CLAUDE.md` for the DSP; this skill adds
audio-specific guidance, not another workflow. `#NNN` numbers are
Aotearoa204 issues, the project Windsor was forked from on 2026-09-27; they
stay as provenance.

## Find the source of the behavior

Start with [the audio architecture](../../../docs/design/audio-architecture.md)
and inspect the relevant implementation. This is a four-operator instrument
with FM, harmonic waveforms and subtractive filtering, and not an emulation of
any other synthesizer. Read parameter semantics from the code, never from
another instrument.

Within `packages/engine/src/` the folders are the map (#655): one per row
below, the directory listing names the rest. At the root stay only
`index.ts` (the one public surface, `@windsor/engine`; the app imports
through it alone — an ESLint `no-restricted-imports` rule, with tests
allowed `@windsor/engine/<path>` for fixtures), `audioConstants.ts` (the
area's tables, `MS_PER_SECOND` among them) and `__fixtures__/` (shared by
every folder and by the app's tests and scripts, so it is not split).

| Task | Read/edit |
|---|---|
| Patch schema, defaults, algorithms | `patch/`: `patch.ts` (the schema and the enums), `patchNormalise.ts`; the algorithm table and the wave ids are the worklet's (`worklet/fm/algorithms.ts`, `worklet/fm/waveIds.ts`), re-exported from `patch.ts` and the root `audioConstants.ts` (#656); the loop, filter and LFO mode ids are the worklet's `worklet/fm/modeIds.ts`, re-exported from `patch.ts` (#669); every default `makePatch()` writes is the worklet's `worklet/fm/patchDefaults.ts`, the table `normalisePatch` fills from too (#670); `Patch.macros` is up to eight macros, each a name, a 0..1 value and up to eight mappings onto voice targets (one per target, never a macro's own row), checked by the loader and both normalisers (windsor#559, record `2026-10-04-patch-macro-knobs`) |
| Factory sounds | `patches/<id>.json` (one file per patch; `patch/patchLibrary.ts` is the contract, `patch/patchFileSerialise.ts` the bytes); `patch/presets.ts` builds `PRESETS` from the generated `patches/index.ts`, `patch/fallbackPatch.ts` (the fallback click's one patch, the only id engine code spells), `patch/presetCatalog.ts` lists and filters the browser metadata |
| FM synthesis and voice lifecycle | `worklet/fm/` (the FM worklet's source; read `worklet/CLAUDE.md` first. `worklet/generated/fm-processor.js` is its bundle, never edited, rebuilt with `node scripts/build-worklets.mjs` — #643). Its modules (#644, #645; TypeScript in their own `tsc -p` project since #654, each with a direct test beside it): `fmProcessor.ts` (the entry: the part processor), `voice.ts` (`Voice`: state and lifecycle), `voiceControl.ts` (per-note constants, the control-rate update), `voiceRender.ts` (the generic loop), `voiceKernel.ts` (the fixed-index kernel, #548), `fmConstants.ts` (the tunables), `waveTables.ts` (wave ids, mip tables, the cache, `waveKind`), `modeIds.ts` (the loop, filter, LFO and drive-shape ids, import-free, re-exported by `patch.ts` — #669, windsor#300), `algorithms.ts` (the topologies and the kernel's edge tables), `envelope.ts` (also the one envelope curve the console draws with — `segmentLevel`, #620, one function since #656), `lfo.ts`, `svf.ts` (the filter), `voiceDrive.ts` (the voice's drive stage before the filter: its five curves, its control-rate half — windsor#300), `portablePowers.ts` (base-2 log and power in portable arithmetic, for the drive's diode and tone — windsor#300), `prng.ts` (pinned to the main thread's `sequencing/mulberry32.ts`), `patchDefaults.ts` (the patch defaults `makePatch()` shares — #670), `patchNormalise.ts`. The main-thread side is `synth/`: `fmEngine.ts` (the context, the worklet modules, parts and buses), `audioPart.ts` (one part, one `AudioWorkletNode`), `workletMessages.ts` (the message contract and the worklet URLs), and the `fmProcessor*.test.ts` behavioural tests over the headless harness, `fmProcessorGolden.test.ts` among them |
| Song schema and compatibility | `song/`: `arrangement.ts` (the part list: slot, name, preset, sequencer kind — #597; the `Transport`: bpm, bars, an optional `meter`, swing and loop; the meter is one per song from `METERS`, absent is 4/4, windsor#429, record `2026-10-02-one-meter-per-song`), `arrangementDocument.ts`, `arrangementNormalise.ts`, `sequencerNormalise.ts`, `deskNormalise.ts` (each part's `strip` over `DEFAULT_STRIP`, and the document's `returns` over the code's `RETURNS`: Send A and Send B, each a level and an insert chain, windsor#172), `songMigrations.ts` (the upgrade table, empty: versions 2 to 4 are retired and refused, and 5 is current), `arrangementFields.ts` (the field-level clamp/junk/dangling vocabulary and the `corrections` report), `arrangementValidate.ts` (`PatchResolver`, #562), `arrangementPlayer.ts` (also `stepAt(slot, tick)`, the one position rule — #619), `documentParts.ts` (slot → engine part name, `removePart`), `fallbackArrangement.ts` (the diagnostic click) |
| Sequencing | `sequencing/`: `scheduler.ts`, `meter.ts` + `meterTables.ts` (windsor#428, windsor#429: a bar is its meter's beats summed, `ticksPerBar(meter)`, 96 ticks only in 4/4, and a song is `songTicks(bars, meter)`; step divisors are note values off the 96-tick whole note and never follow the meter; `defaultStepCount(meter, divisor)` is one bar of steps, what a new part starts with), `gridSequencer.ts` (the written 1–32 step line: degrees, accent, slide, tie, rest, skip — #602), `chordSequencer.ts` (the Chord Player: 0–32 written hits and rests with per-step duration, repeat, inversion and octave, one voicing per part; a hit voices the harmony timeline's chord at that tick — #606, #705), `arpSequencer.ts` (the arp config, normalised in full — #705) and `arpeggiator.ts` (the Arpeggiator that performs it: ten styles, retrigger, voicing and octaves over the active chord, the part's stream per region entry — #706), `bassSequencer.ts` (the Bass / Drone: follow root, follow chord with `rootBias`, or a fixed-degree pedal; `density` from the part's stream; at gate 1 a repeated note ties — #707), `figureSequencer.ts` + `figureLine.ts` (the Figure, record `2026-10-03-figure-sequencer`: 1–32 written cells over the current chord, a cell's `tone` an index into the chord's stack through `harmony/figureTones.ts`'s `figureNote`, with a velocity per cell; a length `schedule` and a rotation `drift` resolved by `cellAt` at the local bar, and a canon `source` that plays another Figure part's resolved cell `offset` steps late; `stepAt` is the cell heard, a canon's its leader's — windsor#484–#487), `regionClock.ts` (`regionState`: the one position rule — a part's local tick and region entry, the ∞ region free-running — #705) and `regionGate.ts` (the tick source each generator attaches to: local ticks at its divisor, the current chord, `enter` on a region entry, held notes released at a region end), `euclideanSequencer.ts` (`reconfigure`: every field but the divisor takes effect live, `k` and the stream kept — #610; its `pattern` is the click-to-toggle capture) and `euclidLanes.ts` (its optional rows, windsor#355: a ratchet row of 1–4 hits per step, keyed to the step and rolled evenly across the step's swung span, and drawn accent, pitch and step-mod lanes of 1–32 steps each, read at a hit at the trigger's local step mod the lane's length, so they run in polymeter and restart at a region entry; the player plays them through `trigger` with `euclidNoteOn`'s extras, and `RegionStep.localStep` is the lanes' playhead), `scaleSampler.ts` (the key's degree → note mapping, no weights; `foldDegree`: a degree past the scale wraps with octave carry; the scales themselves are `audioConstants.ts`'s `SCALES`); underneath them `euclid.ts` (Bjorklund's `E(k, n)`, pure), `noteEvent.ts` (what a pitched generator emits: note-on and note-off on the tick grid) and `generatorSeed.ts` (`hashSeed(seed, regionIndex)`: one PRNG stream per sequencer per region entry off the part's own seed — #705) over `mulberry32.ts` (the engine's main-thread PRNG). `generatorBoundary.test.ts` holds the pure set: none of them may reach the audio graph. The pre-epic arpeggiator, the step sequencer, the degree weights and pitched capture were deleted in #704; epic #703 replaced them with #706's Arpeggiator and #707's Bass / Drone |
| Harmony | `harmony/`: `harmonyTimeline.ts` (`chordAt(harmony, songTicks, tick)` — the chord holding at a transport tick, cyclic over the song; `eventBounds` for a console — #705), `chordTheory.ts` (tertian stacks and qualities), `chordNames.ts` (names, Roman numerals), `chordVoicing.ts` (inversion, voicing, range, `maxNotes`) and `chordTables.ts` (voicings, durations, qualities, labels), normalised in `chordNormalise.ts`; all of it in the pure set |
| Mixer, delay and plate | `mixer/`: `sidechainGraph.ts`, `sidechainPlan.ts`, `sidechainDesk.ts`, `sidechainRouter.ts` (post-FX detector rules, prospective validation and live edge lifetime, #667), `masterStrip.ts`, `masterSpec.ts` (the song master: inserts, edit fade and output level, #666; the Mixer's master meters read the output stage's report, not this strip, windsor#194), `peakMeter.ts`, `peakMeterConstants.ts` (the channel strips' sample-peak tap, windsor#155; the meter is `worklet/meter/peakMeterProcessor.ts`, bundled to `worklet/generated/peak-meter-processor.js`), `partMeterBank.ts`, `partMeterBankConstants.ts` (the part meter bank, windsor#540: one node metering every music part on its slot, `AudioSystem.partMeters`, which `MusicRoster` attaches each part to; its processor `worklet/meter/partMeterBankProcessor.ts` shares the meter bundle), `mix.ts`, `channelStrip.ts` (the strip chain: low cut, inserts, then the tap — #639), `lowCutStage.ts` (#640), `insertChain.ts` and `stripTap.ts` (#639, #652), `stereoRotate.ts` (the pan), `audioBus.ts` (the dry buses), `tanhCurve.ts` (the shared soft clip), `deskApply.ts` (live strip and return partials), `deskPartial.ts` (a parts partial split between what the player merges and each slot's live `strip`, #597), `returnBus.ts` (Send A and Send B: sends → insert chain → level, windsor#172), `returnEffects.ts` (the plate's parameter writes and the echo's resonant, soft-clipped loop — #647 — shared with the Plate reverb and Echo inserts, windsor#171), `reverbSpace.ts`; the plate itself is `worklet/reverb/` (bundled to `worklet/generated/reverb-processor.js`, #671), tested from `mixer/` and pinned by `mixer/reverbGolden.test.ts`. The insert kinds are `inserts/`: `insertKind.ts` (the contract every registry entry meets, #641), `insertRegistry.ts`, `meteredInsertRegistry.ts` (worklet inserts on the load meter for exactly their lifetime), `driveInsert.ts`, `chorusInsert.ts`, `insertConstants.ts` (#641, #642); the ensemble `ensembleInsert.ts`, `ensembleSpec.ts`, `ensembleConstants.ts` and the generic preset bank `insertPresets.ts` (#695); the compressor `compressorInsert.ts`, `compressorSpec.ts`, `compressorDsp.ts`, `compressorConstants.ts`, bundled by `worklet/compressor/` (#660), and `sidechainSource.ts` (a missing source is Internal, a null track is explicitly disconnected, #667); the adjustable ROM-free vintage reverb `retroReverbInsert.ts`, `retroReverbSpec.ts`, `retroReverbConstants.ts`, `retroReverbPresets.ts` / `retroReverbPresetTables.ts`, and DSP under `worklet/retro/` (#682; ordinary, gated and reverse modes, approximation presets); the Plate reverb `plateReverbInsert.ts` + `plateReverbConstants.ts` and the Echo `echoInsert.ts` + `echoConstants.ts` (the send buses' two effects as insert kinds, windsor#171) |
| The system and live changes | `system/`: `audioSystem.ts` is the one `AudioSystem` the app drives, a facade (`docs/log/2026-09-29-audio-system-split.md`). It keeps construction, the lifecycle (`init`, `unlock`, `update()` — the look-ahead pump the app calls on a timer — `dispose`) and the two document transactions, `initMusic` and `apply` partials, and delegates the rest to five collaborators: `standingGraph.ts` (the music bus, the song master, the returns, the aux fader), `partStrips.ts` (every part on its strip, by engine name), `musicRoster.ts` (the song's parts by slot, the player's `PartHost`), `musicPlayback.ts` (the `ArrangementPlayer` on the transport: start, stop, `seek`, mute, and the position queries `stepAt`, `regionStepAt`, `capturePattern`) and `systemLoadMeter.ts` (which processors report their load). A new transport operation goes in `musicPlayback.ts` with a one-line delegate on the facade, as `seekMusic` does |
| Song automation lanes | `automation/` (windsor#341, record `2026-10-01-song-automation-lanes`), all pure: `automationLane.ts` (the point, lane, target id and catalog row types), `automationTargetTables.ts` (the 38 voice rows, one per row of the voice target table `worklet/fm/voiceTargetTables.ts` with its look added, each carrying its patch `path` and its `section`; the strip's four; `FM_LANES_MAX`) and `automationInsertTables.ts` (`INSERT_AUTOMATION_FIELDS`, each insert kind's continuous fields), `automationTargets.ts` (`parseTargetId`, `formatTargetId`, `targetKind`, the row lookups), `automationDisplay.ts` (`toDisplay` / `fromDisplay`: a value on its knob's scale as 0..1), `automationEvaluate.ts` (`valueAt`, the bend curve, `rampsBetween`: the breakpoints a player ramps to), `automationShapes.ts` and `automationShapeTables.ts` (`stampShape`, `replaceRange`), `automationConstants.ts` (`AUTOMATION_STEP_RAMP_SECONDS`, the grain, the bend's base). A Parts-tab knob over a voice target takes its range from the catalog (`app/src/patchKnobRange.ts`), the Song tab's mixer knobs take theirs from the strip rows, and the song-lane picker's groups take theirs from each row's `section` (windsor#436, records `2026-10-02-voice-targets-named-in-the-catalog` and `2026-10-02-knob-ranges-from-the-catalog`). The voice target table (windsor#419, record `2026-10-02-one-voice-target-table`) is the one list of what a source may move on a voice, for song lanes and step lanes alike: the row's index is its code in a slot map, a note-on's step array and the voice's `ownValues` / `liveValues`. Its last eight rows are the patch's macros, `macros.<i>.value` from `VT_MACRO_BASE`, a `macro` section the pickers offer only where the part's patch defines it, under its name (windsor#559, record `2026-10-04-patch-macro-knobs`). Adding a target is a row there, one line in `layoutVoiceTargets` (`worklet/fm/voiceTargets.ts`), its look in this catalog, and a read of `liveValues` at its point of effect |
| Offline render | `render/`: `offlineRender.ts` (`renderPatchToBuffer`: a patch baked to an `AudioBuffer`, the seam the console's loudness check uses) |
| Audio-thread load | `cost/audioLoad.ts` (`AudioLoadReadout`, the worklets' duty-cycle load sampler, #445), read through `AudioSystem.readout().load` |

The classic phaser (#687) is `inserts/phaserSpec.ts`, `phaserConstants.ts`,
`phaserInsert.ts` and the original bank in `phaserPresetTables.ts` /
`phaserPresets.ts`, with DSP and processor under `worklet/phaser/`. The
console uses `app/src/phaserCard.ts` / `phaserTables.ts`. Rate, center, depth,
signed feedback, feedback cut, stereo offset, envelope sweep, bass keep and
mix are song-owned; presets preserve Mix/enabled. Tests include the shipped
processor and real synth bass/pad input.

Tape (REELS Lite adaptation) is `inserts/tapeSpec.ts`, `tapeConstants.ts`,
`tapeInsert.ts` and `tapeRandomise.ts`, with preallocated DSP under
`worklet/tape/`. The console uses `app/src/tapeCard.ts` / `tapeTables.ts`.
Three tape models, Drive, Bias, Wear, Hiss, Trim, Mix and the random seed are
song-owned. CC0 source provenance and deliberate Max differences are in
`docs/log/2026-09-30-reels-inspired-tape-insert.md`.

Advanced Drive (#701) is `inserts/advancedDriveSpec.ts`,
`advancedDriveConstants.ts`, `advancedDriveInsert.ts`, its preset tables and
shared shaper/filter functions; DSP is `worklet/advancedDrive/`. It adds
single, serial, parallel, three-band and mid/side routing, eight original
shapers, five filters, an envelope follower and one free/synced LFO. The old
`drive` stays native and is labelled Classic Drive. Stage settings survive
route changes; active processing has 32 host samples of latency and
phase-matched multiband dry. The console's `advancedDriveCard.ts` owns the
stage controls and uses engine functions for base response displays. See
`docs/research/2026-09-26-701-drive/README.md` for semantics and audition.

The Dub delay (#698) is `inserts/delaySpec.ts`, `delayConstants.ts`,
`delayInsert.ts` and `delayPresets.ts` / `delayPresetTables.ts`, with DSP under
`worklet/delay/`. `tempoInsertRegistry.ts` carries song BPM to current and
new/deferred inserts; tempo is not saved per insert. Stereo, ping-pong and
mid/side modes share independently synced/free lane times, HP/LP filtering,
saturating feedback, drive, mix and output gain. The console uses
`app/src/delayCard.ts` / `delayTables.ts`; presets preserve Mix/output/enabled.
Time changes bend pitch. See `docs/research/2026-09-25-698-delay/README.md`
for semantics and audition steps.

The Parametric EQ (windsor#198, record `2026-09-30-parametric-eq-insert`) is
`inserts/eqSpec.ts` (eight bands of on, type, slope, freq, gain and Q, plus
scale, output and enabled), `eqConstants.ts` (the only place the ranges are
written), `eqParameters.ts` (the flat k-rate names, `b1Freq` … `enabled`),
`eqInsert.ts` (`EQ_INSERT`) and one coefficient module, `eqCoefficients.ts`
over `eqSectionDesign.ts`: matched sections after Vicanek (bells, cuts, and
the notch and shelves too, which measured audibly off in bilinear form), and
`eqResponseDb`, the digital response of those same coefficients, which the
console draws. `eqAnalog.ts` holds the analog prototypes the tests measure
against. The DSP is `worklet/eq/`: stereo TDF-II in doubles, 20 ms log glides
refreshed every 16 samples only while moving, type/slope/on crossfades, and
bit-exact copy when flat, bypassed or silent. The processor loads with the
others, but the kind is not in `INSERT_KINDS` until its console card
(windsor#199). Accuracy, click and cost measurements:
`docs/research/2026-09-30-parametric-eq/README.md`.

The ensemble (#695) is `inserts/ensembleSpec.ts`, `ensembleConstants.ts`,
`ensembleInsert.ts` and `ensemblePresets.ts` / `ensemblePresetTables.ts`:
native nodes, no worklet. Three delay lines 120° apart, each swept by a slow
plus a fast LFO; each rate is a sine-and-cosine `PeriodicWave` pair on one
shared `ConstantSourceNode` frequency, and each
line's phase two fixed weights on it, so the lines stay locked through any rate
change (`2026-09-25-ensemble-insert-sine-cosine-basis`). Slow/fast rate and
depth, line centre, tone, width, mix and enabled are song-owned; presets
(sourced machines only, approximations labelled) preserve Width/Mix/enabled.
The chorus reaches 10 Hz, has an on switch, and carries the Juno I / II / I + II
presets (`chorusPresets.ts` / `chorusPresetTables.ts`); both preset banks use
the generic `insertPresets.ts`. The console's `app/src/chorusCard.ts` and
`app/src/ensembleCard.ts` share `app/src/presetInsertCard.ts`. Sources and per-value
provenance: `docs/research/2026-09-25-695-ensemble.md`.

The console lives in `packages/app/`: a Vite app, four tabs over the *real*
`AudioSystem`, imported through `@windsor/engine` only. Extend that surface
rather than building another synth, effect graph or sequencer in the
console — the ESLint import fence and `app/src/consoleBoundary.test.ts` (no
Web Audio node construction in console code) hold both boundaries. Develop
with `npm run dev` (HMR on :5173); `npm run build` writes the static
`packages/app/dist/`.

**Read `packages/app/CLAUDE.md` before editing the console**: the
layers, the rules (tunables in tables, a knob default is the engine's, one
strip and one playhead loop, cards through the registry, every edit reaches
the document, parts by slot, `el()` is text) and the checklists for adding a
sequencer kind, a return, a harmony mode, a knob or a library action are
stated there once. The table below is the file map — what owns what, today; paths are under
`packages/app/`.

| Console task | Read/edit |
|---|---|
| Composition, the shared context, the document, the engine connection | `src/main.ts` (construction and wiring only), `src/appContext.ts` (the `AppContext`: the tab registry — the active tab renders, the rest catch up when shown — `change` / `importDoc`, and `livePart()` resolved per call; the Euclidean card commits `host.capturePattern` through `change` itself, #705), `src/context.ts` (the `AppCtx` interface the tabs import, and `partChange`), `src/tabShell.ts` (the bar and the panels), `src/powerButton.ts` (the first gesture, which builds the live system), `src/documentModel.ts` (the always-normalised document and the editor-only library fill), `src/host.ts` + `src/hostConstants.ts` (one `AudioContext` for the page, `FmEngine.init({})` so the worklets load from the engine's own URLs, the look-ahead pump), `src/partsSession.ts` (the working patch and its commit), `src/patchPath.ts` (dotted paths into it) |
| The vocabulary every tab shares | `src/dom.ts` (builders only; `el()` writes text, `html()` is the markup opt-in), `src/toast.ts` + `src/toastModel.ts` + `src/toastConstants.ts` (the notices: `ctx.notify(message, tone)`, a stack at the bottom right; an error stays until dismissed), `src/consoleColors.ts` (the one palette, pinned to `src/console.css`'s custom properties), `src/consoleFormat.ts` (the one set of readout formatters), `src/knob.ts` + `src/knobConstants.ts` (the console's one control), `src/scope.ts` + `src/scopeConstants.ts` (the master analyser trace), `src/focusTrap.ts`, `src/sequencerConstants.ts` (`KIND_LABELS`, `DIVISOR_OPTIONS`, `NOTE_NAMES`) |
| The four tabs | `src/partsTab.ts` (the patch editor over the selected slot), `src/mixerTab.ts` + `src/mixerTables.ts` (the send buses and the master; each part's strip is on the Song tab's mixer, `src/songMixerCell.ts`, windsor#152; `src/trackOutput.ts` selects Master/Sidechain only and `src/sidechainSelector.ts` selects a compressor detector by stable slot, #667; every insert chain is the fixed-height rack of `src/stripInserts.ts` with `src/insertShell.ts` (the side rail, pages and fold), `src/insertLayout.ts`, `src/insertRackTables.ts`, `src/insertAddPicker.ts` (the grouped picker at each end) and the session-only `src/insertRackModel.ts` (windsor#173, record `2026-09-30-insert-rack-and-send-bus-chains`), the `INSERT_CARDS` registry in `src/insertCards.ts`, `src/driveCard.ts` and `src/chorusCard.ts` over `src/insertKnobs.ts` + `src/insertKnobTables.ts`, `src/ensembleCard.ts` (#695; it and the chorus card put a preset picker and an on switch above their knobs through `src/presetInsertCard.ts`), `src/retroReverbCard.ts` + `src/retroReverbTables.ts` (#682), and the pure `src/insertEdits.ts` — #641; the compressor's `src/compressorCard.ts` + `src/compressorTables.ts` (ranges and defaults from the engine) with `src/compressorMeter.ts` (one gain-reduction line over the engine's real detector, on the console's frame loop), #660; the song master's `src/masterStrip.ts` (the master's insert rack) + `src/masterTables.ts`, then the master column after the inserts (windsor#193, windsor#194, record `2026-09-30-master-column-and-meters`): `src/masterColumn.ts` + `src/masterColumnTables.ts`, the Level fader `src/levelFader.ts` + `src/levelFaderModel.ts`, the output stage's In and Out meters `src/outputStageMeters.ts`, the transfer curve `src/transferCurve.ts` + `src/transferCurveModel.ts`, the sticky `src/meterBridge.ts`, the stage lamp `src/stageLamp.ts` + `src/stageLampModel.ts`, the GR or Over gauge `src/gaugeMeter.ts`, and the meter parts `src/meterTables.ts`, `src/meterModel.ts`, `src/meterBar.ts` and `src/meterLoop.ts` (paints only while a meter is visible); and `src/insertTarget.ts` (the two song-owned insert locations the cards share), #666) with `src/returnsPanel.ts` + `src/sendBusModel.ts` (Send A and Send B: a head with name, Level and who sends, then the bus's insert rack, in the document's `returns`), `src/plateReverbCard.ts`, `src/echoCard.ts` and `src/returnControls.ts` (the Plate reverb and Echo cards and their shared controls, windsor#171), the Parametric EQ's `src/eqCard.ts` (the card and its session view state), `src/eqPanel.ts` (the band row, the ±12 / ±24 toggle and the band panel), `src/eqCurve.ts` (the canvas, drawn from the engine's `eqResponseDb`), `src/eqCurveInput.ts` (the curve's pointer, wheel and keys) over the pure `src/eqCurveModel.ts` (where each point sits and what each gesture does) and `src/eqTables.ts` (windsor#199, record `2026-09-30-parametric-eq-insert`), the Song view (#709, below) with `src/seqFields.ts` (the field knobs, the divisor picker, the density controls) + `src/sequencerKnobTables.ts` + `src/harmonyTables.ts` (the register octave knob the arp and bass cards and the pane draw), `src/arrangementTab.ts` + `src/arrangementConstants.ts` (export/import, new song, the report and live readout); above every tab, `src/transportStrip.ts` + `src/transportTables.ts` + `src/transportModel.ts` (BPM, Bars, the meter picker, key, scale, the bar.beat.sixteenth position in the song's meter and ▶ ■ ‖ over `host.ts`'s `HostTransport`, #708, windsor#431; `src/meterGrid.ts` is where the meter's beats and bar lines fall in what the app draws: the ruler's beat ticks, the readout's beat and the step strips' grouping, shared by the Grid, Chord and Euclid cards) |
| Operator bays, knobs, the User-wave harmonic editor | `src/patchBays.ts`, `src/patchPanels.ts` + `src/patchPanelConstants.ts` (algorithm picker, globals, drive, filter, LFO, pitch envelope), `src/patchKnobTables.ts` (every patch knob as data, with no `def` — `patchKnobOpts` reads `makePatch()` at the path), `src/harmonicEditor.ts` + `src/harmonicModel.ts` (pure) + `src/harmonicConstants.ts`, `src/operatorStart.ts` (pure: an operator's Start segment, Free or Locked to its Phase knob) |
| Envelopes: the display, its knobs, moving one between the six slots (#588) | `src/envCanvas.ts` + `src/envCanvasConstants.ts` (the drawing, which calls the engine's `segmentLevel`), `src/envelopeKnobs.ts` (the knob groups, over `ENVELOPE_KNOBS` / `ENVELOPE_ADV_KNOBS`), `src/envelopeTransfer.ts` (pure: `ENVELOPE_SLOTS`, `copyEnvelope`, `swapEnvelopes` — a copy carries loop mode and key scaling), `src/envelopeDrag.ts` (the pointer state machine, the ghost, the drop). Drag a curve onto another display to copy it, shift-drag to swap |
| The operator's Coarse / Fine ratio pair (#587) | `src/ratioSplit.ts` (pure: `split` / `join` over the one `ops.<i>.ratio` field, floored at the console's `RATIO_MIN` — the engine stays unclamped), `src/ratioKnobs.ts` (the specs, the readout, the Fixed swap) |
| The part list: new song, add/remove parts, sequencer kind, names (#598), each edit live (#629) | `src/songParts.ts` (pure: `newSong`, `addPart`, `setSequencerKind`, returning a raw document for the normaliser to fill), `src/partEdits.ts` (those three as live partials — a part added on the lowest free slot, the selected part removed with its patch through the engine's `removePartChange`, a part's sequencer kind changed — each one `ctx.change`, so the transport and every other part keep playing; `ctx.restructure` is Import's and Restart's), `src/partListControls.ts` (the name and the sequencer select at the start of the Parts tab's bar, which drive them), `src/partNameField.ts` (the one name field, in Parts and on each Mixer strip), `src/songConstants.ts` |
| The sequencer cards' shared machinery and the card registry | `src/stepStrip.ts` (the `Strip` type, `specOf` / `commitSteps`, `stripCell` / `stripColumn` / `markStep`, `paintStrip`, and the one `requestAnimationFrame` playhead loop, `watchPlayhead`, whose watches share one frame through `createFrameDriver`), `src/regionPlayhead.ts` (the playhead of the grid, chord and Euclidean cards, windsor#97 and windsor#101: `regionPlayheadAt` reads the engine's `host.regionStepAt` → `AudioSystem.regionStepAt` → `ArrangementPlayer.regionStepAt`, bright on the step sounding while the song is in the card's region, a dim ghost on the step the region's pattern would be on while it is not, dark while the transport is halted; `lightPlayhead` sets `.playing` / `.ghost`. The audible tick itself is read once, in `host.ts`'s `HostTransport.position()`), `src/sequencerCards.ts` (`SEQUENCER_CARDS`: one factory per `SequencerKind`, which the Song view's detail pane (`src/songDetailPane.ts`) looks the selected part's card up in — a new kind is a new card file and an appended entry, and `sequencerCards.test.ts` fails without one) |
| The grid card: step columns, the degree picker from the key, length / skip / accent knobs (#603) | `src/gridCard.ts` (the columns and the controls over the shared strip), `src/gridModel.ts` (pure: cycle a step's kind, degree, octave, flags; grow the list for a length; fold a degree against the scale), `src/gridConstants.ts` (what Randomize draws, how far Rotate turns) |
| The chord card: the Hit and Rest tiles, drag, per-step dials (#607, #705) | `src/chordCard.ts` (the strip and the dials), `src/chordStepModel.ts` (pure: the Hit tile named for the chord under the playhead through the engine's `chordAt` / `voiceHit`, `dropOn`, `turnDial`), `src/chordDrag.ts` (the press-to-audition / drag-to-place state machine, tested through fakes), `src/chordPicker.ts` (the two tiles, the voicing control, the ghost), `src/chordConstants.ts` |
| The Euclidean card: the figure strip lit per onset, a `k / n` readout, Steps resizing it at once, click-to-toggle capture (#610) | `src/euclidCard.ts` (the knobs, and the strip repainted from `host.capturePattern` each frame it changes), `src/euclidModel.ts` (pure: the Steps partial with the bounds carried along, the `k` knobs dragging each other, Rotate within `±n`, the cell toggle, the preview figure) |
| The Song view (#709, epic #703 decision 1): the bar ruler, the harmony lane, one lane of regions per part, one playhead line, the detail pane hosting the selected part's card or the harmony card | `src/songTab.ts` (composition and the selection; every edit one `ctx.change` live partial, then a repaint of the lanes), `src/songRuler.ts` (the ruler and the view's one `watchPlayhead` over `ctx.transport.position()`: the line, the lit chord block, the lanes' repaint check; and `wirePlayheadDrag`, the line's label as a handle while the transport is stopped or paused, windsor#102), `src/playheadDrag.ts` (pure: when the line can be grabbed, the snap to the nearest bar line within bar 1 .. the last bar, and the drag's state machine; the drop seeks through `ctx.transport.seek` → `AudioSystem.seekMusic` → `MusicPlayback.seek`), `src/songHarmonyLane.ts` (chord blocks from the engine's `eventBounds`, the seam drag between two chords, Alt-click to split, the `+` tile that halves the selected chord, windsor#550), `src/laneEditModel.ts` / `src/laneEditTables.ts` / `src/laneEditMarks.ts` (the lanes' shared hit testing — seams, edge zones, body — cursors, seam marks, edge handles and drag readout), `src/songLanes.ts` (a part's lane and frozen-column row), `src/partLaneBlocks.ts` (region blocks — tone, summary, cycle ticks, ⟲ / ∞ — and their handles, seam marks and readout), `src/partLaneGestures.ts` (windsor#551: click a gap to add a bar or drag across it to draw, drag an edge, a seam to roll both regions, or the body, alt-click to split, Shift for the step snap), `src/partLaneModel.ts` (pure: the lane's seams and edges, a drag's draft and readout, the handle lights), `src/pointerDrag.ts` (the shared press-or-drag helper), `src/songDetailPane.ts` (header, close, then the card inside the sequencer device), `src/sequencerDevice.ts` (the 244 px device frame every sequencer card sits in, windsor#368; sizes in `src/sequencerDeviceTables.ts`), `src/sequencerRail.ts` (its rail: dot, name and fold, region `n/m`, Split / Delete), `src/sequencerDeviceModel.ts` (pure: the rail's region, Split and Delete read from the document at the press, the folds), `src/harmonyCard.ts` (windsor#332: a ▶ over each of the seven degree chips, Accidental / Size / Quality, the info bubble, the Duration dial, Delete; 244 px high, its sizes in `src/harmonyCardTables.ts`'s `HARMONY_CARD_PX`), `src/harmonyAuditionTables.ts` (the ▶'s voice: the built-in patch, velocity and register), `host.ts`'s `auditionPart()` (one part on the engine's `audition` aux strip, outside the song's mix); pure: `src/regionModel.ts` (add / resize / move / split / delete / `regionMark` / `snapGrain`, and `followSongLength`, which `AppContext.change` applies so a Bars edit carries every whole-song region and the timeline's tail), `src/harmonyLaneModel.ts` (the Duration dial shifts the rest and the last absorbs, delete merges into the previous, `eventLabel` / `degreeChips` / `chipDegree` over the engine's chord names, `setQuality` / `setAccidental`), `src/harmonyLaneEdits.ts` (`+` halves a chord on the song's bar lines, a seam roll, Alt-click's split), `src/harmonyLaneGeometry.ts` (the lane's blocks keyed by event, the last chord's wrapped hold included, and a seam only where the chord changes), `src/harmonyAuditionModel.ts` (which chord a ▶ plays and its notes, over the engine's `eventStack` and `voiceChord`), `src/songViewTables.ts` (px per bar, the name column, `tickToPx`, `LANE_TONE`, `REGION_SUMMARY`, `CYCLE_TICKS`) |
| The Figure device: Cells (Rate, Seed + Reseed, Randomize; Octave, Length, Rotate; Vel, Acc vel, Acc mod; Gate, Skip; the strip of tone, Oct, Vel bar, A, S, ratchet and lanes, tones labelled `R 3 5 7` over the chord under the playhead, the tone picker on a right-click) and Process (Schedule chips, Drift, Source) under page tabs; a canon's strip is its leader's cells, greyed (windsor#490) | `src/figureCard.ts` (the tabs, the session's page, the summary), `src/figureControls.ts`, `src/figureGrid.ts` (the strip and the one loop) over `src/figureCells.ts` and `src/figureTonePicker.ts`, `src/figureProcessPage.ts` over `src/figureSchedule.ts`; pure: `src/figureModel.ts` (cell edits, tone labels, Length, Rotate, Randomize), `src/figureProcessModel.ts` (stages, drift, source options, readouts, summary), `src/figureConstants.ts` |
| The arp card: style, Rate, Gate, Octaves, Voicing, Retrigger, Reg, Vel, Seed + Reseed; no strip, no playhead (#706) | `src/arpCard.ts`, `src/arpModel.ts` (pure: the style and voicing options from the engine's enums, the seed field and Reseed) |
| The bass card: pitch mode, Root bias / Fixed degree enabled per mode, Rate, Gate, Density, Reg, Vel, Seed + Reseed; no strip, no playhead (#707) | `src/bassCard.ts`, `src/bassModel.ts` (pure: the mode's live controls, the degree names from the key, the seed field and Reseed), `src/bassConstants.ts` |
| The patch library: browsing, selection, writes (#563) | `src/patchBar.ts` (the Parts tab's part + patch bar, windsor#521: name, sequencer, ◀ ▶ over `src/patchStepModel.ts` (pure), the patch box, Save / Save as… / Init and the ⋯ menu of `src/patchMenu.ts`), `src/patchPopover.ts` (the search popover, ⌘K / Ctrl+K), `src/patchLibrary.ts` (which patch the selected part plays, the patch box's summary, Rename and Revert, and the fork-on-edit rule), `src/presetBrowser.ts` (the pick, one undo step, and the retained filter), `src/libraryActions.ts` (Save, Save as… (the old Copy to new), Init, Delete, the folder grant, the unsaved dot) over `src/patchActions.ts` (pure), `src/libraryModel.ts` (the built-ins plus the user's library, or the folder while connected — the listing `patch/presetCatalog.ts` no longer duplicates; `isWritable`: built-ins never are), `src/libraryFolder.ts` (the developer's File System Access grant, its remembered handle, `PatchFolder` fake-able), `src/userLibraryStore.ts` (the `windsor` IndexedDB database: the user's patches as a `PatchFolder`, the session record as a `SongStore`, the named songs' `songIndex` and `songDocs` as `SongRecords`), `src/userSession.ts` (boot: the user library and the page hooks) over `src/userSessionSongs.ts` (the song half: attach the session, the reload, the autosave, a touched song kept and queued), `src/songAutosave.ts` + `src/songAutosaveConstants.ts` (debounced write of the open song to its record: `songs/current`, or a named song's), `src/songRestore.ts` (the reload: a named song reopens, an untitled one is asked about and opened like Import), `src/songLibrary.ts` + `src/songFacts.ts` (the named songs, windsor#433: both records in one write, the index derived from the text, a `revision` that refuses a stale tab, the open song's delete in one transaction with `current`), `src/songSession.ts` + `src/songSessionStorage.ts` + `src/songSessionStored.ts` + `src/songMetaText.ts` (`ctx.songs`: untitled or named, the one awaited switch every replacement takes, Save as, and the edits to stored songs), `src/storagePersistence.ts` (`navigator.storage.persist()` once, on the first write), `src/libraryConstants.ts`, `src/patchFileWriter.ts` (the bytes via `patch/patchFileSerialise.ts`), `src/patchMetadata.ts` (ids, names, tags; pure), `src/metadataModal.ts` (`index.html`'s `<dialog>`s, never `window.confirm`), `src/loudnessCheck.ts` (the browser-side clip check through `render/offlineRender.ts` at the engine's default worklet URL) |
| Audition input: QWERTY, on-screen keys, MIDI | `src/keyboard.ts` + `src/keyboardConstants.ts` (the one note path, Hold, Panic, bend/wheel; held keys are filed under `e.code` and Panic reaches every part this keyboard has sounded — #617); MIDI in `src/midiMessage.ts`, `src/midiPerformer.ts`, `src/midiInputs.ts` (pure), `src/midiConstants.ts`, and `src/midiAccess.ts`, `src/midiPanel.ts` (Web MIDI, device selector) |
| The page itself and the scripts around it | `index.html` (markup only), `src/console.css` (the whole stylesheet, imported by `src/main.ts`), `vite.config.ts` (relative `base`, worklets never inlined), `src/consoleBoundary.test.ts` (no local audio nodes; the stylesheet's braces balance — #610), `lib/audioBundle.mjs` (the esbuild call the Node-side scripts load engine exports through), `import-patches.mjs` + `lib/importPatches.mjs`, `rewrite-patches.mjs` (the bank rewritten at a new patch format through the loader and the serialiser) |

## Design a sound or composition

Read [synth behavior](references/synth-behavior.md) before choosing operator
routing, envelopes, fixed frequencies or custom harmonics. Infer the sound's
role, register, gate length and mixer context from the request; ask only for
musical choices that remain material and unresolved.

- tacowars's established scoring direction is moody atmosphere and minimal dub
  techno. Use it when applicable; a new brief can choose a different palette.
  Soundtrack FX include sweeps, noise, pulses, glitches and tension textures.
- Start with an existing sound or `makePatch`; use `clonePatch` for an editable
  copy. Preserve factory IDs and unrelated song settings. A sound that should
  outlive the session is a library file, `engine/patches/<id>.json`, saved from
  the console (Init, Save, Copy to new) or written by hand followed by
  `node scripts/patch-library-index.mjs --write`; sound data never goes back
  into TypeScript.
- Choose carrier/modulator envelopes for the intended articulation, then
  tune filter and modulation. Document useful register/hold time and any
  recommended mixer sends. Delay/plate belong to the song, not `Patch`.
- Audition both dry and in the intended arrangement. Test slow sounds with
  a long enough note gate; a short sequencer gate can interrupt a valid swell.
  Describe sonic intent separately from measured output and tacowars's verdict.

**Scoring bank:** `docs/design/scoring-preset-library.md` is its guide.
**Drum bank:** `docs/design/drum-bank.md` records the 808 / 909 / EFM
mechanisms, their sources and the engine tricks the `tr808-*`, `tr909-*` and
`efm-*` patches use (trigger envelopes, the LFO burst gate, negative-feedback
diode rounding). Since
#561 every patch, scoring or original, is one `engine/patches/<id>.json`
carrying its own category, tags and description (decision
record `2026-09-15-561-patch-library-file-shape`); the recipe tables are
gone. `patch/presetCatalog.ts` carries the browser metadata and its filter; the
listing itself is the console's `libraryModel.listLibrary` over whichever library
it has open, browsed in `app/src/presetBrowser.ts`. Reuse tags, retain IDs and keep
document overrides visible when extending the browser. A new or edited file
needs `node scripts/patch-library-index.mjs --write`, which `npm run verify`
checks. The loader (`loadPatchFile`) upgrades an old `format` through
`patch/patchMigrations.ts` and fills a missing field from `makePatch`, but
refuses an unknown key or a wrong type; a format bump rewrites the bank with
`node packages/app/rewrite-patches.mjs`.
The console writes files itself (#563): a Chrome folder grant on `patches/`
(the developer mode) makes Save and Copy to new write there. Without it they
write to the user's library in the browser's IndexedDB, where a built-in is
never overwritten (Save forks it to a new id). In a browser with no
IndexedDB, Save downloads `<id>.json` for `node packages/app/import-patches.mjs`.

## Preserve the complete song

Read [the document contract](../../../docs/log/2026-09-11-music-document-carries-patches-and-returns.md)
and [the self-contained rule](../../../docs/log/2026-09-15-562-song-documents-are-self-contained.md)
for song or console changes. A part references a preset ID, and since #562 a
song carries a snapshot of every patch it plays: on the plain playback path
the one resolver (`PatchResolver` in `arrangementValidate.ts`) reads the document's
`patches` section only and throws on a missing id, naming the part. The console
is the only caller that passes `makeArrangement(raw, { libraryFill })`; a
pre-#562 document has its parts filled from the library once, on open, and
embedded on the next export. A library edit therefore never changes a saved
song until that song is re-exported. A new working sound must reach the
document, not just the live part, to survive export. The preset browser copies
the chosen patch into the document on selection (`choosePreset`), and knob
edits commit the working patch there through `pushPatch`.

Normalize through `makeArrangement`, and inspect corrections/dangling
references. Preserve `patches`, `returns`, each part's strip, harmony,
sequencers and captured patterns through export/import. A song is `version: 5`
(windsor#224: Tape's Drive feeds the magnetic core; versions 2 to 4 are retired
and refused, with no upgrades). It carries windsor#172's `returns.a` /
`returns.b`, each a `level` and an `inserts` chain, and strips' `sends.a` /
`sends.b`, and version 3's shape (#705: `transport.bars`,
a `harmony.events` timeline, per-part `regions` and per-sequencer seeds), with
1–8 parts; a part is identified by its `slot` (its engine part is
`music-<slot>`; its stream is its own sequencer's `seed` per region), never by its name, and
live partials address it as `{ parts: { <slot>: … } }` (#597). A partial patch edit differs from replacing
a full patch: recursive objects merge, while patch arrays replace wholesale
(`mergePatch`). Which send buses exist (`a`, `b`) is code-owned, and their insert chains are the song's. Inspect the existing bounds.

Windsor ships no song: an exported document is the user's file, opened
through Import. Test documents are fixtures under
`engine/__fixtures__/arrangementDocuments/`.

## Verify the change that was made

- **Patch/DSP:** use `packages/engine/src/__fixtures__/workletHarness.ts` and relevant
  `fmProcessor*.test.ts` / `patch.test.ts`. Measure seeded output, finite
  samples, audibility, peaks and release completion. Cover intended registers,
  velocities, gates and chords; include retrigger/steal behavior if changed.
  A short seed sweep cannot establish slow-envelope audibility or a universal
  clipping bound. A patch file carries no level record: a hot patch shows on
  the strip and master meters, and the editor's loudness check warns before a
  save (record `2026-09-28-retire-the-headroom-record`). A schema field added
  with a default needs no rewrite of the bank, since the loader fills it. For
  a bit-identity comparison the
  harness can render with `specialise: false` (the generic voice loop, #548) or
  `dormancy: false` (#547); both must agree with the default path sample for
  sample. A migration proof against a captured fixture is a one-time test:
  retire it in the PR that merges the migration, or it fails on the first
  library edit (#583).
- **Songs/mixer:** use `arrangementDocumentDesk.test.ts`,
  `audioSystemDesk.test.ts`, `arrangementApply.test.ts` and the relevant
  generator/return tests, plus `patchResolver.test.ts` for the two resolver
  modes. Check round trips, document-only resolution on the playback path and
  the library fill on the console path, including a new patch and its preset switch
  in the same live change.
- **Console:** test its state operations — its tests run in Node with no DOM,
  so the testable unit is the pure model, the table or the write function, not
  the click handler — and check the affected controls in the browser when
  useful. Check that imported/exported sound state and live sound agree; UI
  movement alone is not that evidence. The app is Vite: `npm run dev` serves
  it with HMR, so there is no page to rebuild or commit. The app **bakes the
  whole patch library** — `documentModel.ts` imports `PRESETS`, which
  `presets.ts` builds from the generated `patches/index.ts` over every
  `engine/patches/<id>.json` — so a patch file added or edited needs
  `node scripts/patch-library-index.mjs --write`, and a worklet source edit
  needs `node scripts/build-worklets.mjs`; `npm run verify` checks both
  generated outputs and runs `npm run build`.
- **Performance:** use the cost counters in `engine/cost/` (the audio-thread
  load, scheduler cost, playback stats) when the task calls for measurement;
  see the architecture. Name the machine and browser a reading came from, and
  keep estimated and measured values distinct. Preserve worklet hot-path allocation
  discipline; heap snapshots alone cannot prove it.

Run the narrow checks while developing, then `npm run verify`. Report a listening verdict as pending when it is
tacowars's remaining criterion; hand back exact sounds/steps rather than waiting
or equating passing DSP tests with musical approval. tacowars auditions in the
console with a MIDI controller as well as QWERTY, so a handback can name
velocity, pitch bend, mod wheel (which scales LFO amount through
`lfo.modWheelDepth` and adds to the filter envelope amount through
`filter.modWheelDepth`, #586) and sustain-pedal gestures, and which part to
select.
