# The Figure sequencer

- **Date:** 2026-10-03
- **Status:** accepted, being built
- **Links:** the epic, windsor#483 · this record's issue, windsor#484 (the
  kind in the song format) · the performer windsor#485, the schedule and
  drift windsor#486, the canon source windsor#487, sequencer parameters as
  lane targets windsor#488, the device windsor#489 / windsor#490 · the
  rack-device record `2026-10-01-sequencer-rack-devices` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

Two pieces written on 2026-10-02 in the manner of Reich and Glass showed
what the sequencers lack. A Reich mallet part took fifteen regions for one
beat-substitution process. The Glass figures had to be Arps, because a
Grid line names scale degrees and cannot follow the chord. The canon
voices were rotated copies made by hand.

The Grid stays for drums and fixed material, and the Arp for generative
traversals. A sixth kind fills the gap: a written line of cells over the
*current chord*, which keeps its shape while the harmony moves, with the
process controls those composers use built in.

## Decisions

1. **The kind is `figure`.** It is appended to `SEQUENCER_KINDS`, it is
   seeded, and it has its own `DEFAULT_FIGURE_CONFIG`. A new part starts
   with one bar in the song's meter, as a Grid does: 16 sixteenths in 4/4,
   14 in 7/8, 24 in 12/8. The default cells cycle tones 0, 1, 2, 1 (the
   Glass broken chord). The kind is additive: nobody has saved one, so
   `ARRANGEMENT_VERSION` stays where it is.
2. **A cell** is a rest, a tie, or a note
   `{ tone, octave, velocity, accent, slide, ratchet? }`. `tone` is an
   integer from −8 to 8 into the chord's stack, with octave carry:
   tone *i* is `stack[i mod n] + 12·⌊i / n⌋`. So 3 on a triad is the root
   an octave up, and −1 is the top tone an octave down. The rule is one
   pure function, `figureNote` (`harmony/figureTones.ts`). There is no
   voicing enum, because a Figure writes its own voicing in its cells.
   `velocity` (0 to 1, default 1) scales the part's velocity, and `accent`
   keeps the Grid's accent mod. A line has 1 to 32 cells. A velocity of 1
   and a ratchet of 1 are left out of an export.
3. **Pitch** follows the Arp's rule: the key root at the part's `register`
   octave, plus the tone, plus `12·octave`, clipped to MIDI 0–127 and
   dropped outside it. A cell reads the chord holding at its own onset,
   and a sounding cell never moves on a chord change. Slides, ties,
   accents, step-mod lanes and ratchets behave exactly as the Grid's.
4. **The length schedule** is
   `schedule: { length: 1..cells, bars: 1..64 }[]` (additive growth: 4,
   5, 6, 7, 8 cells, so many bars each). Absent or empty means every cell.
   Stages advance on the region's local bar lines and cycle. The line
   restarts at cell 0 at a stage change. The normaliser drops a stage
   longer than the cells, with a report.
5. **Rotation drift** is `drift: { steps: −4..4, everyBars: 1..64 }`.
   Absent means none. Every `everyBars` local bars the rotation adds
   `steps`, and the cell played is `(step + rotation) mod length`. That
   gives Clapping Music and Piano Phase. Drift restarts at a region entry,
   as every lane does.
6. **A canon source** is
   `source: { slot, offset: −32..32, transpose: −24..24 }`. Absent means
   the part's own cells. With a source, the part plays the source part's
   resolved cell at `step − offset`, through its own divisor, gate,
   register, velocity and strip, transposed in semitones. The normaliser
   drops a source that names the part itself, an empty slot or a part
   that is not a Figure, each with a correction. So a kind change
   elsewhere silences a canon on the next normalise, and the console only
   offers Figure parts. The check runs in the parts pass, where the whole
   part list is known, and it covers a region pattern's source too.
7. **Sequencer parameters become lane targets**, a fourth lane family
   `seq.<field>`: `gate` and `skipChance` on the Figure, Grid and Arp, and
   `gate` and `density` on the Bass. The region gate evaluates them at
   each tick and hands the values on with the tick event. The generator
   reads the handed value instead of its config field. There is no
   AudioParam and no worklet change, so offline render is identical by
   construction. Beat substitution becomes one region and one curve
   instead of eight regions.
8. **The device** (windsor#490, built to the mockup tacowars approved in
   windsor#489, `docs/research/2026-10-03-figure-sequencer/figure.html`) is
   the 244 px sequencer device with two page tabs, as the Euclid device
   has them. The tabs take the 20 px a section label would, so the pages
   carry no section labels; the summary at the tabs' right names the
   cells, the chord, the stage, the rotation and the leader in play.
   - **Cells** holds the Arp's Play columns (Rate, Seed with Reseed and
     Randomize; Octave, Length and Rotate; Vel, Acc vel and Acc mod; Gate
     and Skip) and the Grid's 32 px strip: per cell the tone, Oct, a Vel
     bar, A, S and the ratchet, held at the top while the lanes scroll
     under them. A click on the tone cycles note, tie and rest, and a
     right-click opens a picker of the seventeen tones. Its label is the
     chord degree of the tone over the chord under the playhead (`R 3 5 7`,
     a prime per octave up, a minus per octave down, so a sus chord reads
     `R 4 5`), which tacowars chose over stack positions. Vel is a bar the
     user drags, 0 to 1, faint at 1. Cells past the stage in play are
     dimmed, not hidden, and the playhead is the engine's `regionStepAt`.
   - **Process** holds the Schedule (a chip per stage, `length × bars`:
     drag to reorder, × to remove, + to add one a cell longer than the
     last; the stage in play outlined), the Drift (Steps and Every) and the
     Source (the song's other Figure parts by name, Offset and Transpose,
     and the hint that a chain follows one level). With a source the Cells
     strip draws the leader's cells greyed and read-only under the
     follower's playhead.
   - Every edit writes the selected region's pattern, the seed the part's.
     The page shown is the session's.
9. **Position.** `stepAt` is the cell that sounds after rotation and the
   stage, so the strip lights what is heard.

## Consequences

- windsor#484 carries the kind in the song format: the types, defaults,
  normaliser, region patterns, the chord-tone rule and this record. A
  Figure part loads, round-trips and exports. It builds no generator yet,
  so it plays nothing, and the part list does not offer it until the
  device lands.
- The performer (windsor#485) adds the generator and the player's build
  switch, then the processes (windsor#486, windsor#487) and the lane
  targets (windsor#488) follow, and the device (windsor#490) after them.
- Later, outside this epic: a Figure that reads a scale degree instead of
  a chord tone, velocity ramps across a ratchet roll, a per-part tempo
  ratio for true phasing, and Euclid `k` as a lane target.
