# A held Chord Player hit can follow the harmony

- **Date:** 2026-10-02
- **Status:** accepted (the decisions of windsor#333)
- **Links:** windsor#333 · refines `2026-09-26-harmony-v2-document-v3-timeline-and-regions`
  decision 7 and `2026-09-17-606-chord-sequencer-degrees-per-part-voicing`
  decision 13 · the chord's stack from windsor#330
  (`2026-10-02-harmony-events-quality-and-accidental`) · the console's
  switch per `2026-10-01-sequencer-rack-devices` decision 7 and the mockup
  `docs/research/2026-09-30-sequencer-rack/chord.html`

## Context

A Chord Player hit voices the chord the harmony timeline holds at its onset
and keeps those notes to its own end: "a chord change never cuts a sounding
hit" (#705). The rule is right for a stab or a comp, and it is what every
song and test written so far expects, so it stays the default. But a
sustained organ or string part has to be written as one hit per harmony
change, and then it re-attacks at every change. Glass's organ progressions
and Reich's held clarinet and voice chords depend on the other behaviour:
the tones the new chord shares stay held, and only the voices that must
move step to the nearest new chord tone, as an organist's or a section's
do.

## Decision

1. **`follow`, per part, off by default.** `ChordSequencerConfig` carries
   `follow: boolean`, `false` in `DEFAULT_CHORD_CONFIG`. With it off,
   nothing changes. The normaliser reads it as a boolean: absent is `false`
   with no report, junk is `false` with a report. It is additive and its
   default reproduces the old behaviour, so `ARRANGEMENT_VERSION` is
   unchanged.
2. **What counts as a chord change.** On every tick where the part holds
   notes and no segment starts, a following part compares the chord the
   gate hands it with the chord the held notes were voiced from. The held
   chord is stored at the onset, and again after each re-voicing, as a
   string: the key root's pitch class and `chord.stack`. It is never the
   `HarmonyChord` object, because the gate builds a fresh one every tick.
   - The shipped `stack` (windsor#330) is semitones above the key root, and
     `chordIdentity` leaves out the key. The stack alone therefore can't
     tell a root change, and the identity alone can't tell a scale change
     or ignore a quality edit that keeps the stack. The stored string is
     the root and the stack. A change of degree, size, quality, accidental,
     key root or scale that changes the sounding tones is a change. The same
     chord restated by two adjacent events, or a quality edit that leaves
     the stack as it was, emits nothing.
   - A tick with no chord (`event.chord === null`) emits nothing, and the
     notes stay held.
3. **The re-voicing rule** is `followVoices(held, stack, keyRootNote)` in
   `harmony/voiceLeading.ts`. It is pure and ignores the part's voicing and
   the step's inversion:
   - The target pitch classes are the stack's tones mod 12, shifted by the
     key root (`sampler.rootNote(0) % 12`).
   - Every held note whose pitch class is a target stays as it is (a common
     tone).
   - The other held notes, lowest first, each move to the nearest MIDI note
     (within ±6 semitones) whose pitch class is a target, that lies inside
     the MIDI range 0–127 (the range `chordVoicing.ts` clips to), and that
     no voice has taken yet; on a tie between up and down, down wins. If no
     free in-range target lies within ±6, the voice keeps its note, so a
     follow at an extreme register never leaves the MIDI range.
   - The voice count is the hit's: a chord with more tones than voices
     leaves tones unsounded, and one with fewer lets two voices share a
     pitch class on different octaves. A follow adds no note and drops none.
   - The result is the moved notes in the held notes' order, so the
     sequencer knows which voice moved where.
4. **What a follow tick emits:** a `noteOff` for each voice that moved (its
   old pitch), then a `noteOn` for each new pitch with the chord's degree,
   no accent and no slide, all on that tick. A common tone gets no event.
   The held set becomes the moved notes, and the release tick is unchanged.
   So a gate below 1 still releases on its own tick, and a region end or a
   stop releases what is held now, not what the onset played.
5. **An onset is unchanged.** It releases what is held, offs before ons,
   and voices the new hit with `voiceHit`. Follow acts only between onsets.
6. **Live edits.** Turning `follow` on or off through `reconfigure` never
   emits anything by itself. Turned on mid-hold, the next tick adopts the
   sounding chord as the held one, so the voices first move at the next
   chord change. A key or scale change while following is a chord change,
   and the voices move on the tick the new sampler arrives. With follow off,
   it reaches only the next onset, as before.
7. **The console** has one control: a Follow off/on switch, the third field
   of the Chord device's first column under Base step and Voicing, built as
   the Arp's Retrigger is.

## Consequences

- By ear, a following part differs from one hit per change only at the
  attack. The common tones don't re-attack, and the moving voices start on
  the change tick as fresh notes on the part's envelope.
- The arpeggiator and Basslead are unaffected. They voice the chord on their
  own onsets, and `followVoices` is the Chord Player's alone.
- `followVoices` is not on the engine's index. Nothing outside the engine
  needs it yet.
