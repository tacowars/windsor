# The expanded views sit below the console header

- **Date:** 2026-10-17
- **Status:** accepted (tacowars approved the desktop mockup on windsor#855
  and the tablet mockup on windsor#860, 2026-10-17, and decided their open
  questions there)
- **Amends:** `2026-10-17-spectre-drawn-cells` decision 10: the workbench
  no longer fills the window, and its header has no undo and redo
- **Links:** the mockup `docs/design/expanded-views-below-header-mockup.html`
  (desktop windsor#855, tablet windsor#860) · the build windsor#866 · the
  Roll's Expand (windsor#602 decision 9) · zoom-safe canvases
  (`2026-10-03-parts-tab-layout` decision 9) · tabs that hide, not detach
  (windsor#193 decision 4)

## Context

The console has two expanded views: the piano roll opened wide (the Roll
device's Expand) and Spectre's workbench. Both covered the whole window,
header and all. To play the song, undo a stroke or reach another tab, the
view had to close first. On the tablet, with no keyboard for Esc, the
header's transport and undo were out of reach while either was open.

## Decision

1. **The approved mockup is the spec.** Its frames at 1440 × 900,
   1024 × 1366 and 1366 × 1024 are what the build is compared with.
2. **Both views sit below the header.** Each fills the window below the
   console header: the transport, undo and redo, the tabs and the part
   chips stay live above it. The views size from the space the header
   leaves (`.roll-overlay` in the tab root; the console stops at the
   window's foot while one is on screen), never from the viewport, and
   their padding is 24 px at the sides and foot and 16 px under the
   header. Their canvases size from their CSS box × `devicePixelRatio`, so
   a resize or a zoom refits them sharp.
3. **The header is unchanged.** Its row of groups starts at the left and
   wraps as before; the views move, the header does not, and it stays
   interactive while a view is expanded.
4. **The workbench has no Undo or Redo of its own.** The header's are
   reachable above it, and Cmd/Ctrl-Z and Shift-Cmd/Ctrl-Z keep working.
   An undo of a stroke shows at once in the open workbench.
5. **Only Close and Esc close an expanded view.**
   - Switching tabs does not close it. A view belongs to the tab its card
     lives on (Song for a part's roll or Spectre, Mixer for a Spectre on a
     send bus). Another tab shows its own page with nothing of the view on
     it, and going back shows the view still expanded.
   - Esc closes the view only while it is on screen. On another tab, Esc
     does nothing to it, and the workbench's other keys stay off too.
   - A view also goes when what it edits goes: the Roll's region, or the
     Spectre insert.
6. **Another part chip while the roll is expanded** (to try): the view
   stays open on its own part, and the pane under it changes to the picked
   part. Closing it then shows the picked part's pane. The roll used to
   close when its part left the pane; that is gone.
7. **One expanded view at a time.** Opening a view while another is
   expanded closes the first, whichever tab it is on.
8. **The roll's Close button** stays at today's size on the tablet
   (18 × 18 px on the rail); the workbench's Close stays 44 × 23 px. A
   larger Close is a follow-up if it proves hard to hit.
9. **No tab lamp** marks an expanded view on another tab.

## Consequences

- `expandedViews.ts` holds decisions 5 and 7 as rules with no DOM, with
  its tests; `expandedViewFrame.ts` mounts a view in the tab root, follows
  its tab through `onTabShown`, and gives the page its scroll back on
  close. `tabShell.ts` names each panel's tab (`data-tab`) so a view can
  find the tab its card lives on.
- While a workbench is hidden on another tab it reads no spectrum and
  draws nothing; Listen, when on, stays on until it closes.
- The roll's device stays alive in the view while the pane under it shows
  another part. A repaint of its own part's pane builds a new device,
  which takes the view over, as a Split already did.
