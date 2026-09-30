# The mixer moves onto the Song tab

- **Date:** 2026-09-30
- **Status:** accepted (tacowars, 2026-09-30, epic windsor#152)
- **Links:** epic windsor#152 · mute and solo windsor#154 · part strip
  meters windsor#155 · the insert panel windsor#156 · the mixer column
  windsor#157 · the expanded strip windsor#158 · the lights windsor#159 ·
  the Mixer tab's strips removed windsor#160

## Context

Each part had its strip on the Mixer tab: Level, Pan, Low cut, a send per
return, Output and its inserts. Every new part added a strip, so the tab
grew downwards. The inserts gave the strips different heights, so a
part's Level knob was hard to find quickly. Adjusting a level meant
leaving the Song tab, where the arranging happens. There was no mute, no
solo and no per-strip meter; only the master had a peak meter.

tacowars drew mockups of a mixer column beside the Song tab's lanes,
collapsed and expanded, and of the insert chain under the sequencer card.
They are kept out of the repository until the epic closes, on tacowars's
machine under `docs/research/2026-09-30-mixer-revamp/`.

## Decision

1. **A mixer column on the Song tab,** between the lane names and the
   timeline. The name and mixer columns stay put while the timeline scrolls
   sideways.
2. **Collapsed by default,** in a row of about 40 px: a small Level knob
   with its value, M, S, a green activity light and a red clip light. It
   was chosen over the mockup's taller stacked layout, which would have made
   every lane about 64 px, so the lanes stay about as dense as before.
3. **One arrow in the column's header expands every strip** to Level,
   Pan, Low cut, the sends and Output. The labels sit in the header, not in
   each row. The timeline moves right; it is not overlaid.
4. **Output keeps its two choices,** `master` and `sidechain`. The buses in
   the mockup are not part of this; they would be an epic of their own.
5. **Mute and solo are strip fields in the song,** undoable one press at a
   time. They are additive and off by default, so no format bump
   (`2026-09-28-format-versions-refuse-never-destroy`).
   - Mute is post-fader and cuts the sends.
   - Solo is additive over the music parts. It silences the other parts'
     dry signal and sends, and leaves the returns playing.
   - Neither touches a sidechain key: soloing a pad keeps the kick ducking
     it.
   - Renders and stems play what playback plays.
6. **The lights read a peak meter on each part strip,** post-fader,
   post-mute and post-pan. The meter is built lazily, as the master's is,
   and is active only while the Song tab shows its row. Its cost is
   measured in `docs/research/2026-09-30-part-strip-meters/`. The clip light
   latches at 0 dBFS until clicked.
7. **A selected part's insert chain shows under its sequencer card** in the
   Song tab's detail pane. The sequencer section and the insert panel each
   collapse with an arrow.
8. **The Song tab keeps its arrows in its view state,** for the session
   only, never in the song.
9. **The Mixer tab keeps the returns, the master level and inserts, the
   master meter and the limiter/clipper,** until tacowars plans that area.
   Its strips section goes last (windsor#160), once the Song tab has
   everything the strips offered. Renaming a part stays on the Parts tab.

## Consequences

- The Song tab's grid has three columns. Anything placed by pixel math
  from the timeline's left edge includes the mixer column's width.
- Knobs gain a compact size for the 40 px rows.
- Until windsor#160 lands, a part's strip is editable on both tabs. Song
  tab edits invalidate the Mixer tab, so it redraws when opened.
- The returns, the master and the output stage have no place on the Song
  tab yet. Where they go is tacowars's next decision; the Mixer tab
  disappears only then.
