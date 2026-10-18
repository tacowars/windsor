# The Roll zooms with zoom bars and its ruler, opens on the loop, and duplicates its loop

- **Date:** 2026-10-18
- **Status:** accepted (tacowars chose option B of
  `docs/design/roll-zoom-mockup.html` and approved the mockup, with its tablet
  pass, on 2026-10-18)
- **Amends:** `2026-10-04-roll-sequencer`: the ↔ and ↕ zoom steppers and
  Fit go; the roll opens on its loop, not fitted to its region
- **Links:** the spec `docs/design/roll-zoom-mockup.html` (windsor#901) ·
  the builds: the zoom bars windsor#902, the gestures windsor#903,
  Duplicate windsor#904 · the Song tab's ruler zoom (`songZoomModel.ts`,
  windsor#8)

## Context

tacowars stretched a 2-bar loop's region to 50 bars and could not get back
to the notes. The roll opened fitted to the whole region, so the loop was a
row of slivers. The zoom read in px per bar and px per row, which say
nothing about what is on screen. Fit sat between − and +, so a near miss
jumped back out to the region. A drag on the ruler did nothing, though the
Song tab's ruler zooms. The mockup drew three answers: musical steppers in
the controls (A), zoom bars (B) and gestures only (C).

## Decision

1. **Option B, the zoom bars.** The notes pane's two scrollbars become zoom
   bars: a drag on either end of the thumb moves that edge, which zooms,
   a drag on its middle scrolls, and a press on the track jumps there.
   The ↔ bar maps the whole region: the loop span is marked and every
   note and repeat is a tick. The ↕ bar maps the pitches.
2. **The controls' Zoom item becomes Show: Loop | Region.** Each button
   fits that span to the width, and is lit while the view sits on it. The
   ↔ and ↕ steppers, Fit and their px readouts go.
3. **The roll opens on its loop.** The loop fills the width, or as much
   of it as the closest zoom (decision 8) allows: a half-bar loop on a
   pane wider than about 490 px stops at 240 px per beat, with its next
   repeat beside it. Its repeats carry on under the hatch. Region fits the
   whole region.
4. **The ruler zooms as the Song tab's does:** drag up to zoom in and down
   to zoom out, around the tick that was pressed, and drag sideways to
   scroll, with the Song tab's 60 px per doubling and 3 px threshold. A
   double-click switches between the loop and the region. The loop
   brace's handle keeps its own drag.
5. **The keys zoom the rows:** drag sideways for taller or shorter rows,
   up and down to scroll, around the row that was pressed. A tap on a key
   does what it does today.
6. **Pinch zooms.** On a trackpad, or Ctrl or ⌘ with the wheel, it zooms
   time around the pointer. On touch, spreading sideways zooms time and
   spreading up and down zooms rows, around the fingers. One finger on
   empty space still scrolls and a tap still adds a note
   (`2026-10-04-roll-sequencer` decision 8).
7. **No px in the UI.** While a gesture or a bar zooms, a readout at the
   top of the notes names the span in bars or beats and the bars shown
   ("2 bars · bars 1–2"), or the rows in octaves ("2 oct"). The summary
   leads with the bars shown ("bars 1–2 of 50").
8. **The zoom's range:** out to the whole region, which is the floor, and
   in to 240 px per beat, up from 120, so a 1/16 is 60 px wide. Rows run
   continuously from 4 to 24 px.
9. **Touch sizes** whenever any pointer is coarse: the bars are 22 px thick
   (12 px otherwise), each end is a 26 × 22 px grip, and a thumb is never
   shorter than 84 px (30 px otherwise).
10. **The Expanded view** gets all of it, and keeps its own zoom, separate
    from the device's, as today. It opens on the loop at 15 px rows.
11. **Duplicate.** A **Dup** button beside the Loop stepper doubles the
    loop and copies everything in it into the new half: the notes with
    their velocity, accents and ratchets, and the envelopes' points. The
    doubled loop plays exactly as the old loop played twice: a note that
    runs past the old loop's end, which the loop cuts there today, is
    shortened to end there in both halves, and each envelope gets the
    points that keep its value over the new half the same as over the
    first, including the hold past its last point. Notes and
    points parked at or past the old loop's end move later by one loop
    length, so they stay parked. Dup is disabled when the doubled loop
    would pass the region's length or a cap. It is one undo step.

## Consequences

- The zoom stays view state: nothing reaches the song document, so the
  format does not change. Duplicate writes the roll's notes, loop and
  envelopes through the existing edit path, as any edit does.
- `2026-10-04-roll-sequencer`'s Fit and zoom steppers are superseded;
  the rest of that record stands.
- The ruler's drag and the keys' drag join the roll's gestures. On touch
  they share the page with `2026-10-18-the-page-never-zooms` (windsor#899),
  which blocks the browser's own pinch, so the notes pane's pinch is the
  roll's own.
