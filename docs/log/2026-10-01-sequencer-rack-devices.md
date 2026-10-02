# Sequencers as rack devices

- **Date:** 2026-10-01
- **Status:** accepted (tacowars, 2026-10-01)
- **Links:** the mockups in `docs/research/2026-09-30-sequencer-rack/`
  (`grid.html`, `chord.html`, `arp.html`, `bass.html`, `euclid.html`) ·
  the insert rack (windsor#173) · Euclid lanes and ratchets
  (`2026-10-01-euclid-lanes-and-ratchets`, windsor#355, windsor#356) ·
  Chord Player follow (windsor#333) · harmony quality and accidental
  (windsor#332) · the issues: windsor#366 (Grid and Arp
  ratchets), windsor#367 (Basslead's strip), windsor#368 (the frame and
  the Grid), windsor#369 (Chord), windsor#370 (Arp), windsor#371
  (Basslead), windsor#393 (Euclid)

## Context

The insert rack draws every insert as a device of one height, its width
set by its controls, with the name on a side rail. The sequencer cards in
the Song pane are still stacks of rows: a region row with Split and
Delete, rows of knobs, rows of pickers, the step strip and a paragraph of
help. They grow taller with every control and lane, and they look nothing
like the rack under them.

tacowars wants the sequencers to become devices too, since they are where
a song is tweaked most. A first round of mockups changed too much: a
piano roll for the Grid, chord blocks as long as they play with the
harmony drawn above them, and a circle for Euclid. A second round, one
sequencer at a time, kept today's step strips and changed the frame
around them. This record is that second round.

## Decision

1. **Every sequencer is a device of one height, 244 px.** Inserts stay
   at 196 px. A device's width is set by its controls and its pattern,
   and it grows with the step count, so no step is ever cut off. The
   device never scrolls its steps sideways. When it is wider than the
   pane, the rack around it scrolls sideways, as the insert rack does.
   Neither scroller bounces at its limit.
2. **The side rail.** From the top: the part's accent dot, then the
   kind's name written vertically (a click folds the device to the rail),
   then the region as `n/m`, then Split and Delete region as icon
   buttons. The Song pane's region row goes. There is no hint paragraph.
   The cells keep their tooltips.
3. **Controls in columns,** as the insert rack lays them out: a column or
   two of pickers and buttons, then knob columns three knobs high, in the
   order each mockup shows. The Octave knob moves into the device on the
   Grid and the Chord, so the pane no longer adds one (`PANE_OCTAVE_KINDS`
   goes).
4. **Today's step strips stay.** Each step is a column: the Grid's note
   cell, degree picker, Oct, A and S; the Arp's `♪ — ·` cell, Oct, A and
   S; the Chord's Hit or Rest tile with Oct, Inv, Dur and Rep. The cell
   labels and the clicks are today's. Steps are 32 px wide, down from
   46, grouped by four. The Grid's note and degree cells are 18 px high.
5. **Lanes stack, and only the lanes scroll.** Lanes are 42 px high,
   under the step rows. Their names, × and readout are in a column at the
   left, with **+ Lane** in the corner above them. The step rows stay put
   while the lanes scroll vertically under them. Two lanes fit at 244 px.
6. **A ratchet row on the Grid, the Arp and Basslead,** as Euclid's: one
   14 px cell per step under S. A click cycles ×1 → ×2 → ×3 → ×4 → ×1,
   and ticks show the split. A rest or a tie has no ratchet: its cell is
   grey and does nothing, and a note that becomes a rest or a tie loses
   its ratchet, as a Grid note loses its Oct, accent and slide today.
   - A ratchet of `N` plays `N` hits of the step's note, spaced evenly in
     seconds across the step's swung span. A region end or a loop jump
     drops the hits past it, as a Euclid roll does (`rollSpan.ts`).
   - Every hit carries the step's pitch, accent and lane values. A slide
     applies to the first hit only, and each later hit retriggers.
   - On the Grid, the last hit is held as the step's note is today, until
     the next note or rest. On the Arp and Basslead, each hit is held for
     the gate times its slice of the step, except the last where today's
     note would run on (a tie or a slide next, or Basslead's gate of 1):
     it is held as that note is, and the tie or the next note ends it.
   - A skip or a density draw is made once per step, before the roll. A
     step that is skipped plays no hit.
7. **The Chord** keeps its strip and shows no progression; the chords are
   the Harmony lane's. Its step tile takes the height the device has
   left, so it is a large target to press and to drop on. The Hit and
   Rest tiles to drag from sit in the controls. windsor#333's **Follow**
   switch goes in the first column, under Base step and Voicing.
   windsor#332 adds nothing to the device: the Hit tile names whatever
   chord the region gives, `G# maj · ♭VI` included.
8. **The Arp** keeps the `♪ — ·` cell, because its pitch is the chord's.
   Reseed is an icon beside the seed field. The device is as wide as the
   cycle, which follows the chord, Style and Octaves.
9. **Basslead gets a step strip** for rhythm and variety in bass and lead
   parts. Its steps are notes, ties and rests, drawn with the Arp's
   `♪ — ·` cell, then Oct, A, S, the ratchet row and lanes. The pitch
   mode still picks each note's pitch. Basslead also gets Length, Rotate,
   Randomize, Acc vel and Acc mod. Density stays as the chance a note
   step sounds. Pitch mode becomes a stack of three. Root bias and Fixed
   degree are greyed when the mode ignores them. Basslead gets no pitch
   lane; the per-step Oct row is its octave modifier.
10. **The format change is additive.** A Grid or Arp note step gains
    `ratchet`, where absent means one hit; rests and ties carry none.
    Basslead gains `steps`, `length`, `accentVelocity`, `accentMod` and
    `lanes`. A Basslead without `steps` loads as one bar of plain notes,
    which plays exactly as today, and keeps today's gate-1 tie rule.
    `ARRANGEMENT_VERSION` does not change
    (`2026-09-28-format-versions-refuse-never-destroy`).
11. **Euclid** keeps the design windsor#356 gives it, its pages included,
    and is fitted to the 244 px device afterwards. tacowars approved that
    fit on 2026-10-02 (`euclid.html`, windsor#393):
    - The rail holds the accent dot, the name, the lane-view toggle, the
      region `n/m`, then Split and Delete. The part name leaves the rail,
      because the pane header shows it.
    - The **?**, the hint and the "Hover a cell to read it" line go. A
      lane's hover reading sits under its name, as on the Grid.
    - The Pattern page's controls go in four columns: Note, Steps and
      Rotate; Step and Capture; Vel, Acc vel and Acc mod; Hold.
    - The Ratchet and Trigger rows stay put while the lanes scroll. The
      cells stay 22 px. Lanes are 42 px; three fit and a fourth scrolls.
      **+ Lane** sits in the Lanes rule, and the "rows line up every…"
      note joins the section label.
    - The Density page keeps the device's width, and its plot takes the
      room left over.

## Not now

- A piano roll for the Grid's pitch.
- Chord steps drawn as long as they play, and the harmony drawn in the
  Chord device.
- A circle for Euclid's figure.
- A pitch lane on Basslead.
- Pages on a sequencer device. Every control stays on screen.
