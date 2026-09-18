---
name: music-engine
description: Design patches and compositions or develop Aotearoa204's custom FM music engine, song documents, mixer and standalone patch editor. Use for synth behavior, presets, sequencing, returns and audio verification; Babylon spatial-audio integration remains with the Babylon skill.
---

# Music engine

Work on the real instrument shared by the game and arrangement console.
Repository paths below are relative to the active worktree root; `audio/`
means `packages/client/src/audio/`. Follow root and client `CLAUDE.md` — and
`tools/patch-editor/CLAUDE.md` for the console — plus the board quick-sheet for
ticket work; this skill adds audio-specific guidance, not another ticket or
approval workflow.

## Find the source of the behavior

Start with [the audio architecture](../../../docs/design/audio-architecture.md)
and inspect the relevant implementation. This is a four-operator instrument
with FM, harmonic waveforms and subtractive filtering, not a DX/OPL or Ableton
Operator emulator. Do not infer parameter semantics from those instruments.

Within `packages/client/src/audio/`:

| Task | Read/edit |
|---|---|
| Patch schema, defaults, algorithms | `patch.ts`, `audioConstants.ts`, `patchNormalise.ts` |
| Factory sounds | `patches/<id>.json` (one file per patch, `patchLibrary.ts` is the contract); `presets.ts` builds `PRESETS` from the generated `patches/index.ts`, `gameplayPatches.ts` names what the game plays |
| FM synthesis and voice lifecycle | `worklet/fm-processor.js`, `fmEngine.ts`, `audioPart.ts`, `workletMessages.ts`, `envelopeCurve.ts` (the one envelope curve, drawn by the console and pinned against the worklet by `envelopeCurve.test.ts` — #620) |
| Song schema and compatibility | `arrangement.ts` (the part list: slot, name, preset, sequencer kind — #597), `arrangementDocument.ts`, `arrangementNormalise.ts`, `sequencerNormalise.ts`, `deskNormalise.ts` (each part's `strip` over `DEFAULT_STRIP` and the document's `returns` over the code's `RETURNS`), `arrangementFields.ts` (the field-level clamp/junk/dangling vocabulary and the `corrections` report), `arrangementValidate.ts`, `arrangementPlayer.ts` (also `stepAt(slot, tick)`, the one position rule — #619), `documentParts.ts` (slot → engine part name, `removePart`) |
| Sequencing and harmony | `scheduler.ts`, `stepSequencer.ts` (the generative drone), `gridSequencer.ts` (the written 1–32 step line: degrees, accent, slide, tie, rest, skip — #602), `chordSequencer.ts` (the written chord progression: 0–32 steps of diatonic chords by degree, per-step duration, repeat, inversion, octave and semitone, one voicing per part — #606) over `chordTheory.ts` (tertian stacks and qualities), `chordNames.ts` (names, Roman numerals), `chordVoicing.ts` (inversion, voicing, range) and `chordTables.ts` (voicings, durations, qualities, labels), normalised in `chordNormalise.ts`; `euclideanSequencer.ts` (`reconfigure`: every field but the divisor takes effect live, `k` and the stream kept — #610), `arpeggiator.ts`, `scaleSampler.ts` (`foldDegree`: a degree past the scale wraps with octave carry; the scales themselves are `audioConstants.ts`'s `SCALES`), `capturedPattern.ts`; underneath them `euclid.ts` (Bjorklund's `E(k, n)`, pure), `noteEvent.ts` (what a pitched generator emits: note-on and note-off on the tick grid) and `generatorSeed.ts` (one PRNG stream per generator off the arrangement's one seed) |
| Mixer, delay and plate | `mix.ts`, `channelStrip.ts`, `deskApply.ts`, `returnBus.ts`, `reverbSpace.ts`, `worklet/reverb-processor.js` |
| Game selection and live changes | `audioSystem.ts`, `arrangementLibrary.ts`, `musicOptions.ts` |
| Gameplay SFX — **not this skill's** | `gameplaySfx.ts`, `actionSfx.ts`, `spatialSfx.ts`, `sfxSelection.ts`, `sfxBuffers.ts`, `createGameplaySfx.ts`, `sfxConstants.ts` are the client's simulation-driven sound path: Babylon AudioV2, snapshot and event listening, per-bank variation. They belong to `packages/client/CLAUDE.md` and the Babylon skill, the same boundary `babylonBridge.ts` draws for the music engine. Read them when a music change moves a shared seam (`offlineRender.ts`, `gameplayPatches.ts`, `mixLevels.ts`); do not extend them from here |

The console lives in `tools/patch-editor/`: five tabs over the *real*
`AudioSystem`, imported through `audio/index-for-editor.ts`, which excludes
Babylon. Extend that surface rather than building another synth, effect graph
or sequencer in the console — `build-editor.mjs` asserts both boundaries.

**Read `tools/patch-editor/CLAUDE.md` before editing the console**: the
layers, the rules (tunables in tables, a knob default is the engine's, one
strip and one playhead loop, cards through the registry, every edit reaches
the document, parts by slot, `el()` is text) and the checklists for adding a
sequencer kind, a return, a harmony mode, a knob or a library action are
stated there once. The table below is the file map — what owns what, today.

| Console task | Read/edit |
|---|---|
| Composition, the shared context, the document, the engine connection | `src/main.ts` (construction and wiring only), `src/appContext.ts` (the `AppContext`: the tab registry — the active tab renders, the rest catch up when shown — `change` / `restructure` / `importDoc` / `capture` / `release`, and `livePart()` resolved per call), `src/context.ts` (the `AppCtx` interface the tabs import, and `partChange`), `src/tabShell.ts` (the bar and the panels), `src/powerButton.ts` (the first gesture, which builds the live system), `src/documentModel.ts` (the always-normalised document and the editor-only library fill), `src/host.ts` + `src/hostConstants.ts` (one `AudioContext` for the page, the blob-URL worklets, the look-ahead pump), `src/partsSession.ts` (the working patch and its commit), `src/patchPath.ts` (dotted paths into it), `src/dsp.d.ts` (the worklet sources the page supplies) |
| The vocabulary every tab shares | `src/dom.ts` (builders only; `el()` writes text, `html()` is the markup opt-in), `src/consoleColors.ts` (the one palette, pinned to the template's CSS variables), `src/consoleFormat.ts` (the one set of readout formatters), `src/knob.ts` + `src/knobConstants.ts` (the console's one control), `src/scope.ts` + `src/scopeConstants.ts` (the master analyser trace), `src/focusTrap.ts`, `src/sequencerConstants.ts` (`KIND_LABELS`, `DIVISOR_OPTIONS`, `NOTE_NAMES`) |
| The five tabs | `src/partsTab.ts` (the patch editor over the selected slot), `src/mixerTab.ts` + `src/mixerTables.ts` (strips and sends) with `src/returnsPanel.ts` (the plate and the delay, in the document's `returns`), `src/sequencersTab.ts` (a lookup in the card registry) + `src/seqFields.ts` (the field knobs, the divisor picker, the density controls, capture/release) + `src/sequencerKnobTables.ts`, `src/harmonyTab.ts` + `src/harmonyTables.ts` (key, scale, degree weights, per-part register), `src/arrangementTab.ts` + `src/arrangementConstants.ts` (transport, bpm, seed, export/import, new song) |
| Operator bays, knobs, the User-wave harmonic editor | `src/patchBays.ts`, `src/patchPanels.ts` + `src/patchPanelConstants.ts` (algorithm picker, globals, filter, LFO, pitch envelope), `src/patchKnobTables.ts` (every patch knob as data, with no `def` — `patchKnobOpts` reads `makePatch()` at the path), `src/harmonicEditor.ts` + `src/harmonicModel.ts` (pure) + `src/harmonicConstants.ts` |
| Envelopes: the display, its knobs, moving one between the six slots (#588) | `src/envCanvas.ts` + `src/envCanvasConstants.ts` (the drawing, which calls the engine's `segmentLevel`), `src/envelopeKnobs.ts` (the knob groups, over `ENVELOPE_KNOBS` / `ENVELOPE_ADV_KNOBS`), `src/envelopeTransfer.ts` (pure: `ENVELOPE_SLOTS`, `copyEnvelope`, `swapEnvelopes` — a copy carries loop mode and key scaling), `src/envelopeDrag.ts` (the pointer state machine, the ghost, the drop). Drag a curve onto another display to copy it, shift-drag to swap |
| The operator's Coarse / Fine ratio pair (#587) | `src/ratioSplit.ts` (pure: `split` / `join` over the one `ops.<i>.ratio` field, floored at the console's `RATIO_MIN` — the engine stays unclamped), `src/ratioKnobs.ts` (the specs, the readout, the Fixed swap) |
| The part list: new song, add/remove parts, sequencer kind, names (#598) | `src/songParts.ts` (pure: `newSong`, `addPart`, `setSequencerKind`, returning a raw document for the normaliser to fill), `src/partListControls.ts` (the Parts-tab row), `src/partNameField.ts` (the one name field, in Parts and on each Mixer strip), `src/songConstants.ts`; removal is the engine's `removePart` |
| The sequencer cards' shared machinery and the card registry | `src/stepStrip.ts` (the `Strip` type, `specOf` / `commitSteps`, `stripCell` / `stripColumn` / `markPlaying`, `paintStrip`, the one `requestAnimationFrame` playhead loop, and `playheadAt` — the console's only reading of `Scheduler.audibleTick`, handed straight to the engine's `host.stepAt` / `AudioSystem.stepAt`), `src/sequencerCards.ts` (`SEQUENCER_CARDS`: one factory per `SequencerKind`, which `src/sequencersTab.ts` looks a part's card up in — a new kind is a new card file and an appended entry, and `sequencerCards.test.ts` fails without one) |
| The grid card: step columns, the degree picker from the key, length / skip / accent knobs (#603) | `src/gridCard.ts` (the columns and the controls over the shared strip), `src/gridModel.ts` (pure: cycle a step's kind, degree, octave, flags; grow the list for a length; fold a degree against the scale), `src/gridConstants.ts` (what Randomize draws, how far Rotate turns) |
| The chord card: picker, drag, per-step dials (#607) | `src/chordCard.ts` (the strip and the dials), `src/chordStepModel.ts` (pure: chips and step labels for a key, `dropOn`, `turnDial`), `src/chordDrag.ts` (the press-to-audition / drag-to-place state machine, tested through fakes), `src/chordPicker.ts` (the chips, the size and voicing controls, the ghost), `src/chordConstants.ts` |
| The Euclidean card: the figure strip lit per onset, a `k / n` readout, Steps resizing it at once, click-to-toggle capture (#610) | `src/euclidCard.ts` (the knobs, and the strip repainted from `host.capturePattern` each frame it changes), `src/euclidModel.ts` (pure: the Steps partial with the bounds carried along, the `k` knobs dragging each other, Rotate within `±n`, the cell toggle, the preview figure) |
| The arp and step cards | `src/arpCard.ts`, `src/stepCard.ts`: knobs, the step divisor and capture-to-fixed. Neither draws a strip — both take their notes from the key rather than from written steps, so there is no per-step column and no playhead |
| The patch library: browsing, selection, writes (#563) | `src/patchLibrary.ts` (which patch the selected part plays, and the fork-on-edit rule), `src/presetBrowser.ts` (exported as `presetPicker` by `patchLibrary.ts`), `src/libraryActions.ts` (the row: Init, Save, Copy to new, Delete, the folder grant, the unsaved marker) over `src/patchActions.ts` (pure), `src/libraryModel.ts` (folder or baked entries — the listing `audio/presetCatalog.ts` no longer duplicates), `src/libraryFolder.ts` (File System Access, IndexedDB handle, `PatchFolder` fake-able), `src/libraryConstants.ts` (including `AFTER_WRITE_COMMANDS`), `src/patchFileWriter.ts` (the bytes via `audio/patchFileSerialise.ts`), `src/patchMetadata.ts` (ids, names, tags; pure), `src/metadataModal.ts` (the template's `<dialog>`s, never `window.confirm`), `src/loudnessCheck.ts` (the browser-side clip check through `audio/offlineRender.ts`) |
| Audition input: QWERTY, on-screen keys, MIDI | `src/keyboard.ts` + `src/keyboardConstants.ts` (the one note path, Hold, Panic, bend/wheel; held keys are filed under `e.code` and Panic reaches every part this keyboard has sounded — #617); MIDI in `src/midiMessage.ts`, `src/midiPerformer.ts`, `src/midiInputs.ts` (pure), `src/midiConstants.ts`, and `src/midiAccess.ts`, `src/midiPanel.ts` (Web MIDI, device selector) |
| The page itself and the scripts around it | `build-editor.mjs` (+ `--check`), `editor-template.html` (markup, stylesheet and the three inline markers), the generated `patch-editor.html`, `lib/audioBundle.mjs` (the one esbuild call), `lib/afterWriteCommands.mjs` (the scripts' copy of the console's list, pinned equal by its test), `import-patches.mjs` + `lib/importPatches.mjs`, `sweep-headroom.mjs`, `migrate-patches-586.mjs` (a kept schema migration) |

## Design a sound or composition

Read [synth behavior](references/synth-behavior.md) before choosing operator
routing, envelopes, fixed frequencies or custom harmonics. Infer the sound's
role, register, gate length and mixer context from the request; ask only for
musical choices that remain material and unresolved.

- tacowars's established scoring direction is moody atmosphere and minimal dub
  techno. Use it when applicable; a new brief can choose a different palette.
  Soundtrack FX include sweeps, noise, pulses, glitches and tension textures.
  Do not expand a scoring task into gameplay laser/impact sounds.
- Start with an existing sound or `makePatch`; use `clonePatch` for an editable
  copy. Preserve factory IDs and unrelated song settings. A sound that should
  outlive the session is a library file, `audio/patches/<id>.json`, saved from
  the console (Init, Save, Copy to new) or written and swept; sound data never
  goes back into TypeScript.
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
#561 every patch, scoring or original, is one `audio/patches/<id>.json`
carrying its own category, tags, description and headroom record (decision
record `2026-09-15-561-patch-library-file-shape`); the recipe tables are
gone. `audio/presetCatalog.ts` carries the browser metadata and its filter; the
listing itself is the console's `libraryModel.listLibrary` over whichever library
it has open, browsed in `tools/patch-editor/src/presetBrowser.ts`. Reuse tags, retain IDs and keep
document overrides visible when extending the browser. A new or edited file
needs `node tools/patch-editor/sweep-headroom.mjs <id>` (or `--stale`) and
`node scripts/patch-library-index.mjs --write`; `npm run verify` checks both.
The console writes files itself (#563): a Chrome folder grant on `patches/`
makes Save and Copy to new write there, otherwise they download `<id>.json`
for `node tools/patch-editor/import-patches.mjs`.

## Preserve the complete song

Read [the document contract](../../../docs/log/2026-09-11-music-document-carries-patches-and-returns.md)
and [the self-contained rule](../../../docs/log/2026-09-15-562-song-documents-are-self-contained.md)
for song or console changes. A part references a preset ID, and since #562 a
song carries a snapshot of every patch it plays: on the game path the one
resolver (`PatchResolver` in `arrangementValidate.ts`) reads the document's
`patches` section only and throws on a missing id, naming the part. The editor
is the only caller that passes `makeArrangement(raw, { libraryFill })`; a
pre-#562 document has its parts filled from the library once, on open, and
embedded on the next export. A library edit therefore never changes a shipped
song until that song is re-exported. A new working sound must reach the
document, not just the live part, to survive export. The preset browser copies
the chosen patch into the document on selection (`choosePreset`), and knob
edits commit the working patch there through `pushPatch`.

Normalize through `makeArrangement`, and inspect corrections/dangling
references. Preserve `patches`, `returns`, each part's strip, harmony,
sequencers and captured patterns through export/import. A song is `version: 2`
with 1–8 parts; a part is identified by its `slot` (its engine part is
`music-<slot>` and its generator stream is seeded by it), never by its name, and
live partials address it as `{ parts: { <slot>: … } }` (#597). A partial patch edit differs from replacing
a full patch: recursive objects merge, while patch arrays replace wholesale
(`mergePatch`). Return IDs/kinds are code-owned; inspect their existing bounds.

New exported songs belong in `audio/arrangements/<name>.json`; the game
bundles them at build time and chooses one with `?music=<name>`.

## Verify the change that was made

- **Patch/DSP:** use `audio/__fixtures__/workletHarness.ts` and relevant
  `fmProcessor*.test.ts` / `patch.test.ts`. Measure seeded output, finite
  samples, audibility, peaks and release completion. Cover intended registers,
  velocities, gates and chords; include retrigger/steal behavior if changed.
  A short seed sweep cannot establish slow-envelope audibility or a universal
  clipping bound. Each patch file's `headroom` record is the retained worst
  seed, peak and seed count, written only by `tools/patch-editor/sweep-headroom.mjs`;
  the record's `contentHash` covers the patch, so an edited file fails
  `fmProcessorHeadroom.test.ts` until it is re-swept, and a schema change that
  adds a defaulted field refreshes every file's hash without a re-sweep through
  a kept migration script (#586's record). For a bit-identity comparison the
  harness can render with `specialise: false` (the generic voice loop, #548) or
  `dormancy: false` (#547); both must agree with the default path sample for
  sample. A migration proof against a captured fixture is a one-time test:
  retire it in the PR that merges the migration, or it fails on the first
  library edit (#583).
- **Songs/mixer:** use `arrangementDocumentDesk.test.ts`,
  `audioSystemDesk.test.ts`, `arrangementApply.test.ts` and the relevant
  generator/return tests, plus `patchResolver.test.ts` for the two resolver
  modes. Check round trips, document-only resolution on the game path and the
  library fill on the editor path, including a new patch and its preset switch
  in the same live change.
- **Console:** test its state operations — its tests run in Node with no DOM,
  so the testable unit is the pure model, the table or the write function, not
  the click handler — and check the affected controls in the browser when
  useful. Check that imported/exported sound state and live sound agree; UI
  movement alone is not that evidence. **Rebuild the tracked page**
  (`node tools/patch-editor/build-editor.mjs`) after an engine, schema, preset
  or console change, and commit it in the same PR: the page bundles the
  console with the engine, and that bundle **bakes the whole patch library** —
  `documentModel.ts` imports `PRESETS`, which `presets.ts` builds from the
  generated `patches/index.ts` over every `audio/patches/<id>.json`. So a
  patch file merged by anyone changes the page's bytes. The build asserts the
  no-Babylon and no-local-synthesis boundaries, and
  `build-editor.mjs --check` — which `npm run verify` runs after `build` —
  fails on a page whose sources have moved under it (#620).
- **Performance:** use the existing audio bench arm/load readout when the
  task calls for measurement; see the architecture and
  `docs/reference/client-measurement-seams.md`. Keep target/dev-machine and
  estimated/measured values distinct. Preserve worklet hot-path allocation
  discipline; heap snapshots alone cannot prove it.

Run the narrow checks while developing, then the repo's normal finish gate.
Review-pass counts, full-verify cadence, visual evidence and CI handoff stay
with the board workflow. Report a listening verdict as pending when it is
tacowars's remaining criterion; hand back exact sounds/steps rather than waiting
or equating passing DSP tests with musical approval. tacowars auditions in the
console with a MIDI controller as well as QWERTY, so a handback can name
velocity, pitch bend, mod wheel (which scales LFO amount through
`lfo.modWheelDepth` and adds to the filter envelope amount through
`filter.modWheelDepth`, #586) and sustain-pedal gestures, and which part to
select.
