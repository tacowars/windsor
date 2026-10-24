# The Drum device: square pads over the Arp's rows

- **Date:** 2026-10-24
- **Status:** accepted. tacowars decided on PR windsor#953 on 2026-10-24:
  every recommended option of the mockup's pickers (decisions 1 to 5), and
  one change, square step pads (decision 6).
- **Mockup:** `docs/design/drum-device-mockup.html`, the spec the build
  follows, with its frames rendered as `docs/design/drum-device-today-*.jpg`
  (main at 8b2761d, captured from `npm run dev` in the project's headless
  Chrome) and `docs/design/drum-device-proposed-*.jpg` (captured from the
  served mockup). The pickers open on the choices below; the other ways
  stay selectable for comparison.
- **Links:** this record's issue, windsor#949 · the engine's `drum` kind,
  windsor#948 (record `2026-10-24-drum-sequencer`) · the build, windsor#951

## Context

windsor#948 adds a `drum` sequencer kind: a step pattern of hits and rests,
each hit with a velocity, an accent, a pitch offset from the part's note and
a ratchet, under the Grid's Length and Rotate, the Arp's Seed, Randomize and
Reverse, and step variation's Vary and Chance. windsor#949 mocked its rack
device in the Arp's place at the three viewports, built from the app's own
markup and rules, and left four choices to tacowars, plus a fifth the
mockup raised (the Vel bar's fill). The device is 244 px high, as every
sequencer device is (record `2026-10-01-sequencer-rack-devices`).

## Decisions

1. **Pitch shows the played note's name** (C4, D#4), `note + pitch` as the
   engine plays it, faint at offset 0, with the signed offset in the
   cell's tooltip. What sounds is what reads, and a tom roll reads as
   notes.
2. **The Pattern picker sits at the head of Play**, above Rate and Note in
   the field column, showing the pattern's name or Custom. It is the first
   thing a new part needs. Not on the rail.
3. **A ghost hit's dot dims below velocity 0.5** (to 40% of the accent), so
   the ghosts read in the hit row as well as on the Vel bar.
4. **Randomize keeps the hit count**: it draws as many hits as the pattern
   has now (at least one), at new places, each at a velocity from 0.3 to 1.
   Its tooltip says so. Not a fixed 8 of 16.
5. **The Vel bar fills across**, as the Figure's bar and the Arp's Gate bar
   do, and is dragged up or down. The issue's "a velocity bar's height is
   the velocity" read the Figure's bar wrongly; the real bar is the spec.
6. **The step pads are square.** The hit cell is as tall as the step column
   is wide, 32 × 32 px with a 12 px dot, so the pads stand taller than the
   other step rows and read as the device's main control. The other rows
   keep the Arp's 20 px cells and 4 px row gap, so the held rows are 138
   px, 12 more than the 126 px they were with a 20 px hit cell (a new
   `--drum-strip-head-h` beside `--bass-strip-head-h`). The device stays
   244 px high and 1156 px wide at 16 steps. What gives is the lane area:
   measured in the mockup, the strip is 218 px high, so where two 42 px
   step lanes showed in full before the lanes scroll, one does now, with 34
   px of the second (the Arp, at 150 px, shows one and 22 px). A tighter
   row gap was the other way to pay for it, but it needed 1.6 px in place
   of 4 across the five gaps, off the Arp's rows, so the lanes scroll
   sooner instead.
