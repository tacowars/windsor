# The Song tab's fold arrows fill their cell, and its mixer shows values in a bubble

- **Date:** 2026-10-12
- **Status:** accepted; tacowars approved the mockup on 2026-10-12
- **Links:** issue windsor#768 · the approved mockup
  `docs/design/song-mixer-mockup.html` (arrows option C, values option A) ·
  the frozen column, `2026-10-03-song-tab-one-frozen-column` · the mixer on
  the Song tab, `2026-09-30-mixer-on-the-song-tab` · the locked knob's lit
  ring, `2026-10-01-song-automation-lanes` decision 6

## Context

The Song tab's fold arrows were font characters (▸ and ▾) in 17 × 18 px and
22 px boxes. A glyph never fills its box: it sits on a text baseline with
side bearings, so a 12 px arrow drew a few px of ink, and the panel face drew
both as the same dot. The fold column around the part fold's button was
50 × 40 px, but only its button took a press.

The expanded mixer column was 485 px, because every pot carried its value to
its right, five characters wide, in a 70 px column. That width came out of
the timeline.

## Decisions

1. **The arrow is an SVG triangle, not a font character.** One builder,
   `disclosureArrow.ts`, draws a filled triangle to the edges of a 16-unit
   box (the mockup's path, `disclosureArrowTables.ts`). It points right
   while closed and turns 90° to point down while its button's
   `aria-expanded` is true: a 120 ms CSS transition, none under
   `prefers-reduced-motion`. A fold repaints the lanes, so `turnDisclosure`
   starts the new button's arrow at the old angle and the turn still plays.
   The colours are as before: ink-faint (folds) or ink-dim (the header) at
   rest, ink on hover, and the carrier while a fold is open.
2. **The part fold fills its cell.** Its button is the whole 50 × 40 px fold
   column (`partFoldPx` and the row height are unchanged), with a 20 px
   triangle. A folded part's lane count sits beside the triangle, inside
   the button, as the bare count the mockup draws ("2"); the button's title
   reads "2 lanes". A press anywhere in the column folds. Hover and focus
   light the whole button (`--panel-hi`), and a press on it never selects
   the part.
3. **The group's folds** (`songGroupRow.ts`) get the same triangle. The
   lanes fold's "lanes" caption or lane count sits inside its button.
4. **The mixer header's arrow.** Collapsed, one button holds the 18 px
   triangle and the word "Mixer" and spans the header's lead, so the word
   is the target too. Expanded, the button is the triangle alone in its
   22 px box, before the column labels. Focus stays on the button across
   the toggle.
5. **No numbers beside the Song tab mixer's pots**, collapsed or expanded.
   This is the compact knob (`compact: true`), which only the Song tab's
   mixer uses; it now draws its dial alone. The Mixer tab's knobs, the rack
   and the cards are unchanged.
6. **The value bubble** (`knobBubble.ts` over `knobBubbleModel.ts`). A
   compact knob shows one bubble, centred above its dial, with the knob's
   current label and its value from the spec's own `fmt`. Low cut adds
   " Hz" through the spec's new `unit` field, so it reads "20 Hz" at its
   floor (the filter still runs there) and "500 Hz" at its top. The bubble
   appears after a 350 ms hover, at once on a press, and on keyboard focus
   (`:focus-visible`). It stays and updates through a drag, and hides
   150 ms after the pointer leaves, or 700 ms after a release that leaves
   the pointer off the knob (a lifted finger counts as off). A double-click
   reset shows it for 900 ms. The timings are `knobBubbleTables.ts`. There
   is one bubble on the page, hung from the body with fixed positioning, so
   the frozen column, the lanes' scroll box and the ruler never clip it; it
   is held inside the window's edges with its tip on the dial, and it takes
   no pointer events. It reads what the knob's own redraw tells it, so a
   drag, an arrow key, a lane moving the lock and a Mixer-tab edit that
   redraws the cell in place (`refreshMixerCells`) all reach it. It hides
   when its knob leaves the document or its tab is hidden.
7. **A locked knob** (a lane, a macro or a clip envelope) shows its tag in
   the bubble: AUTO, the macro's name, or ENV, in the lock's colour. The
   lit ring marks the lock at rest, and the compact knob's two-line
   `.locked` grid is gone.
8. **Widths.** In `songViewTables.ts`, `mixerKnobColumnPx` goes from 70 to
   36 (the 26 px dial, 3 px of padding a side, and the grid's 4 px gap) and
   `mixerWidthPx` from 114 to 84. The expanded column is 315 px, not 485,
   and the timeline gains 170 px, about 1.8 bars at the default 96 px a
   bar. The expanded header's labels are 9 px with 0.06em tracking, and
   "Low cut" wraps onto two lines inside the 22 px header. The labels stay
   "Level", "Pan", "Low cut", "→ A", "→ B" and "Out".
9. **Out of scope:** the Mixer tab, the detail pane's fold
   (`songPaneFold.ts`), the rack and card knobs, and the engine.

## Consequences

- The compact knob has no `.knob-val` or `.knob-auto`; a test or style that
  reads the Song tab's values reads `aria-valuetext` or the bubble.
- The bubble is the compact knob's only. A future knob that drops its
  number can take `compact` or call `attachKnobBubble` itself.
- No song or patch format changes.
