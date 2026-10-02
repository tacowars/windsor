# One meter per song

- **Date:** 2026-10-02
- **Status:** accepted (the decisions of windsor#428 and windsor#429, tacowars)
- **Links:** windsor#428 (the engine seam) · windsor#429 (the song field and
  the clock) · windsor#431 (the meter picker) · supersedes epic #703
  decision 7, recorded in `2026-09-26-harmony-v2-document-v3-timeline-and-regions`
  §2 ("4/4 stays the constant") · keeps `2026-09-28-song-swing-in-the-transport`
  and `2026-09-28-song-loop-in-the-transport` · the format rule of
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

Epic #703 decision 7 held 4/4 constant: a bar was 96 ticks everywhere, and
a meter field "can be added later". Songs in 3/4, 6/8 or 7/8 could only be
faked with a Grid length that drifts against the bar ruler, swing pairs
counted from the song's start, and a Euclid figure that re-cut on a 4/4 bar
line nobody hears. This record is the meter's design: the engine seam
(windsor#428) made every length go through a meter, and windsor#429 lets a
song name one.

## Decision

1. **One meter per song, from a fixed list:** 3/4, 4/4, 5/4, 6/8, 7/8,
   12/8. No meter changes inside a song. This supersedes epic #703
   decision 7; the imported record is history and is not edited.
2. **The meter table is data** (`sequencing/meterTables.ts`, read by the
   pure `sequencing/meter.ts`): each meter's counted beats in ticks on the
   24 PPQ grid. The bar is the sum of the beats.

   | Meter | Beats (ticks) | Bar |
   |---|---|---|
   | 3/4 | 24 · 24 · 24 | 72 |
   | 4/4 | 24 · 24 · 24 · 24 | 96 |
   | 5/4 | 24 × 5 | 120 |
   | 6/8 | 36 · 36 | 72 |
   | 7/8 | 24 · 24 · 36 (2+2+3) | 84 |
   | 12/8 | 36 × 4 | 144 |

   7/8 is grouped 2+2+3, the more common grouping. Choosing a grouping is
   out of scope; a later additive field could add one.
3. **Step lengths are note values, not bars.** `DIVISORS` comes from the
   96-tick whole note, `DIVISORS.whole` replaced `DIVISORS.bar`, and a
   divisor is valid when it divides the whole note (`isNoteDivisor`). A
   stored divisor keeps its ticks in every meter, so a 4/4 pattern in a 7/8
   song plays where it was, as a polymeter. A bar-long step in another
   meter is a step count, not a divisor.
4. **One function measures a song:** `songTicks(bars, meter)`, 4/4 when
   the meter is absent. Every song length in the engine goes through it.
5. **Swing restarts at every counted beat.** Pairs run from each beat's
   start, and a remainder shorter than a pair plays straight: in 6/8 on the
   1/8 grid each dotted-quarter beat is one swung pair and one straight
   8th, and 7/8's last beat is the same. In 4/4 every beat is 24 ticks, so
   the warp is the old one bit for bit. A ratchet's roll is spaced on the
   same beats.
6. **The field is `transport.meter`**, an optional string from the list,
   normalised with `pick`: anything else is 4/4, reported. Absent stays
   absent, like `swing` and `loop`: a song without it plays 4/4 and
   round-trips without gaining the field, and a song that names one,
   `'4/4'` included, round-trips as written. The field is additive and its
   default reproduces the old behaviour, so neither `ARRANGEMENT_VERSION`
   nor `PATCH_FILE_FORMAT` changes.
7. **Changing the meter keeps every tick and the bar count.** Regions,
   harmony events, automation points and the loop stay at their absolute
   ticks; only the bar lines move. The song becomes `bars ×` the new bar
   long. What falls past a shorter end is cut exactly as lowering Bars cuts
   it, one undo step back; switching back does not restore it. Nothing is
   stretched.
8. **The clock counts the song's bars.** The scheduler's and each region
   gate's `bar` and `tickInBar` come from the meter, so Euclid's re-cut on
   the bar line and its bar-synced density LFO follow with no change of
   their own.
9. **A new part is one bar long.** A Grid, Bass or Euclid part written
   without steps gets one bar of its default step in the song's meter
   (`defaultStepCount(meter, divisor)`: 7/8 at 1/16 is 14 steps, 12/8 at
   1/16 is 24, within the Grid's 32). The normaliser fills it, so a part
   the console adds as a bare kind is one bar long, and the engine exports
   `defaultStepCount` for the console. A stored step list never changes.
10. **The Chord Player's default base step is the quarter** in any meter
    but 4/4, where a whole note is not a bar. In 4/4, and with no meter, it
    stays the whole note.
11. **The loop's grid follows the meter** (made while building
    windsor#429). The loop's points snapped to the quarter, which puts a
    7/8 bar line (84) off the grid. The grid is now the largest step that
    the quarter and each of the meter's beats are whole numbers of
    (`loopGridTicks`): the quarter in 3/4, 4/4 and 5/4, the 8th in 6/8,
    7/8 and 12/8. Every loop point a 4/4 song can hold stays on the grid in
    every meter, so decision 7 holds for the loop too.

## UI

windsor#431's decisions (tacowars, 2026-10-02), settled on the approved
mockup `docs/research/2026-10-02-time-signatures/mockup.html`. The app
reads every beat from the engine's `meterBeats`, never a copy
(`packages/app/src/meterGrid.ts`).

1. **The picker** is a plain select in the header's swing group, where the
   fixed `4/4` box sat, the same size and style as the swing grid's `1/16`
   select. It lists the engine's `METERS` in order by their bare ids (`7/8`,
   not `7/8 (2+2+3)`), shows 4/4 for a song that names none, and writes
   `transport.meter` through `ctx.change` as one undo step. A shorter meter
   cuts what falls past the new end on the Bars path (`followSongLength`),
   in the same step.
2. **Bar lines.** The Song ruler stays as it was: a full-height bar line and
   a 6px tick at each counted beat. In a step strip, a step that starts a
   new bar gets a wider gap, `--bar-gap` (10px, beside `--beat-gap`'s 4px in
   `sequencerDeviceTables.ts`).
3. **7/8's long beat** is just a longer group, with no tint or label.
4. **Grouping at every step length**, one rule shared by the Grid, Chord and
   Euclid strips: a beat gap before each step that starts a counted beat
   when every beat holds two steps or more; otherwise a bar gap before each
   step that starts a bar; and when a step is a bar or longer, groups of
   four with the beat gap, never the bar gap. A beat or bar line no step
   lands on exactly goes before the first step past it, and a bar line wins
   when one step spans both, so 7/8 at 1/2T still groups by bar. Every
   meter at every step draws one bar gap per bar line crossed. 4/4 at 1/8
   groups 2 · 2 · 2 · 2 (it was 4 · 4) and at 1/32 in eights. Steps past
   the first bar keep the bar's beats: a 16-step 1/16 pattern in 7/8 groups
   4 · 4 · 6 | 2. The Chord strip groups its columns at the base step.
5. **The position readout** is `bar.beat.sixteenth` with the beat the
   counted beat (6/8 has 2, 7/8 has 3, 12/8 has 4) and the third field
   16ths inside it, 1–6 in a dotted-quarter beat, in every meter: 6/8 tick
   36 reads `1.2.1`, and 7/8's last 16th of bar 2 reads `2.3.6`. Not 8ths in
   the /8 meters, which would lose the 16th.
6. **The step pickers' 96** reads `1 bar` where the bar is a whole note
   (4/4) and `1/1` in every other meter; its value is unchanged. A region's
   summary on the Song lanes names it the same way.

The mockup's teal beat numbers, its toolbar and its "4/4 end" marker were
aids for the review, not product UI.
