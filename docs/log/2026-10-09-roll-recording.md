# Recording into the Roll

- **Date:** 2026-10-09
- **Status:** accepted (tacowars approved the mockup on 2026-10-09)
- **Links:** this record's issue, windsor#659 · the mockup,
  `docs/research/2026-10-09-roll-recording-mockup/mockup.html` · the Roll
  record `2026-10-04-roll-sequencer` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

The Roll (`2026-10-04-roll-sequencer`) is drawn by hand: its v1 left out
recording from MIDI or the computer keyboard, and quantise. A piano roll
that cannot take what is played is slow to fill, and a played take is
rarely on the grid.

This record lets the Roll record what tacowars plays, the way a
traditional MIDI sequencer records: with Rec on and the transport running,
notes played on the selected part are written into the Roll region under
the playhead. A separate Quantise button snaps onsets to the device's Snap.
The decisions were agreed with tacowars on 2026-10-09. The mockup draws the
two new controls; once it is approved, it and this record are the spec for
the build tickets.

## Decisions

1. **Arm, then play.** A **Rec** switch on the Roll device, off by
   default. It is console state, not song data, and it is not remembered
   across reloads. It is live only when the selected part is a Roll part
   and a region of that part lies under the playhead. Otherwise Rec off is
   drawn disabled, with a hint saying why ("No region under the
   playhead"). Once armed, Rec stays live wherever the playhead goes, so it
   can always be turned off (decision 7). With Rec on and the transport stopped, playing only sounds
   the part, as it does today.
2. **Sources.** Notes played through the console's audition `Keyboard`
   are recorded: a MIDI input (through `MidiPerformer`), the computer
   keyboard and the on-screen keys. The Roll's own Audition
   (`rollAudition.ts`, which calls `part.noteOn` directly) is never
   recorded.
3. **Timing.** Each note is stamped at the tick tacowars heard when
   playing it. A MIDI event is stamped by its own `timeStamp`, mapped to the
   engine's audible tick (`audibleTick`), not the scheduler's lookahead. The
   onset is the region's local tick modulo the region's `loopTicks`.
   Resolution is the song's 24 PPQ, about 21 ms at 120 BPM. A finer grid is
   a format change and is out of scope.
4. **Overdub only.** Each pass of the loop adds notes to what is there,
   and nothing is erased. What a pass recorded plays back on the next pass.
   A new note at the same tick and pitch as an existing one replaces it.
   The normaliser settles the rest: where same-pitch notes overlap, the
   earlier is trimmed. There is no Replace mode in v1.
5. **When a note is written.** A note's length and the moment it is
   written are separate. Its length is what sounded: up to the key's
   release, extended by the sustain pedal or the console's Hold, and cut
   at the first of these:
   - the loop's end;
   - the region's end;
   - a transport stop;
   - a seek or a loop jump;
   - a part switch.

   It is written only when it stops sounding (the release reaches the
   part, or Panic) or when the take ends, never at its onset and never at
   a cut. A key held past the loop's end keeps its length frozen at the
   cut, stays pending while it rings, and is written on release. So the
   performer never starts it again at its onset while the played voice is
   still sounding, even when it is held for more than a whole loop. Until
   it is written the device draws it growing, then frozen. A note still
   latched by Hold when the take ends is written then; if its onset comes
   round while the latched voice rings, both sound until Panic.
6. **What is kept.** Pitch, velocity (the MIDI velocity, 0..1, as the
   note's `velocity`) and length. Pitch bend and the mod wheel are played
   live and not recorded: the Roll has no controller lanes.
7. **Which region.** A note goes into the region it starts in, through
   the same write the device's own editing uses. A take that crosses from
   one region into the next writes to both. If the playhead leaves every
   region of the part, recording pauses and Rec stays armed: the switch
   stays on and live, its label reads `paused`, and the hint under it
   says "No region under the playhead". Off disarms it there; left on,
   recording resumes when the playhead enters the part's next region.
8. **Undo.** One take is one undo step, across every region it wrote to.
   A take runs from Rec on (or the transport's start) to the transport's
   stop, Rec off or a part switch. Any other song edit made while
   recording (Quantise, a knob, a note dragged) splits the take
   (tacowars, 2026-10-09): the notes the take has written close as its
   own step, the edit is its own step, and recording carries on as a new
   take.
   - **A held note carries across the edit** (tacowars, 2026-10-10). It
     is not cut there: it goes into the new take, keeps growing, and is
     written on release into the new take's step, with its own onset and
     its full length. Undo then steps back through the later take (the
     carried note with it), the edit and the earlier take in turn. A
     held note whose place the edit removes (its region deleted, moved
     or given another loop length, or trimmed to end before the note's
     onset) is dropped, as there is nowhere left to write it.
   - **Undo and redo.** An undo pressed during a take closes the take's
     written notes first, then applies, and a note still held carries on
     as across any edit (windsor#663). A take is an ordinary edit for
     redo: its first write empties the redo stack, as every edit's does,
     so after an undo, recording leaves nothing to redo.
   - **Another control's drag** (tacowars, 2026-10-10). A drag holds its
     undo step open and folds every change into it, so a take never
     writes while one is open. Recording carries on through it: the
     drag's start closes the take as any edit does (held notes carry),
     the notes played during the drag are recorded and held back, and
     when the drag ends they are written as a new take, with its own
     step after the drag's. They play back from then on.

   The take's writes are never folded into another edit's step, nor
   another edit into the take's.
9. **The note cap.** Past `ROLL_NOTES_MAX` (2048) a region takes no new
   notes, and the device says so. A recorded note that replaces one at
   the same tick and pitch (decision 4) adds nothing to the count, so it
   is still written in a full region: the replacement is applied before
   the cap is checked.
10. **Raw recording, and a separate Quantise button.** Recording never
    quantises. **Quantise** snaps the onsets of the selected notes, or of
    every note in the region when none is selected, to the nearest step of
    the device's Snap.
    - Lengths are kept, except where two notes of one pitch then meet.
      Quantise writes through the same normaliser as every edit
      (`song/rollNormalise.ts`, and `rollEdits.ts` in the device): of two
      same-pitch notes that land on one tick the first in order is kept
      and the other dropped, and an earlier note that now runs into a
      later one's onset is trimmed to end there. The press stays one undo
      step, so undo brings both back. The build tests both cases.
    - A note that rounds onto the loop's end moves to the loop's start.
    - With Snap set to Off the button is disabled.
    - One press is one undo step.
    - It works on drawn notes as well as recorded ones.
    - There is no strength setting in v1.
11. **Not in v1**, listed under "Later" below: a count-in and a recording
    click, step record, Replace mode, quantise strength, and recording
    bend or the mod wheel.
12. **No format change.** Recorded notes are ordinary `RollNote`s, so
    `ARRANGEMENT_VERSION` stays where it is
    (`2026-09-28-format-versions-refuse-never-destroy`).

## The mockup

The mockup is today's Roll device, captured from the dev build in the
project's headless Chrome on 2026-10-09, in both the rack device and
Expand, with Rec and Quantise added. It proposes:

- **Quantise** in the first control column, under Fold, beside the Snap
  it snaps to. Its label names the step (`to 1/16`, or `snap off`), and
  the button names what it acts on (`All notes`, or `3 selected`).
- **Rec** in the second column, under Audition, drawn as Audition's
  two-way switch, in the record colour (`--hot`) where Audition uses the
  part colour. Its label reads the state: `no region` (disabled, with the
  hint under the switch), `armed`, `paused` (armed in a gap between
  regions, with the same hint, the switch still live), `recording` (the
  dot blinks) or `region full`. While recording, the held note grows with a
  record-coloured edge until it is written.
- **Region full** is said on the device's summary line, in the record
  colour.

## Consequences

- The build tickets, written once the mockup is approved, cover the
  recorder (the source tap, the audible-tick stamp, held notes and the
  write on release), the take as one undo step, Quantise, and the two
  controls.
- `2026-10-04-roll-sequencer` listed recording and quantise as not in
  v1. It is left as it is; the build amends it if it needs to.
- Recorded notes go through the same write and normaliser as drawn ones,
  so a song with a recorded Roll loads, round-trips and exports as any
  other.

## Later

- A count-in and a recording click.
- Step record.
- Replace mode, which clears what a pass plays over.
- Quantise strength.
- Recording pitch bend and the mod wheel, which needs controller lanes.
- A grid finer than 24 PPQ, which is a format change.
