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
   that turns the current document into the snapshot and applies it through
   the same path as an edit: `host.apply`, then `model.merge`. No kind of
   edit needs a hand-written inverse, and the engine sees an ordinary live
   partial, not a rebuild.
2. **Two pure modules** in `packages/app/src/`:
   - `undoHistory.ts`: an undo stack and a redo stack of
     `{ before, label, tab }` steps, 100 deep (`undoConstants.ts`'s
     `UNDO_DEPTH`), the oldest dropped. A new record empties the redo
     stack. It has `clear()` and a listener, and knows nothing of the DOM
     or the engine.
   - `documentDiff.ts`: `documentDiff(current, target)`, the partial `p`
     for which `normalise(mergeDocument(current, p))` deep-equals `target`.
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
     difference with `host.apply`, then `model.merge`, and moves the step
     between the stacks. A refused live apply notifies as `change` does and
     leaves both stacks untouched.
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

- **Removal below the keyed sections is `undefined`.** A key only
  `current` holds (`master`, `master.output`, `returns`, a strip's `output`,
  the transport's `swing` and `loop`) is sent as `undefined`. The merge
  assigns it and the normaliser reads an `undefined` optional section as
  absent, so the document comes back exactly. `null` would read as junk
  there: the defaults, with a correction in the report.
- **The engine is sent a removed section as its defaults.** The engine's
  live apply has no "absent": it skips an `undefined` section and keeps
  what it holds, so undoing the first reverb or master edit on a new song
  would leave the sound edited. `documentDiffLive` returns a second partial
  for `host.apply`. It is the same partial, except that each removed
  section is spelled out as what the normaliser gives it when absent. The
  model still merges the first. No engine change is needed.
- **A change that leaves the document as it was records nothing,** like a
  gesture with no net change.
- **An undo or a redo while a gesture is open does nothing** and returns
  false, so no step is half-recorded.
- **An import during a gesture** drops the gesture's snapshot, so its end
  records nothing.

## Known gaps

The difference cannot say two things with today's merge. Both keep the
sound right, and neither changes a note:

- **Part order.** Undoing the removal of a part that was not last appends
  it at the end of the list: `mergePartList` (and the engine's
  `mergeParts`) append a part at a slot they lack, and a slot-keyed partial
  carries no position. The parts are otherwise exactly as they were.
- **One return of two.** `returns` is not a keyed section in
  `mergeDocument`. Undoing the first edit to the second return, while the
  other return is in the document, leaves the second return as its
  defaults in the document, where it was absent before. Removing the whole
  `returns` section is exact.

Closing either needs the merge (and for part order, the engine's merge) to
learn it. Neither is in windsor#124's files.

## Consequences

- Part 2 wraps each control's edit in `beginGesture` / `endGesture`, and
  part 3 calls `undo`, `redo` and the labels. Both need the methods on
  `AppCtx` in `context.ts`, which windsor#124 did not own.
- The history holds up to 100 whole documents. That is about 2 MB for the
  largest song in the repo and about 3.8 MB for an eight-part song, as
  measured in `docs/research/2026-09-29-undo-history-memory/`.
