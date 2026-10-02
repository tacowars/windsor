# A harmony event may name its chord quality and an accidental

- **Date:** 2026-10-02
- **Status:** accepted and built (windsor#330). The Song tab's editor for
  the new fields is a second ticket.
- **Refines:** `2026-09-26-harmony-v2-document-v3-timeline-and-regions`
  decision 3
- **Supersedes, for the chromatic case only:** `docs/research/harmonysequencerV2.md`
  §2, "never store a quality"

## Context

A harmony event was `{ start, duration, degree, size }`, strictly diatonic:
every performer rebuilt the chord from `degree` and `size` against the song
scale. A chromatic mediant (E minor to E♭ major), a borrowed chord (♭VI in
a major key) or a major V in a minor key could not be written, so two pieces
written against Glass and Reich scores had to stay diatonic throughout.
The research note behind harmony v2 chose never to store a quality, because
the theory already derives one from the scale. That still holds for a
diatonic chord; it cannot hold for a chord the scale does not spell.

## Decision

1. **The shape.** `HarmonyEvent` gains two optional fields:
   `quality?: NamedQuality`, the tertian stack to build instead of the
   scale's own (any quality in `QUALITY_INTERVALS`, never `'other'`), and
   `accidental?: -1 | 1`, semitones added to the root and every tone.
   Absent is the diatonic, natural chord. `HarmonyChord`, what `chordAt`
   hands the performers, gains `stack`: semitones from the key root, root
   first, close-stacked, octave carry included. `tonesRoot` stays as
   `stack[0]`.
2. **One stack rule**, `eventStack(offsets, event)` in
   `harmony/chordTheory.ts`, which `chordAt` fills `stack` with. The
   degree folds as `chordTones` folds it. With no quality the stack is
   `chordTones(offsets, degree, size)`; with one it is the quality's
   intervals on the folded root. The accidental is then added to every
   tone, so a flat on a minor diatonic chord moves the whole minor chord;
   another quality is asked for with `quality`. `eventChord` builds the
   `Chord` the names read. The Chord Player, the Arpeggiator and the Bass
   all voice `chord.stack`; none rebuilds a chord from `degree` + `size`.
   A note-on still reports the event's `degree`.
3. **The arp's change identity is the timeline's**:
   `chordIdentity(chord)` is `degree:size:quality:accidental`. A change of
   quality or accidental alone is a chord change for `retrigger`; a key or
   scale change is not, as before.
4. **The normaliser** keeps a named quality and drops anything else,
   `'other'` included, with a correction. It keeps `-1` and `1` as the
   accidental; `0` and absent normalise to absent with no report, and
   anything else is dropped with a correction. A quality sets the size (two
   intervals, a triad; three, a seventh): an absent size takes it silently,
   a written one that disagrees is corrected with a report. The output's
   field order is `start, duration, degree, size, quality?, accidental?`,
   so normalising a normalised document changes nothing and an export is
   stable.
5. **No format version.** Both fields are additive, and an event without
   them normalises, voices and labels exactly as before, so
   `ARRANGEMENT_VERSION` is unchanged
   (`2026-09-28-format-versions-refuse-never-destroy` decision 1).

## Consequences

- Every pitched performer plays a chromatic chord with no rule of its own,
  and a later performer only has to read `chord.stack`.
- The labels come right with no new spelling: `chordName` names the moved
  stack's root and quality (`D# maj`, sharps only, as before), and
  `romanNumeral` prefixes `♭` or `♯` to the numeral (`♭VI`, `♯iv°`).
- The key is still one scale sampler per song. A scale per event is a later
  ticket; a quality covers the chords the pieces above needed.
- An older build reading a document with these fields drops them as
  unknown keys and plays the diatonic chord, with a correction for each.
