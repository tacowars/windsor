# The expanded roll follows the picked Roll part, and records there

- **Date:** 2026-10-17
- **Status:** accepted (tacowars confirmed windsor#873 as written, with its
  three filled-in details, 2026-10-17)
- **Amends:** `2026-10-17-expanded-views-below-the-header` decision 6: the
  roll no longer stays on its own part when another Roll part is picked
- **Links:** the issue windsor#873 · the build windsor#866 · Rec on the
  Roll (`2026-10-09-roll-recording`)

## Context

With the piano roll expanded, a part chip changed only the pane under it:
the view stayed on its own part. Rec records the selected part, so with
another part picked it read "No region under the playhead", and moving
between Roll parts meant closing the view, picking, and expanding again.

## Decision

1. **Another Roll part's chip switches the expanded roll to that part.**
   The view stays open and edits, plays and records the picked part, and
   its title names it.
2. **The region it shows** is the picked part's region under the playhead.
   With none there, it shows what the part's own pane shows: its selected
   region, or its first. Rec stays disabled with today's "No region under
   the playhead" hint until the playhead reaches one of the part's regions.
   The Song view selects the region the roll shows, so Close returns to the
   pane at that region.
3. **A chip for a part that is not a Roll** (Euclid, Grid, a drum part)
   leaves the roll on its current part, and the pane under it changes, as
   the amended decision 6 had it. While the view is on screen, Rec records
   the roll's part and the keyboard plays it, so what is recorded is what
   is heard. On the Song tab that is a MIDI controller: the audition keys
   play only on the Parts tab, where the view is not on screen. Once the
   view closes, or another tab is shown, both go back to the selected part.
4. **Each Roll part keeps its own roll state** for the session: zoom and
   fold as before, and now where its expanded notes pane was scrolled, so a
   part picked back opens where it was.
5. **Picking the roll's own part back** after a part that is not a Roll
   keeps the region the view shows.
6. **Everything else from windsor#866 stays:** one view at a time, tab
   switching, Esc, the header and the Close button.

## Consequences

- One roll is open wide for the console (`rollExpand.ts`), not one per
  part. The Roll card the Song pane draws next opens wide and takes the view
  over, as after a Split. A pick of another Roll part is the same take-over,
  with the pane drawn at the region `rollWideFollow.ts` names.
- `AppContext.playedSlot()` is the slot the keyboard plays and Rec records
  into: the selected part's, or the expanded roll's while it is on screen.
  The controller's bend and mod wheel still move to a part on a pick or an
  expression change, so a bend held across the view's opening or closing
  stays on the part that had it until the wheel or bend moves.
- The CC knobs still follow the selected part, not the roll's.
