# The header on a phone: three rows below 720 px, the wide header untouched

- **Date:** 2026-10-04
- **Status:** accepted; built by windsor#584.
- **Mockup:** `docs/design/phone-header-mockup.html`, approved by tacowars on
  2026-10-04. Its "Proposed" screen sets the phone layout. Its "Today"
  screen reproduces main's header at 390 px.
- **Builds on:** the header's one wrapping row (windsor#11, windsor#520),
  the CPU meter (windsor#13), the output light (windsor#94), undo and redo
  (windsor#131)

## Context

The sticky header is one wrapping row: the tabs, the CPU meter, the output
light, undo and redo, then the transport strip, which takes what the row
leaves. On a 390 px phone the strip got 146 px, and its four groups, which
never wrap inside themselves, ran past the screen. The page measured 465 px
wide on Mixer, Song and Settings in headless Chrome, so the phone zoomed the
whole console out to fit, and the header was 237 px tall.

## Decision

1. **The breakpoint is 720 px.** Every phone rule sits in one
   `@media (max-width: 719.98px)` block at the end of `console.css`. Below
   it the header is three rows plus the part strip:
   - **Row 1:** the tabs stretch across the row, the gear tab keeping a
     fixed 38 px, with undo and redo at the end.
   - **Row 2:** the CPU meter and the output light take what the position,
     ▶ ■ ‖ and loop leave. The meter shrinks first: its bar gives way
     before its label (a 56 px floor, with 8 px side padding as in the
     mockup), so at 360 px the row still holds, with the bar a sliver.
   - **Row 3:** the song's settings (Tap, BPM and Bars; swing, grid and
     meter; key and scale) in one row that scrolls sideways inside the
     header, edge to edge, its scrollbar hidden, with a hairline between
     the groups and a fade at each edge.
   - **Then the part strip**, as before.
   The transport strip and its row step aside (`display: contents`), so
   the groups order straight into the header's row.
2. **720 px and wider is pixel for pixel what it was.** The only DOM
   change is a wrapper around the three settings groups
   (`.transport-settings` in `transportStrip.ts`), and it is
   `display: contents` outside the phone block, so wider layouts lay out
   exactly as before. The check is a screenshot compare against main at
   1366 × 800, 1024 × 768, 768 × 1024 and 720 × 900, with the CPU meter's
   live fill and label hidden in both.
   - The fades are the panel's colour drawn over each edge by sticky
     pseudo-elements, not the mockup's `mask-image`. With a `mask-image`
     in the phone block, a block that does not apply at 1366 px, one
     antialiased pixel of the part strip's + button still came out two
     levels brighter at 1366 × 800, on every capture. Drawn over, the top
     260 px match main exactly. The look is the mockup's: the left fade
     lies over the row's padding until the row moves, and the right one
     covers the padding and the row's last 12 px.
3. **Every control stays, with its behaviour.** The controls keep their
   sizes and their order within each group; only the rows change. The
   number boxes still type and drag. In the scrolling row a number box
   takes `touch-action: pan-x`, so a vertical drag on BPM or Bars still
   moves the number while a sideways swipe, even one that starts on a
   box, scrolls the row. A swipe that starts as a drag is cancelled by the
   browser (`pointercancel`), and the box lets go of it.
4. **The header only.** The Parts operator rows, Mixer's insert boxes and
   Song's lanes also run past 390 px. They get tickets of their own.

## Consequences

- At 390 × 844 on the Settings tab the page is 390 px wide and the header
  is 164.9 px tall. At 360 px it is the same height and still fits.
- The Parts operator rows, Mixer's insert boxes and Song's lanes still run
  past 390 px until their tickets land, so a phone can still zoom out on
  those tabs.
- At 720 to 767 px the header fits as before. The Parts tab's operator
  rows already overflow at 720 px (739 px wide on main), which is the
  Parts ticket's, not this one's.
