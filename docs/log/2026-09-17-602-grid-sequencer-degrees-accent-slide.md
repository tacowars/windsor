# The grid sequencer: degrees not notes, accent per note, slide as a retarget

- Date: 2026-09-17
- Area: audio
- Links: epic #601 · issue #602 (engine) · #603 (the console's grid card) ·
  `2026-08-31-generative-sequencing-transport-and-pitch` (§4 pitch, §6 the
  step sequencer) · `2026-09-17-music-parts-are-a-slot-list-with-a-sequencer-kind` ·
  #586 (the wheel's two destinations)

## Decision

Refined with Pat on 2026-09-17; every point below was Pat's call.

1. **A new kind, `grid`, beside `step`.** The generative `step` sequencer
   stays the drone. The grid is a written line of 1–32 steps, looped on its
   own length: position is the transport's absolute step count modulo the
   length, never the position in the bar, so a 12-step line at sixteenths
   drifts polymetrically and a live rebuild recomputes its place from the
   clock.
2. **A step is a rest, a tie, or a note `{ degree, octave, accent, slide }`.**
   A tie extends the held note with no event, a tie on step 0 across the
   loop; a rest releases; a note releases the held note on its tick and
   starts. A **skipped step is a rest**: `skipChance` draws once per note
   step from the part's seeded stream (the arpeggiator's idiom), so a rest
   or tie edit never moves the skip pattern around it.
3. **Notes are scale degrees, resolved at play time** through the song's one
   `ScaleSampler`, so a key or scale change on the Harmony tab re-pitches the
   line. The base transposition is the part's `register.octave`; the grid
   has no span, since nothing is drawn.
4. **A degree past the end of the current scale wraps with octave carry**
   (`foldDegree`): degree 6 in a five-degree scale is degree 1 an octave up.
   Never clamped, never rewritten in the document, so a line written in seven
   degrees keeps its contour in five and a round trip back is lossless.
5. **Accent travels with the note, not on the wheel.** The note-on message
   carries an optional `mod`; the voice stores it and adds it to the wheel
   wherever the control update reads `modWheel`, so `lfo.modWheelDepth` and
   `filter.modWheelDepth` (#586) apply unchanged. Two sequencer knobs,
   `accentVelocity` and `accentMod`, are the bump an accented step adds to
   the part velocity and the mod value it sends. The patch decides what an
   accent does: `velSens` for gain, the two depths for the filter and the
   LFO.
6. **Slide is a legato retarget in the worklet.** In mono mode with a voice
   sounding, a `slide` note-on re-points that voice — pitch target, key
   offset constants, velocity, mod — and rebinds it to the new handle;
   envelopes, LFO, phase and filter state carry on. The generator emits the
   slid note-on *before* the old note-off at the same tick so the handoff is
   legato; the stale off is a no-op. Glide time is the patch's `glide` when
   set, else `SLIDE_SECONDS_DEFAULT`. Outside mono, or with nothing sounding,
   the flag is ignored.
7. **Capture does not apply.** A written line is its own record; the grid
   card (#603) has no Capture button and the player keeps no recorder for it.

## Why

Pat wants a classic programmable step sequencer with 303-style slide,
accent, tie, rest and per-step octave, where an accent can be programmed
into a patch as an acid line (gain and filter envelope together) or
something stranger, and where every note comes from the key on the Harmony
tab.

Degrees rather than MIDI notes are what make the last point free: the line
follows a key change with no rewrite, and the console's picker can offer
only the scale. Wrap-with-carry is what "the seventh note" means when there
are five, and it is the only rule under which the step data survives a
scale change untouched.

Accent as a per-note field, rather than automating the part's `modWheel`
param per step, keeps the accent off the previous note's release tail, off
a live wheel on the same part, and correct polyphonically; adding 0 to the
wheel is exact, so every existing patch renders bit-identically (the accent
test asserts a plain note against the pre-change path, and a one-off
render of the whole bank against `main`'s worklet was equal sample for
sample — see PR #602).

A retarget rather than the existing new-voice glide is the difference
between a slide and a retrigger: the 303's envelope does not restart on a
slid note, and neither does this one. The per-note constants that depend on
the key offset (#548) are recomputed for the new note, as `rebind` does for
a live retune.

## Punted / alternatives

- **Clamping an out-of-scale degree to the top degree.** Flattens the line
  and collapses distinct steps to one pitch; wrap keeps the contour.
- **A skipped step holding the previous note** rather than resting. Rest
  is what a 303 does when a step is off; Pat chose rest.
- **Fixed accent amounts** (velocity 1, mod 1) with the patch doing all the
  shaping. Pat wanted the two knobs.
- **Patterns longer than a bar through a bar counter.** Unnecessary: the
  absolute step count already gives any length, and polymetric lines for
  free.
- **Per-step velocity, probability, length or ratchets.** Not asked for; a
  later ticket can add fields to `GridNoteStep`, and the normaliser's
  defaults keep old documents valid.
- **The console's grid card** is #603.
