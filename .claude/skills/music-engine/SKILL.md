---
name: music-engine
description: Design patches and compositions or develop Aotearoa204's custom FM music engine, song documents, mixer and standalone patch editor. Use for synth behavior, presets, sequencing, returns and audio verification; Babylon spatial-audio integration remains with the Babylon skill.
---

# Music engine

Work on the real instrument shared by the game and arrangement console.
Repository paths below are relative to the active worktree root; `audio/`
means `packages/client/src/audio/`. Follow root and client `CLAUDE.md` and the board quick-sheet for ticket work; this skill
adds audio-specific guidance, not another ticket or approval workflow.

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
| FM synthesis and voice lifecycle | `worklet/fm-processor.js`, `fmEngine.ts`, `audioPart.ts`, `workletMessages.ts` |
| Song schema and compatibility | `arrangementDocument.ts`, `arrangementNormalise.ts`, `arrangementValidate.ts`, `arrangementPlayer.ts` |
| Sequencing and harmony | `scheduler.ts`, `stepSequencer.ts`, `euclideanSequencer.ts`, `arpeggiator.ts`, `scaleSampler.ts`, `capturedPattern.ts` |
| Mixer, delay and plate | `mix.ts`, `channelStrip.ts`, `deskApply.ts`, `returnBus.ts`, `reverbSpace.ts`, `worklet/reverb-processor.js` |
| Game selection and live changes | `audioSystem.ts`, `arrangementLibrary.ts`, `musicOptions.ts` |

The console lives in `tools/patch-editor/`: `src/host.ts` owns its engine
connection, `src/documentModel.ts` its song state, and `src/partsTab.ts` /
`src/patchLibrary.ts` patch edits. It imports `audio/index-for-editor.ts`,
which excludes Babylon. Extend that surface rather than building another
synth, effect graph or sequencer in the console.

| Console task | Read/edit |
|---|---|
| Operator bays, knobs, the User-wave harmonic editor | `src/patchBays.ts`, `src/knob.ts`, `src/harmonicEditor.ts`, `src/harmonicModel.ts` (pure) |
| The operator's Coarse / Fine ratio pair (#587) | `src/ratioSplit.ts` (pure: `split`/`join` over the one `ops.<i>.ratio` field), `src/ratioKnobs.ts` (the specs, the readout, the Fixed swap) |
| Moving an envelope between the six displays (#588) | `src/envelopeTransfer.ts` (pure: `ENVELOPE_SLOTS`, `copyEnvelope`, `swapEnvelopes` — a copy carries loop mode and key scaling), `src/envelopeDrag.ts` (the pointer state machine, the ghost, the drop). Drag a curve onto another display to copy it, shift-drag to swap |
| Preset browsing and selection | `src/presetBrowser.ts` (exported as `presetPicker` by `src/patchLibrary.ts`) |
| Audition input: QWERTY, on-screen keys, MIDI | `src/keyboard.ts` (the one note path, Hold, Panic, bend/wheel); MIDI in `src/midiMessage.ts`, `src/midiPerformer.ts`, `src/midiInputs.ts` (pure) and `src/midiAccess.ts`, `src/midiPanel.ts` (Web MIDI, device selector) |
| Library writes: Init, Save, Copy to new, Delete (#563) | `src/patchActions.ts` (pure, over `src/libraryModel.ts`), `src/libraryActions.ts` (the row), `src/patchFileWriter.ts` (the file bytes via `audio/patchFileSerialise.ts`), `src/patchMetadata.ts` (ids, names, tags; pure), `src/libraryConstants.ts` |
| The folder grant and the page library | `src/libraryFolder.ts` (File System Access, IndexedDB handle, `PatchFolder` fake-able), `src/libraryModel.ts` (folder or baked entries, the browser's listing); `import-patches.mjs` + `lib/importPatches.mjs` move downloads into `patches/` |
| The metadata and confirm modals, focus | `src/metadataModal.ts` over `editor-template.html`'s `#metaDlg` / `#confirmDlg`; `src/focusTrap.ts` (pure); the loudness line is `src/loudnessCheck.ts` through `audio/offlineRender.ts` |

## Design a sound or composition

Read [synth behavior](references/synth-behavior.md) before choosing operator
routing, envelopes, fixed frequencies or custom harmonics. Infer the sound's
role, register, gate length and mixer context from the request; ask only for
musical choices that remain material and unresolved.

- Pat's established scoring direction is moody atmosphere and minimal dub
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
  Describe sonic intent separately from measured output and Pat's verdict.

**Scoring bank:** `docs/design/scoring-preset-library.md` is its guide. Since
#561 every patch, scoring or original, is one `audio/patches/<id>.json`
carrying its own category, tags, description and headroom record (decision
record `2026-09-15-561-patch-library-file-shape`); the recipe tables are
gone. `audio/presetCatalog.ts` only lists and filters, browsed in
`tools/patch-editor/src/presetBrowser.ts`. Reuse tags, retain IDs and keep
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
references. Preserve `patches`, `returns`, mix, harmony, drivers and captured
patterns through export/import. A partial patch edit differs from replacing
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
- **Console:** test its state operations and check the affected controls in
  the browser when useful. Rebuild the tracked standalone artifact after
  engine/schema/preset/editor changes:
  `node tools/patch-editor/build-editor.mjs`. The build checks its no-Babylon
  and no-local-synthesis boundaries. Check that imported/exported sound state
  and live sound agree; UI movement alone is not that evidence.
- **Performance:** use the existing audio bench arm/load readout when the
  task calls for measurement; see the architecture and
  `docs/reference/client-measurement-seams.md`. Keep target/dev-machine and
  estimated/measured values distinct. Preserve worklet hot-path allocation
  discipline; heap snapshots alone cannot prove it.

Run the narrow checks while developing, then the repo's normal finish gate.
Review-pass counts, full-verify cadence, visual evidence and CI handoff stay
with the board workflow. Report a listening verdict as pending when it is
Pat's remaining criterion; hand back exact sounds/steps rather than waiting
or equating passing DSP tests with musical approval. Pat auditions in the
console with a MIDI controller as well as QWERTY, so a handback can name
velocity, pitch bend, mod wheel (which scales LFO amount through
`lfo.modWheelDepth` and adds to the filter envelope amount through
`filter.modWheelDepth`, #586) and sustain-pedal gestures, and which part to
select.
