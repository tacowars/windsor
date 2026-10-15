# A group's lane count as a circle, and "N parts" under its name

- **Date:** 2026-10-15
- **Status:** accepted. tacowars approved the mockup on 2026-10-15
- **Links:** windsor#808 · `docs/design/song-group-header-mockup.html`
  (its first section's "A + “4 parts”" column) · the group header
  `2026-10-05-group-automation-folder-tracks`

## Context

In the collapsed mixer the group header's row is 138 px. The lanes fold
took 62 px for its `lanes` caption and 83 px for a `2 lanes` pill, so a
group's name got 17 px with lanes and 38 px without, and showed as `D…`.
`group · 4 parts` needs 86 px and was cut on every group.

## Decisions

1. **The lanes fold draws its count as a part's fold does** (option A).
   Folded with one or more lanes, it is the arrow and the circle holding
   the count alone (`2`). With no lanes, or while its lanes are open, it is
   the bare arrow. The `lanes` caption goes.
2. **The fold's tooltip, as a part's.** While the circle shows, the
   button's title is the count's label (`2 lanes`); otherwise it is the
   fold's label. The `aria-label` is unchanged.
3. **The second line is the count alone:** `4 parts`, `1 part`,
   `no parts`. The row's tooltip keeps the long form,
   `Drums: a group · 4 parts`.

The name now gets 50 px with lanes and 70 px without, and the count fits
on every group.

## Options not taken

- **B, the circle always shown,** with a dim `0` on an empty group and kept
  while open. It gives every name 50 px but draws a control state the part
  rows never show.
- **C, the member fold moved onto the folder tab,** so the lanes folds line
  up with the parts'. It gives the most room (84 px) but moves a control.

A matches the part rows exactly and moves no control.
