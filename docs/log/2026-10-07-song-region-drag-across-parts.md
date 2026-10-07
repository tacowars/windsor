# A Song region drags onto another part of its kind

- **Date:** 2026-10-07
- **Status:** accepted (tacowars, 2026-10-07)
- **Links:** `2026-10-06-song-region-move-copy-paste` · windsor#637

## Context

A body drag moves or Cmd/Ctrl-copies a region anywhere along its own
lane, and Cmd/Ctrl+V pastes a region onto another part of the same
sequencer kind (`2026-10-06-song-region-move-copy-paste`). A drag could
not carry a region to another part, so building a layer or an answer
phrase from an edited A took a copy, a selection change and a paste.

## Decision

1. **A body drag drops onto any part lane of the same sequencer kind.**
   The lane under the pointer's height is the target. The source lane
   keeps the pointer's capture, so the target is read from the lanes'
   rects, never from the event's target; in the gap between two lanes the
   nearer one counts. Back over the source lane it is a same-lane move,
   as before. Edge trims, seam rolls and gap draws stay on their own lane.
2. **The horizontal placement is the same-lane move's:** the pointer's
   travel from the press, snapped to the dragged region's own grain (the
   bar, or with Shift its step), kept whole inside the song (`dropStart`),
   and laid over whatever it lands on in the target (`placeRegion`'s
   overwrite, the empty-roll fit included).
3. **What travels is what Copy + Paste carry** (`copyRegion` →
   `pasteRegion`). A cross-part drop plays the same as copying the region
   and pasting it at that start. There is no second notion of what a
   region plays.
4. **A move takes the region out of its source part and lays it on the
   target in one commit**, one `view.commit` holding both parts, so one
   undo puts both back. Cmd/Ctrl copies and leaves the source alone, and
   can be pressed or released mid-drag. While the drag is live, a move
   shows the source lane without the region, and the target lane shows
   the placed block with its readout.
5. **No drop elsewhere** (tacowars, 2026-10-07). Over a part lane of
   another kind, an automation lane, the harmony lane or off the part
   lanes, the cursor is `not-allowed` and the region shows back in its own
   lane. A release there changes nothing and toasts, as a warning, the
   words Paste refuses with, naming the dragged region's kind.
6. **The lanes show where it can go** (tacowars, 2026-10-07). While a
   body drag is live, every lane it can't drop on dims: part lanes of
   another kind, automation lanes, group lanes and the harmony lane.
   Compatible part lanes look as they do. The target lane under the
   pointer gets a border like a selected lane's. Trims, rolls and draws
   dim nothing. A release, a cancel, a lost capture or a blur clears it
   all.
7. **After a cross-part drop** the target part is selected, with the
   dropped region.
8. **The drag threshold.** `pointerDrag` counted horizontal travel only,
   so a straight vertical drag never started. A press may now opt into
   both axes; the part lanes opt in for a body press. The harmony lane,
   the loop brace and the playhead keep the horizontal-only threshold.
9. **No format change.** Lanes stay sorted and non-overlapping, and
   `ARRANGEMENT_VERSION` doesn't move.
10. **The pure rules have their own files:** `regionTransfer.ts` (the
    source part, the region, the target part, the drop tick, copy and the
    song's length in; both parts' regions and the placed index, or the
    refusal, out) and `laneSpans.ts` (which lane a pointer's height lands
    on, from a list of lane spans).
11. **The lane's hint** starts: "drag an edge to resize, a seam to move
    both regions, the body to move it, onto another part of its kind too
    (cmd/ctrl-drag copies)".

## Consequences

- `partLaneTransfer.ts` is the DOM side of the cross-lane drag (the
  target, the preview on both lanes, the dims and the border, the commit
  or the toast); `partLaneGestures.ts` hands a body press to it.
- A part lane carries its slot as `data-part-slot`, so a drag can find a
  lane by its height.
- Selecting several regions, and moving or pasting a selection across
  parts, are still not built
  (`2026-10-06-song-region-move-copy-paste`).
