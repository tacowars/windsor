# The console renders the active tab; the rest render when shown

- Date: 2026-09-18
- Area: audio
- Links: issue #620 · epic #622 · record `2026-09-18-patch-editor-app-context-is-a-class-main-composes`

## Decision

`AppContext.render()` marks every registered tab dirty and renders only the
active one; `activate(id)` shows a tab and renders it if a change landed while
it was hidden, and does nothing for a tab that is already up to date. A
structural change (`restructure`) and an import (`importDoc`) take one path,
`rebuild`, which renders once for the draft and once when the live rebuild
has landed. The tab shell (`tabShell.ts`) registers the panels and calls
`activate` on a click; nothing else decides what renders when.

## Why

Every `render()` — nine call sites after a `change`, plus restructure, import,
capture and release — rebuilt all five tabs including the hidden ones,
re-creating the patch UI, the keyboard, the MIDI panel and a new scope loop
each time. Nothing leaked (the scope's `isConnected` check ends the old loop,
the window listeners are once-guarded), but it was the cost floor of every
knob tick and every name edit. Rendering the active tab and deferring the
rest costs the same on the tab the user is looking at and nothing on the
four they are not, and the dirty flag means a hidden tab still shows the
current document the moment it is shown.

## Punted / alternatives

Per-tab fine-grained invalidation (a name edit dirtying only the tabs that
show names) was not attempted: the document is small, a tab render is cheap,
and one flag per tab is the whole state to reason about.
