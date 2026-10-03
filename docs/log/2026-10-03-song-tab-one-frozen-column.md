# The Song tab's lanes: one frozen column, and a selection around the whole part

- **Date:** 2026-10-03
- **Status:** accepted (tacowars, 2026-10-03)
- **Links:** the mockup `docs/research/2026-10-03-song-lanes-layout/mockup.html`
  (layout Proposed with the number tab is the approved one; Today redraws
  the tab as it was) · the build windsor#534 · the part strip windsor#520
  (record `2026-10-03-parts-tab-layout`) · the chip lights measurement
  windsor#533

## Context

The part strip now shows every part's name and `n · kind` above every tab
(record `2026-10-03-parts-tab-layout`, decision 2). The Song tab still
repeats both in its first frozen column, names (120 px), next to a second
frozen column, the mixer (132 px). Together with their gaps they take
268 px from the timeline.

The names column also holds each automation lane's label, HARMONY, the
ruler's corner labels, "+ Add lane", the ▸ fold and the "n lanes" badge.
Removing only the part's name frees no width unless those move too.

tacowars also asked for the selected part to be marked as a whole block,
not only on its name cell, and for the Song mixer's lights on the strip's
chips on every tab.

## Decision

1. **The names and mixer columns become one frozen column.**
2. **A part's row** reads: a 20 px number tab in the part's colour with
   its 1-based number, then ▸ with the "n lanes" badge stacked under it,
   then today's Level knob with AUTO, M, S and the two lights.
   - The part's name and kind line go; the strip shows them.
   - The number tab runs down the part's open lanes, so they read as one
     block.
   - A click on it selects the part. It doesn't fold the part; ▸ folds.
3. **The number tab, not colour alone.** There are only two part colours
   today (teal for pitched parts, amber for Euclid), so in a long song
   colour alone can't tell lanes apart.
4. **An automation lane's label sits beside its value**, with ● × stacked
   under the value in the lane's 56 px row. "+ Add lane" and "Voice n/8"
   share the add row. HARMONY and the ruler's corner labels move into the
   same column.
5. **The selection wraps the whole part.** One `--carrier` outline goes
   around the selected part's row, its open lanes and its add row in the
   frozen column. Folded, it wraps the row alone. It follows the shared
   part selection both ways, with the strip.
6. **What stays:** the knob cell, M, S and the lights; ▸ Mixer expanding
   every strip; the row heights (40, 56 and 30 px); the timeline, regions
   and harmony lane.
7. **The chip lights are a separate decision.** The mockup's Meters switch
   draws the mixer's green activity light and red clip latch on every
   chip. Lighting them on every tab means running every part's peak meter
   on every tab, where today only the Song tab's visible rows poll theirs
   (#666). windsor#533 measures what that costs; tacowars chooses between
   meters and note-driven dots (windsor#528) on its numbers.

## Consequences

- The timeline gains 46 px. That's less than the 268 px the two columns
  take, because the part row still needs about 190 px: the lane badge is
  50 px and the knob with AUTO is 66 px. A larger gain would mean smaller
  cells, which this change doesn't make.
- The Song tab no longer names a part anywhere in its lanes. Reading which
  part a lane belongs to relies on the number tab, its colour, and the
  strip's highlight for the selected part.
- With Meters on, the chips' two lights take width, and at 1366 three more
  chip names end in "…".
