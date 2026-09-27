# The chord sequencer: diatonic chords by degree, one voicing per part, a blank start

- Date: 2026-09-17
- Area: audio
- Links: epic #605 · issue #606 (engine) · #607 (the console's chord card) ·
  `2026-09-17-602-grid-sequencer-degrees-accent-slide` (the written-kind
  pattern this follows) · `2026-09-17-music-parts-are-a-slot-list-with-a-sequencer-kind` ·
  `2026-08-31-generative-sequencing-transport-and-pitch` (§4 pitch)

## Decision

Refined with Pat on 2026-09-17 from a brief modelled on Scaler 2; points 1,
3, 4, 7 and 12 are the refiner's reading of that brief, the rest Pat's own
calls at refinement.

1. **A new kind, `chord`**, beside `grid` and `step`: a written progression
   of 0–32 steps, looped on its own total length in ticks. Not an extension
   of the grid step: a chord step's fields (size, inversion, repeat, a
   duration that varies per step) share nothing with a grid step's, and the
   grid's fixed-divisor position rule cannot express variable step lengths.
2. **A step is a rest or a chord.** A chord step is `{ degree, size,
   inversion, octave, semitone, duration, repeat }`, a rest `{ duration,
   repeat }`. `size` is 3 (triad) or 4 (seventh); `inversion` 0–3, `octave`
   ±2, `semitone` ±11; `duration` is a multiplier of the part's base step from
   `CHORD_DURATIONS`; `repeat` 1–8 plays the step that many times in a row,
   retriggered each time.
3. **Chords are stored as degrees, never as notes** (#602 decision 3
   applied): a key or scale change on the Harmony tab re-voices every step;
   a degree past the scale wraps with octave carry (`foldDegree`).
4. **The diatonic chords are tertian stacks over the scale's own degrees**:
   degree *d*'s chord is degrees *d*, *d*+2, *d*+4 (and *d*+6), each folded.
   Over the seven-note scales this is textbook harmony; over a pentatonic or
   custom scale it still yields a chord per degree, whose quality may be
   `other` — named by its notes and numbered by its degree.
5. **Roman numerals follow the quality**: upper case for major and
   augmented, lower for minor and diminished, `°`, `+`, `7`, `maj7`, `ø7`,
   `°7` suffixes, so C natural minor reads `i ii° III iv v VI VII`.
6. **Inversion is per step; voicing is per part** (Pat): Scaler applies a
   voicing to the whole chord set. Inversion rotates the close stack with
   octave carry (inversion 3 of a triad is root position an octave up; the
   written value is kept). The part's `voicing` — `close`, `drop2`, `drop3`,
   `spread`, `octaves3rds`, `shell` — transforms every step's inverted stack,
   and changing it re-voices the whole progression live.
7. **Timing**: the base step (`divisor`) is a bar, half, quarter or eighth,
   the four for which every duration multiplier lands on a whole tick; a
   step lasts `duration × divisor` ticks per repeat; position is the
   transport's absolute tick modulo the pattern's total length, so a rebuild
   recomputes its place. The generator subscribes at every tick and acts on
   segment starts. A part-level `gate` in (0, 1] sets a chord's length as a
   fraction of its step; at 1 the offs land on the next onset's tick, before
   that onset's ons. Repeats retrigger; there are no ties.
8. **A chip auditions through the chord part the card belongs to** (Pat),
   the synth the progression will play, never the Parts tab's selection.
   Dragging a chip or the Rest tile onto a step replaces the step's chord and
   keeps its timing. Pointer-capture drag, as `envelopeDrag.ts`.
9. **Capture does not apply**; no recorder, no Capture button.
10. **A chord part opens blank** (Pat): no steps, silent until a chord is
    dropped in; `steps` may be empty and an empty list is never defaulted.
11. **Note names are spelled with sharps** (Pat), as `noteName` already does.
12. **A voicing yields at most six notes**; a mono patch hears the top one.
    `MUSIC_PART_MAX_VOICES` is not raised.
13. **Every edit but the kind reconfigures live** (#603's rule): the
    progression, gate, voicing, register, divisor and the sampler after a key
    change all reach the running generator through `reconfigure`, validated
    inside the player's plan; whatever is held plays on until the next onset
    releases it. An empty pattern releases what a previous one left sounding
    on its first tick. A gated chord's offs are therefore emitted on the tick
    its gate ends, never scheduled ahead at the onset (a Codex finding on
    the first cut): a pre-scheduled off cannot be pulled forward, so an edit
    that cleared an eight-bar gated step would have left it ringing.

## Why

Pat wants to program chord progressions that match the key and scale chosen
on the Harmony tab, the way Scaler does it: pick from the key's own chords,
see the analysis, hear a chord before placing it, and shape each step's
timing, repeat, octave, inversion and shift.

Degrees rather than notes make the progression follow a key change with no
rewrite and let the picker offer only the scale. Tertian stacking over the
scale's own degrees is the one rule that gives every scale the song can hold
a chord per degree, custom scales included. A per-part voicing matches how a
player thinks of a voicing — a sound for the whole progression — and is what
Scaler does. Variable step lengths are why the chord generator lays its steps
out in ticks and subscribes at the tick rather than at a divisor.

## Punted / alternatives

- **Chords as a grid step field.** Rejected (decision 1).
- **A fixed chord table per named scale.** Rejected: custom scales would have
  no chords.
- **Voicing per step.** Rejected by Pat for Scaler's per-set voicing.
- **Auditioning through the Parts tab's selected part**, as the brief first
  read. Rejected by Pat: the chord part is what the step will sound like.
- **Flat spelling for flat keys.** Sharps only for now; a spelling-by-key
  pass can come later without touching the document.
- **Per-step velocity, ties across repeats, strums, ninths.** Not asked for;
  a later ticket can add fields, and the normaliser's defaults keep old
  documents valid.
- **The console's chord card** is #607.
