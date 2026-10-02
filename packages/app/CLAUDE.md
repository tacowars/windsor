# packages/app — Windsor's app (the arrangement console)

## What this package is

`@windsor/app`: the browser UI tacowars designs sounds and songs in — Windsor's
arrangement console, forked from Aotearoa204's `tools/patch-editor/` on
2026-09-27 (#70, decision record
`2026-08-31-arrangement-console-and-runtime-arrangements`): four tabs — Parts,
Mixer, Song, Arrangement — over the **real** audio engine, plus
an audition keyboard and a MIDI path. It boots on a new song (one part, the
Init patch, no sequencer — #598) and opens a committed song through Import;
Export writes the normalised document, patches and returns included — one
file is the whole piece, and Import reads it back. The user's own patches and
the autosaved open song live in the browser's IndexedDB
(`2026-09-27-user-library-in-indexeddb`); on a reload the console asks before
restoring that song.

It is a **Vite app deployed as static files**: `index.html` (markup only),
`src/console.css` (the whole stylesheet, imported by `src/main.ts`) and
`src/main.ts` as a module script. `npm run dev` serves it with HMR on :5173;
`npm run build` writes `packages/app/dist/`, which any static host serves.

The root `CLAUDE.md` holds the invariants and the repo layout, and
`packages/engine/src/worklet/CLAUDE.md` the DSP the engine loads. The
`windsor-engine` skill holds the per-file map, the sound-design guidance and the
audio verification recipes; this file holds the console's structure, its rules
and its extension checklists, so neither states the other's content twice.

## Seams and non-negotiables

- **The console drives the real `AudioSystem`; it builds no audio graph of its
  own.** Its one import surface is `@windsor/engine`
  (`packages/engine/src/index.ts`); ESLint's `no-restricted-imports` refuses
  a deep `@windsor/engine/<path>` or relative `../engine/` import from
  `src/` (tests may reach fixtures that way), and the engine never imports
  the app. `consoleBoundary.test.ts` fails when any console source —
  `index.html` or `src/*.ts` — names `createGain(`, `createDelay(`,
  `audioWorklet.addModule` or the rest of `FORBIDDEN_IN_CONSOLE_CODE`. A
  missing feature is an engine change plus a control here, never a local node.
- **Never restate an engine rule.** Where the engine already decides, the
  console reads the decision:
  - a knob's default is `makePatch()` at its path, the kind's
    `DEFAULT_*_CONFIG`, or the normaliser's constant — a `PatchKnobEntry` has
    no `def` field at all, and `knobDefaults.test.ts` walks every table (#618);
  - a card's playhead is the engine's `ArrangementPlayer.regionStepAt`
    through `AudioSystem.regionStepAt` → `host.regionStepAt`, read once in
    `regionPlayhead.ts`'s `regionPlayheadAt` (#619 decision 2, windsor#97,
    windsor#101): the step sounding while the song is in the card's region,
    a ghost on the step its pattern would be on while it is not, dark while
    the transport is halted. Nothing in the console folds a tick into a
    region or a step. The audible tick itself is read once, in
    `HostTransport.position()` (#708);
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
  an import is `ctx.importDoc(raw)`, the one rebuild the UI offers (Restart
  went with #708 and `ctx.restructure` with #709, when nothing but a test
  still called it); a patch knob is
  `PartsSession.push()`, which writes the working patch into the document's
  `patches` section under the part's preset name. Live-only state is lost on
  export and is a bug.
- **A part is addressed by its slot, never by its name** (#597):
  `{ parts: { 2: … } }`, `partAt(doc, slot)`, `musicPartName(slot)`. A rename
  touches no strip, patch, capture or note stream.
- **Tunables live in one `<area>Constants.ts` / `<area>Tables.ts` beside the
  logic** (root CLAUDE.md "Code structure"; `no-magic-numbers` reaches
  `packages/*/src/**/*.ts` — the app since #618 — with `*Constants.ts` / `*Table*.ts` /
  `*.test.ts` as the only ignores). `main.ts` is composition and has no table
  of its own — the number it configures lives in the area's table
  (`hostConstants.ts`'s `HOST_PUMP_INTERVAL_MS`).
- **One palette, one set of formatters, one DOM builder set, one way to
  tell the user something**:
  `consoleColors.ts` (pinned to `console.css`'s custom properties by
  `consoleColors.test.ts`), `consoleFormat.ts`, `dom.ts`, and
  `ctx.notify(message, tone)` — a toast (`toast.ts` over `toastModel.ts`,
  record `2026-09-28-notices-are-toasts`). Pick the tone: `info`,
  `success`, `warning`, or `error` for something the user must act on,
  which stays until dismissed. Nothing writes status text into the header. `el(tag, class,
  text)` sets `textContent`; `html()` is the explicit markup opt-in, and
  anything user-supplied goes through `escapeHtml`.
- **One step strip and one playhead loop** (`stepStrip.ts`'s
  `watchPlayhead`, #619; `regionPlayhead.ts` says where and lights it), **one card
  per sequencer kind through `SEQUENCER_CARDS`** (`sequencerCards.ts`) — a
  registry, the way Aotearoa204's ADR
  `2026-09-05-system-registries-folder-ownership-and-data-separate-from-logic`
  ordered that game's loops.
  A tab never branches on a kind — the Song view's per-kind lookups are
  tables (`songViewTables.ts`'s `LANE_TONE`, `REGION_SUMMARY`,
  `CYCLE_TICKS`). Since #709 every `watchPlayhead` without a frame source of
  its own joins one `requestAnimationFrame` (`createFrameDriver`), so the
  ruler line and the card in the pane are one request, not two.
- **Nothing in the page is generated.** Aotearoa204's single-file
  `patch-editor.html` (#620 decision 6) is gone with its generator; Vite
  builds `dist/` from the sources — see "The build" below.

## The layers

Composition → context → tabs → cards → pure models → the engine. Each layer
knows the one below it and nothing above.

1. **`main.ts` is composition only** (67 lines): it constructs the
   `DocumentModel`, the `EngineHost`, the `AppContext`, the `Keyboard` and the
   `MidiAccessor`, hands `mountTabShell` the four tabs, wires the power button,
   starts `userSession.ts`'s `bootUserState` (the user library, the restore
   question, the autosave) and the look-ahead pump. No behaviour lives here.
2. **`appContext.ts` is the `AppCtx` implementation** (#620): it owns the tab
   registry, the `PartsSession` (whose `commit` is this context's document
   write, a constructor parameter rather than a module hook), and the
   operations every control calls — `change`, `importDoc`, `livePart()` (the
   Euclidean capture and release went with #705: the card commits
   `host.capturePattern` through `ctx.change` itself). `change` carries a
   `transport.bars` edit through every whole-song region and the timeline's
   tail (`regionModel.ts`'s `followSongLength`, #709 decision 4), so the
   strip's Bars knob needs no knowledge of regions. `context.ts` is the interface the tabs
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
   the context; **`transportStrip.ts`** (#708) is the one piece of chrome
   above every tab — BPM, Bars, 4/4, key, scale, the `bar.beat.sixteenth`
   position and ▶ ■ ‖ — registered through `ctx.addChrome`, so it renders on
   every `render()` and never on `invalidate()` or `refreshTabs()` (the Bars knob's, which re-renders the active tab under the strip). The buttons are
   `ctx.transport` (`host.ts`'s `HostTransport`: ▶ unmute + start, ‖
   `AudioSystem.setMuted(true)`, ■ `AudioSystem.stopMusic` — stop, release, rewind to tick 0
   with every region gate cleared); the rules are `transportModel.ts`, the
   ranges `transportTables.ts`. Power-on leaves the transport idle at 1.1.1;
   the position reads `ctx.transport.position()` on `watchPlayhead`; `powerButton.ts` is the first user gesture that creates the
   audio context and builds the live system.
4. **The tabs** — `partsTab.ts`, `mixerTab.ts`, `songTab.ts`,
   `arrangementTab.ts` — lay out sections and hand each control the context.
   `songTab.ts` is the Song view's composition (#709): its one piece of state
   (the selection), the lanes and the pane — see "The Song view" below.
5. **The cards and panels** — `gridCard.ts`, `chordCard.ts`, `euclidCard.ts`,
   `arpCard.ts`, `bassCard.ts`, `harmonyCard.ts`, `songDetailPane.ts`,
   `songRuler.ts`, `songHarmonyLane.ts`, `songLanes.ts`, `patchBays.ts`, `patchPanels.ts`,
   `returnsPanel.ts`, `envCanvas.ts` / `envelopeKnobs.ts`,
   `harmonicEditor.ts`, `presetBrowser.ts`, `libraryActions.ts`,
   `metadataModal.ts`, `midiPanel.ts` — draw DOM and call the context. The
   shared machinery they draw on is `stepStrip.ts`, `regionPlayhead.ts`, `knob.ts`,
   `patchPath.ts`, `seqFields.ts` and `dom.ts`.
6. **The pure models** — `gridModel.ts`, `chordStepModel.ts`,
   `euclidModel.ts`, `arpModel.ts`, `bassModel.ts`, `regionModel.ts`,
   `playheadDrag.ts`, `harmonyLaneModel.ts`, `harmonicModel.ts`, `songParts.ts`, `patchActions.ts`,
   `patchMetadata.ts`, `libraryModel.ts`, `ratioSplit.ts`,
   `envelopeTransfer.ts`, `operatorStart.ts`, `midiMessage.ts`, `midiInputs.ts`, `focusTrap.ts`,
   `loudnessCheck.ts`, `songAutosave.ts`, `songRestore.ts`,
   `storagePersistence.ts`, `toastModel.ts` — take values and return values. **The tests run in
   Node with no DOM**, so a rule worth testing belongs in a model, a table or
   a write function, not in a click handler (`patchPanels.test.ts` tests
   `writeToggle`, not the button).
7. **The engine**, through `@windsor/engine` only. `host.ts` owns the one
   `AudioContext` for the life of the page and calls `FmEngine.init({})`, so
   the worklets load from the engine's own `new URL(…, import.meta.url)`
   URLs;
   `documentModel.ts` keeps the document *normalised* at all times, so the
   export/import round trip is equality by construction.

The per-file map — which file owns what, for all of `src/` — is the
`windsor-engine` skill's console table.

## The Song view (#709)

Layout B of epic #703 (decision 1; mockups on the ticket): a bar ruler, the
harmony lane, one lane of regions per part by slot, one playhead line, and a
detail pane at the bottom. Its layers, top down:

1. **`songTab.ts`** — composition and the selection (`SongSelection`: a part
   and optionally one of its regions, a chord event, or nothing). Every edit
   ends in `view.commit(partial)`: one `ctx.change` live partial, then
   `ctx.invalidate()` and a repaint of the lanes (and the pane when asked).
   The lanes also repaint when their signature — bars, harmony, each part's
   regions, kind, summary and cycle — changes under a card's knob, checked
   by the one watch below. Never a rebuild.
2. **`songRuler.ts`** — the ruler (`rulerLabels`, beat ticks) and the **one
   playhead loop** of the view: `watchSongPlayhead` is a `watchPlayhead`
   over `ctx.transport.position()` that places the line, lights the playing
   chord block and runs the lanes' repaint check. The card in the pane keeps
   its own `watchPlayhead` for its cells; both are one frame request.
   While the transport is stopped or paused with audio on, the line's
   `bar.beat.sixteenth` label is a handle (`wirePlayheadDrag`, windsor#102):
   a drag previews the line on the nearest bar line, bar 1 to the last bar,
   and the release seeks there through `ctx.transport.seek` →
   `AudioSystem.seekMusic`. A cancel, a lost capture or a blur puts the line
   back. While it plays the label takes no press, so the ruler's zoom and
   scroll work under it. The rules are the pure **`playheadDrag.ts`**
   (`canDragPlayhead`, `snapBar`, `stepPlayheadDrag`).
3. **`songHarmonyLane.ts`** — blocks from the engine's `eventBounds`, named
   by `harmonyLaneModel.ts` (`eventLabel` over `chordOf` / `chordName` /
   `romanNumeral`), a right-edge drag that resizes the event and shifts the
   rest, the `+` tile that appends a bar of the last degree.
4. **`songLanes.ts`** — `.reg` blocks per region (tone, summary and cycle
   ticks from `songViewTables.ts`; ⟲ or ∞ from `regionMark`), and the
   pointer gestures over `regionModel.ts`: click a gap to add, drag an edge
   to resize, the body to move, alt-click to split, Shift for the modifier
   snap (the part's `divisor`, else the beat). A drag previews on the lane
   and commits once on release. `pointerDrag` is the shared press-or-drag
   helper (capture, threshold), the way `chordDrag.ts` does it.
5. **`songDetailPane.ts`** — the header ("Lead — Grid", "Harmony — bar 3")
   and close ×; for a part, the part's card from `SEQUENCER_CARDS` inside
   the sequencer device (`sequencerDevice.ts`, windsor#368): a 244 px rack
   row whose rail (`sequencerRail.ts`) holds the accent dot, the kind's
   name (a click folds it), the region `n/m`, and Split and Delete for the
   selected region (`sequencerDeviceModel.ts`, which reads the part from
   the document at the press). The pane has no region row and adds no
   knob. For a chord, `harmonyCard.ts` — seven degree chips, Triad |
   Seventh, the Duration dial (bars; beats under Shift), Delete.
6. **The pure models** — `regionModel.ts`, `harmonyLaneModel.ts`,
   `songViewTables.ts` (the px maths and the per-kind tables). The tests are
   theirs; the DOM files hold no rule worth testing.

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
   `harmonyTables.ts`'s `REGISTER_OCTAVE_DEFAULTS` if the kind is pitched,
   with an Octave knob in its own card; its lane in `songViewTables.ts` — `LANE_TONE`, `REGION_SUMMARY`,
   `CYCLE_TICKS` (`songViewTables.test.ts` fails without all three); any
   tunable of its own in a `<kind>Constants.ts`.
3. A row in the `windsor-engine` skill's console table.

**Add a lane kind** (#709) — a new row of the Song view beside the harmony
lane and the part lanes

1. A pure model beside it, with a test on the ticket's fixtures: what a
   click, a drag and a delete do to the document's list, every function
   returning a new list for `ctx.change` (arrays replace wholesale).
2. A `song<Kind>Lane.ts` returning `[nameCell, lane]` the way
   `harmonyLaneRow` and `partLaneRow` do, drawn from the document at the
   table's px-per-bar (`tickToPx`), gestures through `pointerDrag`, edits
   through `view.commit`; appended to `paintLanes` in `songTab.ts`.
3. Its input in `laneSignature` (`songTab.ts`), so a change from anywhere
   repaints it; its pane content (if it has one) as a new `SongSelection`
   kind in `songDetailPane.ts`.
4. Its CSS in `console.css`'s "the Song view" block.

**The send buses** (windsor#172; record
`2026-09-30-insert-rack-and-send-bus-chains`)

Send A and Send B are a level and an insert chain each, the song's
`returns.a` and `returns.b`; a part reaches them through `sends.a` and
`sends.b`. By default Send A holds a Plate reverb and Send B an Echo, both at
Mix 1 (`RETURNS`, `mix.ts`).

1. **An effect for a bus is an insert kind.** Add it as "Add a strip insert
   kind" below says, and every bus can hold it: the chain is the strip's
   (`insertChain.ts`), built from the same registry, so it follows the song's
   tempo and reports its load. If the kind should start differently on a bus,
   the way the plate and the echo start fully wet, that rule is `onSendBus`
   (`mix.ts`), which `addInsert` (`insertEdits.ts`) applies for a bus target.
2. **The console reaches a bus as an `InsertTarget`** (`'a'` or `'b'`,
   `insertTarget.ts`): `insertsOf`, `insertChange` and `liveInsert` read the
   document's chain (or the code's when the song has none), write
   `{ returns: { a: { inserts } } }`, and find the live stage. The Mixer tab's
   send buses (`returnsPanel.ts`) are each a name from `BUS_LABELS`, a Level
   knob and `stripInserts(ctx, bus)`, every edit through `ctx.change` with
   undo. A part's send needs no edit: the Song tab's expanded mixer column
   (`songMixerCell.ts`) builds one `sendKnob` (`→ A`, `→ B`) per
   `RETURN_NAMES` entry.
3. **Which buses exist is the code's.** A third bus is an entry in `RETURNS`
   (the routing takes any number, and `RETURN_NAMES`, the send knobs and the
   stems follow), a label in `BUS_LABELS`, and a format question: a song that
   names a bus this build lacks reports it as dangling
   (`deskNormalise.ts`).
4. The document contract holds: a song carries its buses' levels and chains,
   so the export must round-trip them (`arrangementDocumentDesk.test.ts`), and
   a change to their shape bumps `ARRANGEMENT_VERSION` with an upgrade in
   `songMigrations.ts`, as 3 → 4 did.

**The groups** (windsor#287; record `2026-10-01-group-buses`)

A group is the song's, not the code's: `groups` in the document, keyed by
`id` in a partial, at most `MAX_GROUPS`. A part reaches one through its
Output (`{ group: id }`), not a send.

1. **The rules are `groupModel.ts`**, pure over the normalised document:
   the add, rename, remove and route partials, the next name and id, and the
   members line. Remove sends every member to Master in the same partial,
   so one undo brings both back.
2. **The console reaches a group's chain as an `InsertTarget`**, its key
   `group:<id>` (`groupKey`), which no slot or bus name can collide with.
   A group's inserts start at the part defaults (`onSendBus` is for the send
   buses only), and its compressor keys from its own input, so the sidechain
   selector offers no part.
3. **The Mixer tab's Groups section** (`groupsPanel.ts`) draws each group as
   a send bus row, with its lights from `songMixerLights` keyed on group ids
   over `groupBus(id).meter`. The Song tab's Output select (`trackOutput.ts`)
   lists Master, the groups by name, then Sidechain; its values are
   `master`, `sidechain` and the group keys.

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
3. A render test of its sound and its bounds beside the kind.
4. Presets, if the kind has them: a `<kind>PresetTables.ts` of
   `InsertPreset` entries, each citing its source, and a `<kind>Presets.ts`
   over `inserts/insertPresets.ts`; the card is then a `presetInsertCard`
   (the chorus and the ensemble, #695). A native-node kind (the chorus, the
   ensemble) needs none of the worklet steps.

**Add a harmony mode**

- A **scale** is an entry in `SCALES` (`audioConstants.ts`, surfaced by
  `scaleSampler.ts`'s `SCALE_NAMES` / `scaleOffsets`); the transport strip
  picks it up from `SCALE_NAMES` (#708), so no list is written twice. Degrees
  past the scale fold with octave carry (`foldDegree`).
- A **chord quality, voicing or duration** is `chordTables.ts`
  (`CHORD_QUALITIES` / `QUALITY_INTERVALS` / `QUALITY_LABELS`,
  `CHORD_VOICINGS`, `CHORD_DURATIONS`) plus the stacking rule in
  `chordTheory.ts` and, if it changes what notes sound, `chordVoicing.ts`;
  the console surfaces it in `chordPicker.ts` / `chordStepModel.ts`, the
  harmony lane's labels and chips come from `harmonyLaneModel.ts` over the
  engine's `chordOf` / `chordName` / `romanNumeral` / `diatonicChords`, and a
  per-part register is `harmonyTables.ts`.
- Pitch belongs to the harmony lane and the register knobs. The density LFOs
  are the Euclidean card's (`seqFields.ts`'s `densityControls`).

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
2. The button goes in `libraryActions.ts`'s row; a modal is an
   `index.html` `<dialog>` through `metadataModal.ts` (never `window.confirm`), focus
   trapped by `focusTrap.ts`.
3. A write goes through `patchFileWriter.ts` and `libraryModel.ts`'s
   `writeLibraryFile`: into the user's library in IndexedDB
   (`userLibraryStore.ts`), into the folder while the developer's grant
   (`libraryFolder.ts`) is connected, or — in a browser with no IndexedDB —
   a download. Built-ins are read-only: a write over one is refused, and Save
   forks it (`saveForks`). Both stores are a `PatchFolder`, so a test fakes
   either in memory, and both read through the engine's one `loadPatchFile`,
   which upgrades an old format and fills a missing field.

## The build

Vite (`vite.config.ts`) builds the page, the hashed app bundle and each DSP
worklet the engine names with `new URL('../worklet/generated/*.js',
import.meta.url)` as its own asset — `assetsInlineLimit` refuses to inline a
`.js` file as a data URL, so every worklet loads through
`audioWorklet.addModule` from a real file. `base` is relative (`./`,
overridable with `WINDSOR_BASE`), so `dist/` serves from any path.
`loudnessCheck.checkLoudness(patch)` renders against the engine's default
worklet URL the same way.

Nothing here is tracked output. Two generated files sit upstream in the
engine, each with a `--check` that `npm run verify` runs:
`worklet/generated/*.js` (`scripts/build-worklets.mjs`) and `patches/index.ts`
(`scripts/patch-library-index.mjs`). The app bakes the whole patch library —
`documentModel.ts` imports `PRESETS`, which `presets.ts` builds from
`patches/index.ts` — so a patch file added or edited needs the index
regenerated, not the page.

Retired with the fork: `build-editor.mjs`, `editor-template.html`, the
tracked `patch-editor.html` and its `--check`, `src/dsp.d.ts` /
`window.__A204_DSP__`, blob-URL worklet loading and the page's merge driver
(records `2026-09-18-patch-editor-page-is-checked-not-trusted`,
`2026-09-18-console-page-merge-driver` stay as history).

## Commands

```bash
npm run dev                                    # Vite dev server with HMR on :5173
npm run build                                  # static build → packages/app/dist/
npm run preview                                # serve the built dist/
npx vitest run packages/app                    # the console's tests (Node, no DOM)
npm run typecheck                              # includes packages/app/tsconfig.json, the type gate
                                               # (Vite strips types without checking them)
npx eslint packages/app                        # no-magic-numbers and the import fence over src/
node scripts/patch-library-index.mjs --write   # after a patch file is written: regenerate patches/index.ts
node packages/app/import-patches.mjs           # move downloaded <id>.json into patches/
node packages/app/rewrite-patches.mjs          # after a patch format bump: rewrite the bank at the new format
npm run verify                                 # the gate
```

Open the console at the dev server's URL (or a served `dist/`) in Chrome and
press the power button; audio starts on that gesture. A MIDI controller is
offered once the browser grants access (#523).

## Hard-won constraints

- **A rebuild reuses the same `AudioContext`.** Worklet module maps are per
  context and keyed by URL, so re-`init` with the same URLs resolves from
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
- **IndexedDB is the one untested seam** (`2026-09-27-user-library-in-indexeddb`):
  the tests run in Node with none, so the user library is a `PatchFolder` and
  the autosave a `SongStore`, both faked in memory, and only
  `userLibraryStore.ts` touches the browser API. Check a change there in the
  browser (`npm run dev`, DevTools → Application → IndexedDB → `windsor`).
- **`console.css` is brace-checked by `consoleBoundary.test.ts`** (#610): a
  rule that loses its closing brace silently nests every later rule, and the
  console renders unstyled with the build and every other test green.
