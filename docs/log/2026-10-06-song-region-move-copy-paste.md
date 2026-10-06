# Song regions move past neighbours, and copy, cut, paste and duplicate

- **Date:** 2026-10-06
- **Status:** accepted (tacowars, 2026-10-06)
- **Links:** the region editing record `2026-10-03-song-region-editing` ·
  `2026-09-29-each-region-plays-its-own-pattern`

## Context

The part lanes can draw, split, trim, roll a seam and delete a region, but
a body drag stops at the next region, and nothing copies a region. Once a
split region's pattern has been edited, the only way to get a second copy
of it somewhere else was to split again and redo the edits. An A / B
rotation (A, B, A, B…) could not be built from one edited A.

## Decision

1. **A body drag goes anywhere in the song.** The region moves by the
   pointer's travel, snapped as before (the bar, or with Shift its own
   step), kept whole inside the song, and passes any neighbour.
2. **Whatever it lands on gives way: overwrite**, the way Ableton Live and
   Bitwig drop a clip. A region it covers is removed, one it overlaps is
   trimmed back to its edge, and one it lands inside is cut in two, both
   pieces keeping their pattern. The lanes stay sorted and
   non-overlapping, the shape the normaliser keeps, so the document format
   is unchanged. Undo takes the whole drop back in one step. An empty
   roll's loop follows any length this changes (windsor#608).
3. **Cmd/Ctrl-drag copies** the body: the original stays and the copy
   lands as a move would. The cursor shows `copy`. (Alt is already the
   split, so Alt-drag is not used for this.) A copy that overlaps its own
   original overwrites it like any other region, so the original is
   trimmed to the part the copy leaves uncovered. Regions never overlap,
   so the only other choice would be to refuse the drop. Ableton Live and
   Bitwig trim in the same way.
4. **The keys, on the Song tab** (Cmd and Ctrl both, on every platform, as
   the undo keys are; never in a text field or a dialog):
   - **Cmd/Ctrl+C** copies the selected region; **Cmd/Ctrl+X** cuts it.
   - **Cmd/Ctrl+V** pastes onto the selected part's lane at the
     playhead's bar. When the transport is stopped or paused, the playhead
     then moves to the end of the paste, so repeated pastes lay copies end
     to end, like a DAW's insert marker.
   - **Cmd/Ctrl+D** duplicates the selected region right after itself.
   - **Delete / Backspace** removes the selected region, as the rail's
     Delete does. A held Delete or Cut acts only once.
5. **A clip is a full copy of what the region plays**: its own pattern, or
   the part's sequencer (less the seed) for a region without one. The
   paste plays what was copied even if the source is edited or deleted
   later. It lives in the Song view's state for the session. It is never
   written to the document or to the system clipboard.
6. **A paste goes onto a part of the same sequencer kind only.** Any other
   paste is refused with a warning toast that names the kinds. Converting
   a pattern from one kind to another is out of scope.

## Consequences

- The pure rules are `regionPlacement.ts` (overwrite, move, copy),
  `regionClipboard.ts` (copy, cut, paste, duplicate) and `regionKeys.ts`
  (which key is which). `songRegionKeys.ts` wires the keys, and
  `partLaneModel.ts` / `partLaneGestures.ts` drive the drag.
- `regionModel.ts`'s `moveRegion` and `dragRegion`'s `move` case, which
  clamp to the neighbours, no longer drive the lane. They are kept for
  their callers and tests.
- Selecting several regions, and pasting across parts in one action, are
  not built. Both would extend the selection model first.
