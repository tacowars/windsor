# Tab switches between Parts, Mixer and Song

- **Date:** 2026-10-03
- **Status:** accepted (the decisions of windsor#480)
- **Links:** windsor#480 · the modal focus of #563 (`focusTrap.ts`), whose
  Tab wrap this retires · the pure-rule pattern of windsor#111
  (`transportKeys.ts`)

## Context

Working a sound means moving between three views: the patch and its
sequence on Parts, the strip on Mixer, the arrangement and the master meter
on Song. Each move took the mouse. Tab did the browser's job instead: it
walked focus through every knob, fader and button on the page, and in a
modal it wrapped around the dialog's controls (#563). Nobody drives a
console of a few hundred controls by stepping focus through it one at a
time, so that job was worth little here.

Ableton Live gives Tab one job: it switches between the Arrangement and
Session views. Windsor's views are tabs, so Tab can do the same.

## Decision

1. **The cycle** is Parts → Mixer → Song → Parts, and Shift+Tab goes the
   other way. The Settings tab is never in it: from Settings, Tab shows
   Parts and Shift+Tab shows Song. The order is `TAB_CYCLE`
   (`tabKeysConstants.ts`).
2. **One listener**, attached once on `window` by `mountTabShell`. It calls
   `preventDefault()` on every Tab and Shift+Tab it handles, so the browser
   never moves focus with Tab anywhere in the console. A switch is a
   tab-bar click: `ctx.activate(id)`, then the pressed state syncs.
3. **The rule is pure and tested** (`tabKeys.ts`'s `tabKeyAction`): from
   the key facts and the shown tab to a switch, a swallow, or nothing.
4. **Everywhere but a modal.** Tab switches tabs even while focus is in a
   text input, a textarea or a select. Focus left in the panel that was
   hidden is blurred, and nothing new takes it; an edit in progress ends
   the way that field already ends on blur.
5. **In an open modal, Tab does nothing.** It is swallowed: no switch, no
   focus move, and the panel behind stays as it is. The wrap in
   `showTrapped` and `tabWrapTarget` are gone; `FocusReturn` still returns
   focus to the opener on close.
6. **Modified Tab is left alone.** With Ctrl, Meta or Alt held, Tab belongs
   to the browser and the OS (Ctrl+Tab switches browser tabs). A held
   Tab's auto-repeat is swallowed, so a hold switches once.

## Consequences

- **Keyboard focus navigation is gone.** No key moves focus from control
  to control, in the console or in a modal. A control still takes the
  keyboard once it is clicked: the arrow keys work on a focused knob or
  fader as before, and a modal's fields are reached with the mouse.
- Space, the QWERTY audition keys, z/x and undo/redo are separate
  listeners and do not change.
- A new tab joins the cycle only by being added to `TAB_CYCLE`.
