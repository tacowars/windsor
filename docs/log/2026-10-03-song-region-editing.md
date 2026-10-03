# Song region editing: chords that halve, seams that roll, edges that show

- **Date:** 2026-10-03
- **Status:** accepted (tacowars, 2026-10-03)
- **Links:** the mockup `docs/research/2026-10-03-song-region-editing/mockup.html`
  (layout Proposed is the approved one; Today redraws the behaviour as it
  was) · the harmony build windsor#550 · the part lanes build windsor#551 ·
  the timeline's earlier records `2026-09-26-harmony-v2-document-v3-timeline-and-regions`,
  `2026-09-29-each-region-plays-its-own-pattern`, `2026-10-02-one-meter-per-song`

## Context

tacowars found sizing and moving regions on the Song tab fiddly. The
harmony track and the part lanes also disagree with each other.

- **Harmony "+"** always takes one bar from the end of the last chord. A
  new song's first split is therefore 15 | 1 bars, where a 50/50 split is
  the common case.
- **Harmony drag.** Only a chord's right edge drags, unsnapped. Every later
  chord moves along with it, and the last chord takes up the difference.
  While dragging, the chord overlaps its neighbour until release.
- **Part lanes.** Both edges resize, but through an 8 px band (a quarter
  of a short block) under the body's grab cursor, with no handle. Where
  two regions touch, a drag stops at the neighbour, so that edge can only
  shrink.
- **Missing pieces.** Neither lane shows a readout while dragging, and a
  drag across empty lane does nothing.

## Decision

1. **"+" halves a chord.** It cuts the selected chord at its middle bar,
   or at its middle beat when the chord is under two bars. With no chord
   selected it halves the rightmost chord, so on a new song the first "+"
   splits the song 50/50. The new right half copies the chord and is
   selected.
2. **A chord boundary is a seam, and dragging it is a roll edit.** The two
   chords that meet there change length, and nothing else moves. The
   song's first and last tick fix the track's outer edges. Song length
   stays its own setting.
3. **Chord boundaries snap** to the song's bar, or to a beat with Shift.
   A chord is at least a beat long. Alt-click splits a chord, as on part
   lanes.
4. **Edges show themselves.**
   - **Cursor:** resize over an edge, `col-resize` over a seam.
   - **Handle:** an amber handle lights on the edge or seam under the
     pointer.
   - **Grab zone:** `min(10 px, a third of the block)`.
   - **Touch:** a selected block keeps its handles faintly lit.
5. **Where two part regions touch, the seam drags both.** This is the
   default, with no modifier.
6. **A readout while dragging** shows the start and end as bar.beat and
   the length, or the two lengths at a seam.
7. **Dragging across empty lane draws a region** of that length. A click
   still makes one bar.

## Consequences

- The harmony lane's ripple edit and its overlapping preview go away.
- The two lane kinds share one set of hit testing, cursors, handles and
  readout. windsor#550 builds them with the harmony track, and windsor#551
  reuses them for the part lanes.
- No format change: chords stay contiguous over the song, and regions
  never overlap.
