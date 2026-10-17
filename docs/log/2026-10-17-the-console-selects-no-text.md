# The console selects no text

- **Date:** 2026-10-17
- **Status:** accepted: tacowars's direction, playing the keyboard on a tablet
- **Links:** windsor#814 (the Song tab's rule, which this widens) · `packages/app/src/console.css` (`body`)

## Context

Playing the audition keyboard on a tablet, a touch that lingered or slid
along the keys was read by the browser as a text selection: the page
offered Copy and Search over a label instead of sounding the note.
windsor#814 had already made the Song tab unselectable, with the reason
that the tab is an instrument, not a page. The other tabs, the header and
the dialogs kept selection on, and the keys carried no touch rule at all.

Fourteen components had each turned selection off for themselves. Twelve
of them set only the unprefixed `user-select`, which WebKit browsers do
not read, so on the tablet the knobs, chips, ruler, lanes and number boxes
were all selectable in spite of their rules. The long-press callout was
suppressed on two components only.

## Decision

1. **The whole page is an instrument.** `body` turns text selection and
   the long-press callout off, in the `-webkit-` form and the standard
   form, so every tab, the header and every dialog inherit it. A
   component rules on selection only to turn it back on. `dialog` repeats
   the rule, because Chromium's own stylesheet makes a dialog in the top
   layer selectable again and only an author rule outranks that.
2. **A field selects.** `input`, `textarea` and `[contenteditable]`
   select their text, so typing, the caret and copy work in the part name,
   the searches, the patch metadata and the JSON editor. The song library's tag
   chips, in its section and its dialog, keep selection too, as before.
3. **A number box is a drag handle until it is clicked.** The transport's
   boxes and the number-drag boxes are text inputs that move on a vertical
   drag, so they select only while focused, as the transport box already
   did.
4. **The keys take the touch.** `.key` sets `touch-action: none`: the
   keyboard captures the pointer, and the browser gets no gesture to turn
   into a scroll or a selection.

## Consequences

- The per-component `user-select` rules are gone; `console.css` rules on
  selection in three places: `body` (with `dialog` and the fields beside
  it), the number boxes, and the song library's chips.
- A new control needs no selection rule. A new text field needs none
  either, as long as it is an `input`, a `textarea` or `[contenteditable]`.
  A div that should be copyable, as the song library's chips are, turns
  selection on for itself with both forms of the property.
- Selecting a run of the page's text to copy it, a knob readout or a
  report line, is no longer possible outside a field. That is the
  intended trade.
