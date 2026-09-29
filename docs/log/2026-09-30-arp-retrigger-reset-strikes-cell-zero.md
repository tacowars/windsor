# A tie or slide on the arp's cell 0 strikes at a retrigger reset

- **Date:** 2026-09-30
- **Status:** accepted (tacowars, 2026-09-30, on PR windsor#133)
- **Links:** epic windsor#126 (the arp's step grid, decisions 1, 3 and 4) ·
  windsor#129 (playback) · PR windsor#133

## Context

The arp's step grid shapes the `k`-th note of the style's cycle (epic
decision 1). A tie holds the previous note through its step, and a slide
glides into its note from the previous one. Both need the previous note to
still be held, so a note holds past its gate when the next cell is a tie or
a slide (epic decision 3).

With `retrigger` on, a chord change resets the walk to cell 0. The arp
learns the new chord only at the onset where it arrives: the region gate
hands it the current tick's chord, not the next one. So at the gate point of
the step before a mid-cycle chord change, the arp reads the old cycle's next
cell, not cell 0, and a tie or slide on cell 0 can find nothing held. Letting
the arp see the coming chord would mean handing it the harmony timeline, a
new coupling in the engine, and tying across a chord change would sustain a
note of the old chord into the new one.

## Decision

At a retrigger reset (a chord change with `retrigger` on), a tie or a slide
on cell 0 plays as a plain note: the walked pitch with the cell's octave
shift, its accent and its lanes, with no tie and no slide flag. A note still
held into the change is released before the new one strikes. Every chord
change therefore starts on a sounding note.

This applies only at a retrigger reset. At an ordinary wrap of the cycle, a
tie or slide on cell 0 plays as written. Skip chance is drawn before the
conversion, so its draws are unchanged.

## Alternatives considered

- **As first built:** a tie on cell 0 at a reset plays nothing, and a slide
  plays a plain note. Rejected: a tie on cell 0 would leave a silent step at
  every chord change.
- **True look-ahead:** the arp reads the chord at its next onset and holds
  or slides into the new chord's first note. Rejected: it needs the harmony
  timeline in the arp, and holding into a new chord rarely sounds intended.

## Consequences

`strikeCell` in `packages/engine/src/sequencing/arpCellPlay.ts` does the
conversion, and `track` in `arpeggiator.ts` reports the reset. The rule is
pinned in `arpeggiatorGrid.test.ts` at a retrigger boundary that is not
aligned with the cycle.
