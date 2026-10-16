# A context menu on the Song tab's lanes

- **Date:** 2026-10-16
- **Status:** accepted. tacowars approved both mockups on 2026-10-16
- **Links:** windsor#823 · `docs/design/song-region-menu-mockup.html` (desktop) ·
  `docs/design/song-region-menu-ipad-mockup.html` (iPad) · region editing
  `2026-10-03-song-region-editing` · move, copy and paste
  `2026-10-06-song-region-move-copy-paste` · `2026-10-11-bounce-to-roll` ·
  the loop `2026-09-28-song-loop-in-the-transport`

## Context

Everything you can do to a region on the Song tab is a key or a drag
(⌘X/C/V/D, Delete, Alt-click to split, a drag to move or copy). The
pattern actions (Randomize, Reverse, Reseed, Capture, Quantize) live on the
detail pane's card. Nothing gathers them where the pointer is, and on a
touch screen the keys aren't there at all. tacowars works like this in
other DAWs: a right-click on a clip opens its commands.

## Decisions

1. **A right-click on a lane opens a menu, and so does a long press by
   touch or pen.** A right-click on a region, or a long press on it,
   selects it as a click does. It then opens the region menu at the
   pointer. On a gap, the same gestures select the part and open the
   empty-lane menu. The menu's head names the part, the region's bars
   and the bar that was pressed (`acid · bars 5–8 · at bar 6`).
2. **The region menu**, in four groups:
   - Cut, Copy, Paste at bar N, Duplicate, Delete, Split here. These
     are today's commands. Paste lands at the pressed bar, rounded down,
     while ⌘V keeps landing at the playhead, so the item names its bar
     and carries no ⌘V hint. It is disabled, with the reason as its
     tag, when nothing is copied (`nothing copied`) or the clip is
     another kind (`clip is Euclid`). Split here cuts at the nearest bar
     line, as Alt-click does.
   - Zoom to region (new): fits the view to the region's bars. Loop
     region (new): sets the song loop to the region and turns it on.
   - The pattern actions the part's card offers:
     - Grid: Randomize, Reverse.
     - Arp, Basslead and Figure: Randomize, Reverse, Reseed.
     - Euclid: Capture or Release.
     - Roll: Quantize to the card's Snap.
     - Chord: none.

     Fit region to pattern (new) sets the region's length to one pass
     of its pattern: the Roll's loop, length × step on Grid, Euclid and
     Basslead, and the Figure's schedule. Arp and a Figure canon have no
     cycle and don't offer it. It is disabled (`already fits`) when the
     region is one pass long.
   - Bounce part to Roll… follows `bounceButtonState` and is absent on
     a Roll or a part with no sequencer. Part color… opens the part
     color picker.
3. **The empty-lane menu:** Paste at bar N, Add region here, Loop this
   bar.
4. **A part with no sequencer** offers Set sequencer ▸ in place of the
   pattern actions, listing every kind. It runs the Parts tab's Seq
   picker's command (`setSequencerKindLive`), with the same outcome,
   Roll's case included. A part that has a sequencer doesn't offer it.
5. **One menu, sized by what opened it.** A press with `pointerType`
   touch or pen gets the following; a mouse gets 32 px rows and all
   tags. A trackpad's right-click on an iPad is a mouse:
   - 44 px rows with 15 px labels;
   - no keyboard tags (⌘X, ⌥-click); a reason or amount tag stays;
   - a drill-in submenu with a back row, where the mouse gets a submenu
     beside its row.
6. **Touch placement:** the menu opens below-left of the finger. Its
   right edge sits 32 px left of the touch point and its top just under
   the pressed lane, so the hand doesn't cover it and the preview stays
   in view. It flips right when the left has no room, then clamps
   8 px inside the screen. There is no handedness setting.
7. **Previews:** the mouse previews an item's effect on hover (the
   region it would make, the loop it would set). By touch, the finger
   slides onto a row to preview it, and lifting runs it.
8. **The long press** is 450 ms within 8 px (`LONG_PRESS`, shared with
   the part color picker). It is pointer-timed, because iOS Safari fires
   no `contextmenu`. A ring around the finger fills over the hold,
   drawn only after 150 ms so a tap never flashes it. The release that
   opens the menu does nothing else. Lanes set `-webkit-touch-callout:
   none`.
9. **Touch drags on the lanes start at 8 px**, so a resting finger can
   finish a long press. The mouse keeps 4 px
   (`SONG_DRAG_THRESHOLD_PX`).
10. **Closing:** Escape, a press outside, a scroll, or running an item
    closes the menu. A long press elsewhere reopens it there.
11. **Menu text is US English** (windsor#821).

## Options not taken

- **Mute part and Solo part in the menu:** M and S already do it.
- **Mute a region** (a deactivated clip), **Clear region pattern**,
  **region color**, **Freeze**, **Consolidate**, and zoom keys: not
  wanted, or no clean meaning in Windsor (every region owns its own
  pattern).
- **Set sequencer on a part that has one:** the kind change rebuilds the
  part at the kind's defaults, so a right-click would make losing the
  part's patterns too easy.
- **Sizing by `@media (pointer: coarse)`:** an iPad with a trackpad
  matches it, so a right-click would get the touch menu.
