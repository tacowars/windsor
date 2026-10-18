# The page never zooms

- **Date:** 2026-10-18
- **Status:** accepted: tacowars's direction, turning knobs on a tablet
- **Links:** windsor#899 · `2026-10-17-the-console-selects-no-text` (the
  console is an instrument, not a page) · `2026-10-03-parts-tab-layout`
  decision 9 (zoom-safe UI) · `packages/app/index.html` (the viewport meta) ·
  `packages/app/src/console.css` (`html`, `body`, `.console`) ·
  `packages/app/src/pageZoomLock.ts`

## Context

On the tablet, in the browser and as a home-screen app, the page sometimes
zoomed while tacowars was turning a knob: a second finger landing beside
the first, or a stray double-tap, was read as a pinch or a double-tap zoom.
Focusing a text field zoomed it too, since the part name, the searches and
the patch metadata are set at 13px and the tablet's browser zooms any field
under 16px when it gets focus. The record on text selection had already
made the console an instrument rather than a page; its scale was still
the page's.

The controls that take a drag set `touch-action: none` for themselves, but
the gaps between them, the panes and the dialogs did not, and the viewport
allowed scaling.

## Decision

1. **Touch never zooms the page.** Pinch-zoom, double-tap zoom and the
   zoom when a text field gets focus are off, on every tab and in every
   dialog.
2. **The viewport meta** reads `width=device-width, initial-scale=1,
   maximum-scale=1, user-scalable=no, viewport-fit=cover`. Chromium honours
   it, and the tablet's browser reads `maximum-scale=1` to skip the focus
   zoom.
3. **The root takes pans only.** `html` sets `touch-action: pan-x pan-y`,
   which leaves out pinch-zoom and double-tap zoom and keeps one-finger
   scrolling of the panes. The controls' own `touch-action: none` rules
   stay, since the effective value is the intersection along the ancestor
   chain.
4. **The tablet's browser gets its gesture events cancelled.** It ignores
   `user-scalable=no` and does not fully honour `touch-action` on the root,
   so `pageZoomLock.ts` calls `preventDefault()` on `document` for
   `gesturestart`, `gesturechange` and `gestureend`, and on a `touchmove`
   that carries more than one touch, through non-passive listeners.
   `main.ts` installs it once at boot. It touches no pointer event and no
   single-finger move.
5. **Desktop browser zoom stays.** Cmd/Ctrl + and − and the browser's zoom
   menu still work, since the UI is zoom-safe by rule. The gesture handlers
   also block trackpad pinch in the desktop browser that sends gesture
   events; that is accepted.
6. **The document never scrolls; `.console` does.** `html` and `body` take
   the window's height with `overflow: hidden`, and `.console` (`#console`)
   is the scroll container, at `100dvh` with `overflow-y: auto`. The
   tablet's browser lets a pinch through while the document's own scroll
   is moving, since its touch events are not cancelable then, so the
   handlers in decision 4 cannot stop it. A document that cannot scroll
   gives the pinch nothing to ride on. The sticky header stays at the top
   of the scroller.

## Consequences

- The console stays at one scale under touch, as a piece of hardware does.
  A user who wants it larger on the tablet has no pinch; the layout wraps
  by container width instead.
- Knob drags, the keyboard (chords with several fingers included), the
  lanes and long-press are unchanged: they run on pointer events, which the
  lock does not touch. A two-finger move cancels only the browser's default
  for that move, a pinch or a two-finger pan.
- Code that reads or sets the page's scroll uses `#console`'s `scrollTop`,
  never `window.scrollY`, which now always reads 0, or `window.scrollTo`. An
  expanded view saves and restores the console's scroll. A popover hung
  from `body` is placed in the window (`position: fixed`) from
  `getBoundingClientRect`, never with a document scroll offset; one that
  should move with the page re-places itself on the console's `scroll`
  (the MIDI CC panel), and one that closes on scroll keeps its capturing
  `window` listener, which still hears the console.
- A new control or dialog needs no zoom rule. A new text field needs no
  16px font to avoid the focus zoom.
- There is no unit test: the installer is DOM wiring and the tests run in
  Node with no DOM. The check is on the tablet itself.
