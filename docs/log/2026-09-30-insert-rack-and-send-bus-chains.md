# The insert rack and send buses with insert chains

- **Date:** 2026-09-30
- **Status:** accepted (tacowars, 2026-09-30)
- **Links:** mockup `docs/research/2026-09-30-insert-rack/mockup.html` ·
  the issues are listed at the end

## Context

Inserts had no common size. Classic Drive was three knobs, and Advanced
Drive with its sections open was about 800 px tall, so a strip's chain was as
tall as its tallest insert and the Song tab's detail pane jumped as inserts
were added. Bitwig and Live keep every device the same height and let the
width vary.

The two returns were fixed: `room` ran the Dattorro plate and `echo` a
simple delay with a soft-clipped loop. Neither effect could be used on a
part, a return could not be swapped for another effect, and a return could
hold only one effect.

tacowars compared the layouts in the mockup: pages or all sections side by
side, three heights, and the name on a top bar or a side rail.

## Decision

1. **Every insert is 196 px tall, and its width comes from its content.**
   A chain is one row that scrolls sideways and never wraps. This holds
   wherever a chain shows: a part on the Song tab or the Mixer tab, the
   master, and the send buses.
2. **The name is on a side rail,** 24 px wide on the insert's left. It holds
   the on/off switch at the top, the vertical name, and move earlier, move
   later and remove at the bottom. Clicking the name folds the insert to its
   rail, and clicking a folded insert opens it again.
3. **A complex insert is split into pages.** A thin row of tabs at the top
   of its body picks the page. An insert whose controls fit in two rows of
   knobs has one page and no tabs. The page shown and the fold are view
   state for the session only, never saved in the song.
4. **Every insert kind has an on/off switch.** Classic Drive gains
   `enabled`, the one kind without it. The field is additive and defaults
   to on, so the format doesn't change.
5. **The plate and the echo become insert kinds,** Plate reverb (`plate`)
   and Echo (`echo`), with the same DSP and controls as today's returns
   plus a Mix knob. Any part, the master or a send bus can use them.
   - On a part or the master, a new one starts at Mix 0.30.
   - On a send bus, a new one starts at Mix 1.00, fully wet, as the returns
     are today.
6. **There are two send buses, Send A and Send B.** Each is a level and an
   insert chain of up to `MAX_INSERTS` inserts of any kind. By default,
   Send A holds a Plate reverb (the hall space) at level 0.90, and Send B
   holds an Echo at level 0.60, the same sounds as today's `room` and
   `echo`. The song names them `a` and `b`, in `returns` and in each strip's
   `sends`. The count stays at two.
7. **This changes the song format.** `ARRANGEMENT_VERSION` goes from 3 to 4,
   with an upgrade in `songMigrations.ts`:
   - `returns.room` becomes `returns.a`, holding a Plate reverb with its
     space at Mix 1.00;
   - `returns.echo` becomes `returns.b`, holding an Echo with its time,
     regeneration, damping and resonance at Mix 1.00;
   - every strip's `sends.room` and `sends.echo` become `sends.a` and
     `sends.b`.

## Consequences

- An insert card declares its pages instead of returning one element. The
  shell that draws the rail, the tabs and the fold is shared by every kind.
- Advanced Drive and Tape need pages of their own. Until they have them,
  their bodies scroll inside the fixed height.
- A Plate reverb on a part costs one reverb processor per instance, and
  more instances than the old single return can run at once.
- The Mixer tab's returns section becomes the send buses: each bus shows
  its level and its chain.

## Issues

- windsor#171: Plate reverb and Echo as insert kinds, and Classic Drive's
  switch (seam)
- windsor#172: Send A and Send B hold insert chains
- windsor#173: the insert rack, with its fixed height, side rail and pages
- windsor#174: Advanced Drive in pages
- windsor#175: Tape in pages
