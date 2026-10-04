# The Roll sequencer

- **Date:** 2026-10-04
- **Status:** accepted, being built
- **Links:** the epic, windsor#596 · this record's issue, windsor#599 (the
  kind in the song format) · the performer windsor#600, the region rule
  windsor#601, the device windsor#602, its editing windsor#603 · the
  mockup tacowars approved on 2026-10-04,
  `docs/research/2026-10-04-piano-roll/roll.html` (windsor#597) · the
  rack-device record `2026-10-01-sequencer-rack-devices` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

Every pitched kind so far writes relative to something. The Grid writes
scale degrees on a step line, the Figure writes chord tones, and the Arp
and the Basslead generate from the chord. None of them can hold a written
chord voicing, a melody with a free rhythm, or a chromatic passing tone.

A seventh kind, **Roll**, fills that gap: a piano roll over the selected
region, as FL Studio and Ableton draw one. A Roll part is a list of notes,
each an absolute pitch with a free start, length and velocity, on a loop
that is the region's length or shorter. The harmony guides the roll and
never limits it: the keys and the notes are coloured by the chord, and
nothing is moved by it.

## Decisions

1. **The kind is `roll`**, appended to `SEQUENCER_KINDS`. It draws
   nothing from a stream, so it is not in `SEEDED_KINDS` and has no
   `seed`. The kind is additive: nobody has saved one, so
   `ARRANGEMENT_VERSION` stays where it is.
2. **The config** is `{ loopTicks, notes }`
   (`sequencing/rollSequencer.ts`). A note is
   `{ tick, ticks, pitch, velocity }`:
   - `tick` is the onset in the region's local ticks (24 PPQ);
   - `ticks` is its length;
   - `pitch` is MIDI 0–127;
   - `velocity` is 0..1, absent is 1, and scales the part's velocity as a
     Figure cell's does.

   Notes are absolute: a key or chord change on the Harmony tab never
   moves them. A part holds at most `ROLL_NOTES_MAX` (2048) notes. The
   loop is 1 to `ROLL_LOOP_TICKS_MAX` ticks, `BARS_MAX` bars of 4/4, and a
   new roll loops one bar of the song's meter.
3. **The loop** is `loopTicks`, at most the region's length. Past the loop
   the region repeats it. A note held past the loop's end is cut there,
   and the region's end cuts it as it cuts every kind. A note whose `tick`
   is past the loop is kept and silent, so shrinking the loop loses
   nothing, as Grid keeps steps past its length. The normaliser never
   drops a note for lying past the loop, and it does not clamp a region's
   `loopTicks` to the region's duration; the performer plays only up to
   the region's end.
4. **The part's Vel** is the part's existing `velocity` (the field Grid's
   Vel knob sets). It scales every note's own. The config adds no velocity
   of its own.
5. **No automatic region.** Setting a part to Roll clears a single ∞
   region (the one a new part starts with), so the lane is empty and the
   author draws the first region. Drawn regions are kept. A region drawn
   on a Roll part with no neighbour gets an empty roll whose loop is the
   region's length. One with a neighbour copies the neighbour's pattern,
   as every kind does today. Region patterns carry the whole config, as
   every kind's do.
6. **Playback.** The performer hears every tick and plays each note at
   `tick` within the loop, held for `ticks`. Notes overlap freely across
   pitches, up to the part's voices. Entering a region mid-note (a seek, a
   loop jump) does not start that note: there is no chase. Swing applies
   as the clock applies it to every tick.
7. **The device** follows the approved mockup: the 244 px rack device
   with an Expand that opens it wide. Its controls are Snap (1/4 to 1/32,
   the triplets, Off), Loop in bars, Keys (12 or Scale), Fold, Vel, the
   ↔ zoom (Fit by default), the ↕ zoom and an Audition switch. Its panes
   are a bar ruler with the loop brace, a chord strip, the keyboard, the
   notes and a velocity lane.
8. **Gestures** are FL style, with no modes:
   - click empty space to add a note at the last length;
   - drag a note to move it, and drag its right edge to resize it;
   - click or right-click a note to delete it;
   - shift-drag to box-select, and Delete removes the selection;
   - drag the velocity stems, and drag the brace's end to change the loop.

   On touch, a tap adds a note and one finger on empty space scrolls.
   There is no recording in v1.
9. **Colour.** On the keys, the chord's root is solid amber, its other
   tones half amber, and the key's scale tones light grey; others are
   plain, and the rows stay plain. A note is amber on a chord tone, teal
   on a scale tone, and grey with a red edge outside the key, by the chord
   at the note's onset (a repeat by the chord it meets). Fill strength is
   velocity.
10. **Keys: Scale** hides the rows outside the key's scale, except a row
    that holds a note, which stays as a thin grey sliver. **Fold** shows
    only the rows that hold notes.
11. **The selected note's key** is outlined and always named, so a
    dragged note's pitch can be read off the keyboard. Dragging a note to
    the roll's edge scrolls it.
12. **Audition** on (the default) sounds a note when it is added or
    dragged to a new pitch; off is silent. The switch is remembered in the
    browser (`localStorage`, as the MIDI input choice is).
13. **View settings** (Snap, Keys, Fold, the zooms) are console state,
    not song data.
14. **An empty roll's loop follows its region's length** (2026-10-04,
    windsor#608). While a region's own roll holds no notes, an edit that
    changes the region's length sets its `loopTicks` to the new duration,
    capped at `ROLL_LOOP_TICKS_MAX`: an edge trim, a seam roll (both
    regions), a split (both halves) and the song-length follow that
    stretches an ∞ region. A roll with one note or more keeps its loop as
    the author's own, and a region with no pattern of its own is left
    alone. A body move changes no length and keeps the loop. The fit is
    part of the same edit, so one undo takes back both.

## The normaliser

`song/rollNormalise.ts` is the `roll` branch of `normaliseSequencer`, and
everything it returns passes `assertRollConfig`. Each change is reported
unless this list says it is silent:

- every number is clamped into its range, and a non-integer tick, length
  or pitch is rounded;
- an unknown key is dropped, and so is a note that is not an object;
- a note missing its tick, length or pitch takes 0, a sixteenth or middle
  C;
- the notes are sorted by `tick`, then `pitch`, silently;
- an exact duplicate (same `tick` and `pitch`) is dropped, keeping the
  first;
- where two notes share a pitch and the earlier runs into the later's
  onset, the earlier is trimmed to end there;
- the notes past `ROLL_NOTES_MAX` are trimmed;
- a `velocity` of 1 is dropped silently, so an export carries no default.

## Consequences

- windsor#599 carries the kind in the song format: the types, defaults,
  check, normaliser, region patterns, the console's stand-ins and this
  record. A Roll part loads, round-trips and exports. It builds no
  generator yet, so it plays nothing. The console shows a stand-in card
  and a lane summary (`roll · 41 notes · 4 bar loop`), and its part picker
  offers Roll only on a part that already is one.
- The performer (windsor#600), the region rule (windsor#601) and the
  device (windsor#602) can then run in parallel, and the editing
  (windsor#603) follows the rule and the device.
- Not in v1: recording from MIDI or the computer keyboard; quantise;
  per-note accent, slide or ratchet; step-mod lanes; copy and paste
  between regions.
