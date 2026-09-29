# The undo history is recorded at AppContext.change

- **Date:** 2026-09-29
- **Status:** accepted (tacowars, 2026-09-29, epic windsor#112 "Design";
  the implementation points under "How" by the worker on windsor#124)
- **Links:** epic windsor#112 · windsor#124 (this seam, part 1) · the
  gestures (part 2) · the keys and buttons (part 3) · measurement
  `docs/research/2026-09-29-undo-history-memory/`

## Context

Windsor had no undo: a mistaken edit could only be fixed by hand or by
re-importing the song. Every song edit the user makes already goes through
`AppContext.change(partial)`, a patch edit included (`commitPatch`), and
`importDoc` is the only other way in (epic decision 1). `DocumentModel.merge`
builds a fresh normalised document through `makeArrangement` on every
change.

## Decision

1. **Snapshots, applied as a difference** (epic decision 2). A step keeps
   the document as it was before the step. An undo computes the partial
   that turns the current document into the snapshot and sends it to the
   live system through `host.apply`, as an edit does, so the engine sees an
   ordinary live partial, not a rebuild. The model adopts the snapshot
   itself (`DocumentModel.replace`), so the document after an undo or a
   redo is exactly the snapshot, by construction. No kind of edit needs a
   hand-written inverse.
2. **Two pure modules** in `packages/app/src/`:
   - `undoHistory.ts`: an undo stack and a redo stack of
     `{ before, label, tab }` steps, 100 deep (`undoConstants.ts`'s
     `UNDO_DEPTH`), the oldest dropped. A new record empties the redo
     stack. It has `clear()` and a listener, and knows nothing of the DOM
     or the engine.
   - `documentDiff.ts`: `documentDiff(current, target)`, the partial `p`
     for which `normalise(mergeDocument(current, p))` deep-equals `target`
     for every edit the console makes, except where the merge cannot say it
     (a part's place in the list, a return that was absent; see "How").
     In the keyed sections (`parts` by slot, `patches` by id) an entry only
     `current` holds becomes `null`. Below them a changed array, leaf or
     re-kinded record is sent whole, as `deepMerge` assigns it. Unchanged
     sections are left out, and two equal documents diff to `{}`.
3. **The snapshot is a reference.** `before` is the old `model.doc` itself,
   not a copy. Nothing in the app writes into `model.doc` in place (checked
   on windsor#124: the only assignments are `DocumentModel`'s own, and the
   working patch is a clone the normaliser copies out of).
   `appContextUndo.test.ts` pins it.
4. **The API on `AppContext`.**
   - `change(edit, label?)` records a step when it succeeds outside a
     gesture. A refused change records nothing. `label` defaults to the
     partial's top-level sections (`stepLabel`: "Transport").
   - `beginGesture(label)` / `endGesture()`: inside a gesture only the
     first `change` snapshots `before`. The outermost end records one step,
     and only if the document changed. Nested begins count.
   - `undo()` / `redo()` return whether they did anything. Each applies the
     difference with `host.apply`, then adopts the snapshot with
     `model.replace`, and moves the step between the stacks. A refused live
     apply notifies as `change` does and leaves both stacks and the
     document untouched.
   - Each step stores the tab that was active at its first change, and
     undo and redo `show()` it.
   - `canUndo`, `canRedo`, `undoLabel`, `redoLabel` and
     `onHistoryChange(listener)` for part 3's buttons.
5. **`importDoc` clears the history:** Import, New song and the restore on
   reload.
6. **Undo while playing is allowed** (epic decision 9). A structural
   difference goes through `host.apply` just as the forward edit did.

## How

These are the worker's, within the decisions above:

- **The model adopts the snapshot; it does not merge the difference.**
  `mergeDocument`, which every edit uses, cannot say two things a snapshot
  holds. A slot-keyed partial carries no position, and `mergePartList`
  appends a part at a slot the list lacks, so a restored middle part would
  come back last (and the Mixer's strips and the Song tab's lanes, drawn in
  list order, would move). `returns` is not a keyed section, so a return
  that was absent beside another would come back as its defaults.
  `DocumentModel.replace(doc)` adopts the already-normalised snapshot as the
  document and notifies as `merge` does; its report is the one normalising
  the snapshot gives. The merge keeps its semantics.
- **Removal below the keyed sections is `undefined` in the difference.** A
  key only `current` holds (`master`, `master.output`, `returns` or one
  return, a strip's `output`, the transport's `swing` and `loop`) is sent
  as `undefined`.
- **The engine is sent a removed section as its defaults.** The engine's
  live apply has no "absent": it skips an `undefined` section and keeps
  what it holds, so undoing the first reverb or master edit on a new song
  would leave the sound edited. `documentDiffLive` returns the partial for
  `host.apply` with each removed section spelled out as what the
  normaliser gives it when absent. Those are the values a system built
  without the section plays (a return absent from the document is built
  from the engine's `RETURNS`, which the normaliser's defaults equal), so a
  removed return, one of two included, reaches the engine exactly as a live
  partial, with no rebuild. No engine change is needed.
- **The live system is rebuilt where no partial reaches the snapshot
  exactly.** `documentDiffLive` also returns `rebuild`: true when merging
  the partial's parts by slot would list them in another order than the
  snapshot (a part restored anywhere but last). The undo then sends no
  partial and rebuilds the live system from the snapshot, through the path
  `importDoc` takes (`EngineHost.build`). It does the same after the live
  partial when the engine reports paths it ignored, so anything its merge
  ignores comes back exactly too. Epic decision 9 accepts the click.
- **A rebuild during playback plays on from the top.** It does not stop
  the transport: `EngineHost.rebuild` (`host.ts`) disposes the system and
  builds a new one at tick 0, and `HostTransport.adopt` starts it at once
  if ▶ is pressed. So the music drops out while the worklets load and then
  plays from tick 0, not from where it was. Only a part restored out of
  last place, or a partial the engine ignored some of, takes this path.
- **A change that leaves the document as it was records nothing,** like a
  gesture with no net change.
- **An undo or a redo while a gesture is open does nothing** and returns
  false, so no step is half-recorded.
- **An import during a gesture** drops the gesture's snapshot, so its end
  records nothing.

## Consequences

- Part 2 wraps each control's edit in `beginGesture` / `endGesture`, and
  part 3 calls `undo`, `redo` and the labels. Both need the methods on
  `AppCtx` in `context.ts`, which windsor#124 did not own.
- The history holds up to 100 whole documents. That is about 2 MB for the
  largest song in the repo and about 3.8 MB for an eight-part song, as
  measured in `docs/research/2026-09-29-undo-history-memory/`.
