# tools/patch-editor — the arrangement console

## What this tool is

The standalone console Pat designs sounds and songs in (#70, decision record
`2026-08-31-arrangement-console-and-runtime-arrangements`): five tabs — Parts,
Mixer, Sequencers, Harmony, Arrangement — over the **real** audio engine, plus
an audition keyboard and a MIDI path. It boots on a new song (one part, the
Init patch, no sequencer — #598) and opens a committed song through Import;
Export writes the normalised document, patches and returns included, which is
what `packages/client/src/audio/arrangements/<name>.json` holds and `?music=`
plays.

It is a **local tool, not a published page**: `patch-editor.html` at this
directory's root is one generated file with no imports and no dev server, run
from `file://` or any static server. Nothing here is bundled into the game.

Two `CLAUDE.md` files sit above this one: the root's invariants, and
`packages/client/CLAUDE.md` for the engine the console drives. The
`music-engine` skill holds the per-file map, the sound-design guidance and the
audio verification recipes; this file holds the console's structure, its rules
and its extension checklists, so neither states the other's content twice.

## Seams and non-negotiables

- **The console drives the real `AudioSystem`; it builds no audio graph of its
  own.** Its one import surface is
  `packages/client/src/audio/index-for-editor.ts` (everything `index.ts` has
  except `babylonBridge.ts`). `build-editor.mjs` asserts both boundaries and
  fails the build: the bundle contains no Babylon, and no console source —
  template or `src/*.ts` — names `createGain(`, `createDelay(`,
  `audioWorklet.addModule` or the rest of `FORBIDDEN_IN_CONSOLE_CODE`. A
  missing feature is an engine change plus a control here, never a local node.
- **Never restate an engine rule.** Where the engine already decides, the
  console reads the decision:
  - a knob's default is `makePatch()` at its path, the kind's
    `DEFAULT_*_CONFIG`, or the normaliser's constant — a `PatchKnobEntry` has
    no `def` field at all, and `knobDefaults.test.ts` walks every table (#618);
  - a playhead's position is `ArrangementPlayer.stepAt` through
    `AudioSystem.stepAt` → `host.stepAt`, read once in `stepStrip.ts`'s
    `playheadAt` (#619);
  - the envelope display draws the engine's `segmentLevel`, pinned
    sample-for-sample against the FM worklet (`worklet/fm/`) by
    `envelopeCurve.test.ts` (#620);
  - a new part's strip, velocity and sequencer fields come from the
    normaliser: `songParts.ts` returns a raw document for `DocumentModel` to
    renormalise rather than filling them in.
  A copy drifts, and the drift reaches the document: #617's Euclidean `k`
  default put a value into songs the engine would never choose.
- **Every edit reaches the document, or it did not happen — and stays live.**
  A field edit is `ctx.change(partial)` — applied live *and* deep-merged into
  the document; so is a structural edit since #629 — a whole part at a free
  slot adds it, `null` at a slot or a patch id removes it, a kind change sends
  the kind's whole default spec (`partEdits.ts`, `removePartChange`), and the
  engine adds or disposes that one part on the running transport; a refused
  partial changes nothing and never falls back to a rebuild.
  `ctx.restructure(draft => …)` — mutate, renormalise, rebuild the live system
  from tick 0, re-render — is the Restart button's and nothing else's; an
  import is `ctx.importDoc(raw)`, the other rebuild; a patch knob is
  `PartsSession.push()`, which writes the working patch into the document's
  `patches` section under the part's preset name. Live-only state is lost on
  export and is a bug.
- **A part is addressed by its slot, never by its name** (#597):
  `{ parts: { 2: … } }`, `partAt(doc, slot)`, `musicPartName(slot)`. A rename
  touches no strip, patch, capture or note stream.
- **Tunables live in one `<area>Constants.ts` / `<area>Tables.ts` beside the
  logic** (root CLAUDE.md "Code structure"; `no-magic-numbers` reaches
  `tools/*/src/**/*.ts` since #618, with `*Constants.ts` / `*Table*.ts` /
  `*.test.ts` as the only ignores). `main.ts` is composition and has no table
  of its own — the number it configures lives in the area's table
  (`hostConstants.ts`'s `HOST_PUMP_INTERVAL_MS`).
- **One palette, one set of formatters, one DOM builder set**:
  `consoleColors.ts` (pinned to the template's CSS custom properties by
  `consoleColors.test.ts`), `consoleFormat.ts`, `dom.ts`. `el(tag, class,
  text)` sets `textContent`; `html()` is the explicit markup opt-in, and
  anything user-supplied goes through `escapeHtml`.
- **One step strip and one playhead loop** (`stepStrip.ts`, #619), **one card
  per sequencer kind through `SEQUENCER_CARDS`** (`sequencerCards.ts`), the
  way `FRAME_SYSTEMS` and `SIM_SYSTEMS` order the game's loops (ADR
  `2026-09-05-system-registries-folder-ownership-and-data-separate-from-logic`).
  A tab never branches on a kind.
- **`patch-editor.html` is generated and checked, not authored** (#620
  decision 6) — see "The tracked page" below.

## The layers

Composition → context → tabs → cards → pure models → the engine. Each layer
knows the one below it and nothing above.

1. **`main.ts` is composition only** (57 lines): it constructs the
   `DocumentModel`, the `EngineHost`, the `AppContext`, the `Keyboard` and the
   `MidiAccessor`, hands `mountTabShell` the five tabs, wires the power button
   and starts the look-ahead pump. No behaviour lives here.
2. **`appContext.ts` is the `AppCtx` implementation** (#620): it owns the tab
   registry, the `PartsSession` (whose `commit` is this context's document
   write, a constructor parameter rather than a module hook), and the
   operations every control calls — `change`, `restructure`, `importDoc`,
   `capture` / `release`, `livePart()`. `context.ts` is the interface the tabs
   import, so a card needs no import cycle back to the implementation. It
   knows no DOM beyond a panel's `hidden` flag, which is why
   `appContext.test.ts` drives it with fakes.
   - **Only the active tab renders** (#620 decision 2): `render()` marks every
     tab dirty and renders the active one, `activate(id)` renders a dirty tab
     once when it is shown, and `rebuild()` is the one path a structural
     change or an import takes to the live system and to every tab.
   - **`livePart()` is resolved per call**, because the keyboard and a MIDI
     controller must follow an enable or a rebuild while the Parts tab is
     hidden and its render deferred.
3. **`tabShell.ts`** builds the buttons and panels and registers each tab with
   the context; `powerButton.ts` is the first user gesture that creates the
   audio context and builds the live system.
4. **The tabs** — `partsTab.ts`, `mixerTab.ts`, `sequencersTab.ts`,
   `harmonyTab.ts`, `arrangementTab.ts` — lay out sections and hand each
   control the context. `sequencersTab.ts` is a lookup in `SEQUENCER_CARDS`.
5. **The cards and panels** — `arpCard.ts`, `stepCard.ts`, `gridCard.ts`,
   `chordCard.ts`, `euclidCard.ts`, `patchBays.ts`, `patchPanels.ts`,
   `returnsPanel.ts`, `envCanvas.ts` / `envelopeKnobs.ts`,
   `harmonicEditor.ts`, `presetBrowser.ts`, `libraryActions.ts`,
   `metadataModal.ts`, `midiPanel.ts` — draw DOM and call the context. The
   shared machinery they draw on is `stepStrip.ts`, `knob.ts`,
   `patchPath.ts`, `seqFields.ts` and `dom.ts`.
6. **The pure models** — `gridModel.ts`, `chordStepModel.ts`,
   `euclidModel.ts`, `harmonicModel.ts`, `songParts.ts`, `patchActions.ts`,
   `patchMetadata.ts`, `libraryModel.ts`, `ratioSplit.ts`,
   `envelopeTransfer.ts`, `midiMessage.ts`, `midiInputs.ts`, `focusTrap.ts`,
   `loudnessCheck.ts` — take values and return values. **The tests run in
   Node with no DOM**, so a rule worth testing belongs in a model, a table or
   a write function, not in a click handler (`patchPanels.test.ts` tests
   `writeToggle`, not the button).
7. **The engine**, through `index-for-editor.ts` only. `host.ts` owns the one
   `AudioContext` for the life of the page and the blob-URL worklets;
   `documentModel.ts` keeps the document *normalised* at all times, so the
   export/import round trip is equality by construction.

The per-file map — which file owns what, for all of `src/` — is the
`music-engine` skill's console table.

## Extension checklists

Each is the whole list; a step skipped here is what a later ticket finds.

**Add a sequencer kind**

1. Engine: append the name to `SEQUENCER_KINDS` (`arrangement.ts`) and the
   spec type; a `case` in `normaliseSequencer` (`sequencerNormalise.ts`) with
   its `DEFAULT_*_CONFIG`; the generator class; a `case` in
   `ArrangementPlayer`'s build switch **and its own `stepAt`**, plus the
   dispatch in `ArrangementPlayer.stepAt` if the kind shows a position (#619
   decision 2 — the console never computes one).
2. Console: a pure model beside its card, with a test; a `<kind>Card.ts`
   drawing over `stepStrip.ts` (`specOf`, `commitSteps`, `stripCell` /
   `stripColumn`, `paintStrip`, `watchPlayhead`) — never a second strip or a
   second `requestAnimationFrame` loop; an entry in `SEQUENCER_CARDS`
   (`sequencerCards.test.ts` fails without it); a label in `KIND_LABELS`
   (`sequencerConstants.ts`); knob specs in `sequencerKnobTables.ts` reading
   the kind's `DEFAULT_*_CONFIG`; a register default in
   `harmonyTables.ts`'s `REGISTER_OCTAVE_DEFAULTS` if the kind is pitched;
   any tunable of its own in a `<kind>Constants.ts`.
3. A row in the `music-engine` skill's console table, and a rebuilt page.

**Add a return or FX kind**

1. Engine: an entry in `RETURNS` (`mix.ts`) with its kind and defaults — the
   routing takes any number of returns, and `RETURN_NAMES` follows — the
   return's own node in `returnBus.ts`, and the sends that name it in
   `ChannelStrip`. A document's `returns` section is normalised with the rest
   of the song, so an old song must load unchanged.
2. Console: its knobs in `returnsPanel.ts` over ranges in `mixerTables.ts`
   (the plate's ranges stay the worklet's `REVERB_SPACE_RANGES`), each edit
   through `ctx.change` into the document's `returns` section like every other
   field, and the strip's send in `mixerTab.ts`.
3. The document contract holds: a song carries its returns, so the export must
   round-trip the new fields (`arrangementDocumentDesk.test.ts`).

**Add a strip insert kind** (#641; chorus, #642, is the worked second example)

1. Engine: one `inserts/<kind>Insert.ts` exporting its spec type, its
   `DEFAULT_<KIND>` and an `InsertKind` (`fields`, `defaults`, `normalise`,
   `create`); its ranges in `inserts/insertConstants.ts`; the spec in
   `InsertSpec` and an appended entry in `INSERT_KINDS`
   (`inserts/insertRegistry.ts`). `create` builds a fixed graph whose `set` is
   param writes only; `dispose` disconnects what it built, never the edge out
   of its `output`, and `stop()`s any source node it started. The strip, the
   normaliser and the live path need no edit.
2. Console: a `<kind>Card.ts` over `insertKnobs.ts`, its knob entries in
   `insertKnobTables.ts` reading `DEFAULT_<KIND>`, its label in
   `INSERT_LABELS`, and an entry in `INSERT_CARDS` (`insertCards.test.ts`
   fails without one).
3. A render test of its sound and its bounds beside the kind, and a rebuilt
   page.

**Add a harmony mode**

- A **scale** is an entry in `SCALES` (`audioConstants.ts`, surfaced by
  `scaleSampler.ts`'s `SCALE_NAMES` / `scaleOffsets`); `harmonyTab.ts` picks
  it up from `SCALE_NAMES` and the degree-weight row sizes itself from
  `scaleOffsets`, so no list is written twice. Degrees past the scale fold
  with octave carry (`foldDegree`).
- A **chord quality, voicing or duration** is `chordTables.ts`
  (`CHORD_QUALITIES` / `QUALITY_INTERVALS` / `QUALITY_LABELS`,
  `CHORD_VOICINGS`, `CHORD_DURATIONS`) plus the stacking rule in
  `chordTheory.ts` and, if it changes what notes sound, `chordVoicing.ts`;
  the console surfaces it in `chordPicker.ts` / `chordStepModel.ts` and, for a
  per-part register, `harmonyTables.ts`.
- Pitch only belongs in Harmony. The density LFOs are the Sequencers tab's
  (`seqFields.ts`'s `densityControls`).

**Add a knob**

1. An entry in the area's table — `patchKnobTables.ts` (patch fields),
   `sequencerKnobTables.ts`, `harmonyTables.ts`, `mixerTables.ts` — naming the
   path or field, the range and the readout (`consoleFormat.ts`).
2. **No default in the table**: a patch knob's comes from `makePatch()` at its
   path via `patchKnobOpts`; a sequencer, harmony or mixer knob asserts
   against the engine's `DEFAULT_*` value in `knobDefaults.test.ts`. Extend
   that test's walk when a new table appears.
3. Build it with `pathKnob` (working patch) or `driverKnob` / `sectionKnob` /
   `tableKnob` (`seqFields.ts`), so the commit path stays the one in §"Every
   edit reaches the document".

**Add a library action**

1. The rule goes in `patchActions.ts`, pure, over `libraryModel.ts` and the
   open document, with a test; metadata rules in `patchMetadata.ts`.
2. The button goes in `libraryActions.ts`'s row; a modal is the template's
   `<dialog>` through `metadataModal.ts` (never `window.confirm`), focus
   trapped by `focusTrap.ts`.
3. A write goes through `patchFileWriter.ts` (the folder grant in
   `libraryFolder.ts`, otherwise a download for `import-patches.mjs`), and the
   row shows `AFTER_WRITE_COMMANDS` (`libraryConstants.ts`) — pinned equal to
   the scripts' copy in `lib/afterWriteCommands.mjs` by its test.

## The tracked page

`patch-editor.html` is generated by `build-editor.mjs`: the template, the five
worklet sources inlined verbatim as strings the page turns into blob URLs, and
the console app bundled with the engine through `index-for-editor.ts` (one
esbuild call, `lib/audioBundle.mjs`). It is marked `linguist-generated=true`
and is **checked, not trusted** — `node tools/patch-editor/build-editor.mjs
--check` builds to memory and exits 1 when the tracked file differs, and
`npm run verify` runs it after `build`.

A conflict on it is git's to resolve: `scripts/git-merge-regenerate-console-page.sh`,
the merge driver `.gitattributes` names and `scripts/dev-bootstrap.sh` registers
(#628), keeps a clean text merge and regenerates the page from this tree's
sources when the text conflicts — `--check`, never the driver, is what says the
page matches its sources.

**The page bakes the whole patch library.** `documentModel.ts` imports
`PRESETS`, which `presets.ts` builds from the generated `patches/index.ts`
over every `packages/client/src/audio/patches/<id>.json`. So a patch file
added, edited or merged by anyone changes this page's bytes, and `--check`
fails until it is rebuilt — that is the intended signal, not a surprise. The
same holds for a schema, DSP, engine or console-source change. Rebuild with
`node tools/patch-editor/build-editor.mjs` and commit the page in the same PR.

## Commands

```bash
node tools/patch-editor/build-editor.mjs          # rebuild the tracked page
node tools/patch-editor/build-editor.mjs --check  # what verify runs: stale page → exit 1
npx vitest run tools/patch-editor                 # the console's tests (Node, no DOM)
npm run typecheck                                 # includes tools/patch-editor/tsconfig.json, the type gate
                                                  # (esbuild strips types without checking them; the
                                                  # standalone `tsc -p` needs packages/shared built first)
npx eslint tools/patch-editor                     # includes no-magic-numbers over src/
node tools/patch-editor/sweep-headroom.mjs --stale        # after a patch file is written
node scripts/patch-library-index.mjs --write              # regenerate patches/index.ts
node tools/patch-editor/import-patches.mjs                # move downloaded <id>.json into patches/
npm run verify                                            # the PR gate
```

Open the console by loading `tools/patch-editor/patch-editor.html` in Chrome
and pressing the power button; audio starts on that gesture. A MIDI
controller is offered once the browser grants access (#523).

## Hard-won constraints

- **A rebuild reuses the same `AudioContext`.** Worklet module maps are per
  context and keyed by URL, so re-`init` with the same blob URLs resolves from
  cache instead of re-registering the processors. `enable()` gates on the
  system and joins an in-flight build; a failed attempt tears the context down
  so the next press starts clean (#617).
- **Hidden tabs are hidden, not detached** (#619, #632). A card in a hidden
  tab keeps its `watchPlayhead` loop scheduling frames, but the loop **idles**:
  the card passes `shown` — `root.closest('[hidden]') === null`, layout-free,
  so never `offsetParent`, `getBoundingClientRect` or `checkVisibility` per
  frame — and a frame where it is false queues the next frame and returns,
  before the repaint check and the engine's `stepAt`. Nothing resets on hide,
  so the step lit when the tab went away stays lit and the first shown frame
  moves it if the transport moved. `attached()` keeps its one meaning: the
  loop ends when the card leaves the DOM. That is the whole lifecycle — a tab
  hiding or showing fires no event here.
- **Arrays replace wholesale in a merge; objects recurse.** A step list, a
  captured pattern or a partial table is committed whole (`commitSteps`), and
  `deepMerge` in `documentModel.ts` differs from the engine-side merge in one
  way only: it creates keys the current document lacks, because the result is
  renormalised immediately.
- **The console is the one caller that passes a library fill** (#562): a
  pre-#562 song has its parts filled from the library once, on open, and
  embedded on the next export. A library edit therefore never changes a
  shipped song until that song is re-exported.
- **`RATIO_MIN` (0.0625) is the console's floor, not the engine's** (#618
  decision 2, record
  `2026-09-18-618-console-ratio-floor-and-the-tools-lint-fence`): the
  normaliser stays unclamped, so a file may carry any ratio and the Coarse /
  Fine pair is what refuses to dial below the floor.
- **The keyboard's held map is keyed on `e.code`, and Panic reaches every part
  that sounded** (#617): a layout-dependent `e.key` stuck notes on, and a
  latched note on a part the selection has since left is still sounding.
- **The template's stylesheet is brace-checked by the build** (#610): a rule
  that loses its closing brace silently nests every later rule, and the
  console renders unstyled with the build and every test green.
- **`dsp.d.ts` types the five inlined worklet sources** (`window.__A204_DSP__`);
  it exists because the page, not the module graph, supplies them.
