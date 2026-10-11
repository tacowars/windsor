# Bloom follows the song: one pitch set, Windsor's lists

- **Date:** 2026-10-11
- **Status:** accepted (tacowars's direction and the design agreed the same
  day for all three tickets)
- **Links:** windsor#728 (the seam: the pitch set and the lists) ·
  windsor#717 (Scale follows the song's key) · windsor#729 (Scale follows
  the harmony track's chords) · the Bloom record `2026-10-11-bloom-insert`,
  whose Key and Scale rows this supersedes in part · windsor#721 and
  windsor#722 (the ten scales) · the format record
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

Bloom shipped with its own Key and Scale lists: twelve note names and seven
scales, with each scale's intervals in the generator's constants and a
per-scale correction table built inside the worklet. The processor took Key
and Scale as list indices.

So Bloom drifted from the rest of Windsor at once. The ten scales
windsor#721 added to `SCALES` (windsor#722) never reached it, its scale
names were spelt differently from the transport's (`minor`,
`pentatonic-major`), and it couldn't follow the song's key or its chords,
which is the use tacowars wants: noisy or atonal sound through Bloom, tones
in the song's key or on its chord.

## Decisions

1. **The processor takes a pitch set, not a key and a scale.** One k-rate
   `pitches` param, 0..4095, replaces `key` and `scale`: a 12-bit mask, bit p
   set when pitch class p (C = 0) is allowed. The default, 4095, is every
   class, which is chromatic; an empty set (0) reads as every class. Key and
   Scale were never automation rows, so no lane changes.
2. **The main thread works out the set.** `pitchMask(root, offsets)`
   (`inserts/bloomPitches.ts`, exported from the engine index) folds a
   scale's offsets mod 12 above a root. `bloomValues` writes
   `pitchMask(<the key's pitch class>, scaleOffsets(scale))`, and
   `chromatic` writes 4095. The spec keeps `key` and `scale`.
3. **The worklet works out the corrections from the set.** Per pitch class,
   the semitones to the nearest class in the set, round the circle, ties
   down: the rule Bloom's table used. They're written into a preallocated
   12-entry array at a retune, through the generator's existing fade, so a
   change still dips over 5 ms and allocates nothing.
4. **The pitch tables cover any set.** A set of one class moves the class
   opposite it by 6 semitones (down, on the tie), so the generator's reach
   is fixed at 6 (`BLOOM_GENERATOR.pitchReach`) instead of being derived
   from the shipped table (1). Every table entry is computed per note, so
   the wider margin changes no value a shipped scale reads. Every key and
   scale Bloom had gives the same corrections as before, and the goldens
   (`bloomGolden`) are unchanged.
5. **Bloom keeps no list of its own.** Scale picks from `chromatic`
   (Bloom's off, which Windsor has no scale for) and then `SCALE_NAMES`;
   Key picks from `CHORD_NOTE_NAMES`, the twelve sharps the transport's Key
   shows. A scale added to `SCALES` reaches Bloom with no Bloom or worklet
   edit. The card's pickers show the transport's names and groups, lower
   case (`SCALE_OPTION_GROUPS`, `KEY_OPTIONS`), with `chromatic` first and on
   its own.
6. **A rename, so the song format bumps to 10.** Bloom's `minor`,
   `pentatonic-major` and `pentatonic-minor` became `naturalMinor`,
   `pentatonicMajor` and `pentatonicMinor`. The 9 → 10 upgrade renames them
   on every bloom in a song: each part's strip, each group's chain, the
   master's, each return's, and a host's `slot` child. The pitch classes are
   the same, so an upgraded song sounds as it did. Key's spelling didn't
   change.

The two follow-ups were agreed with this design and build on its set:

7. **Scale gains `song key` (windsor#717).** It takes the root and scale
   from the song's harmony, a custom scale included, through
   `pitchMask(harmony.root, scaleOffsets(harmony.scale))`, and retunes when
   the song's key is edited. Key is disabled and shows the song's key; the
   bloom's own `key` stays underneath. The value is resolved in the stage,
   never written into the spec, and is additive to the format.
8. **Scale gains `song chord` (windsor#729).** The set is the pitch classes
   of the chord the harmony track is on, from the same stack the harmony
   timeline builds, scheduled on the transport like a lane, one fade early
   so the retune lands on the chord's boundary. A song with no chords falls
   back to the song key's set. When stopped, Song chord holds the chord
   under the playhead, and a seek or a live edit while stopped re-holds it.
   Also additive to the format.

## Consequences

- The worklet holds no scale table, so neither follow-up touches DSP: each
  only works out a different set on the main thread.
- A song saved at version 9 with a bloom on one of the renamed scales loads
  through the upgrade; a song saved at version 10 is refused by an older
  build, as every format bump is.
- Bloom's Scale list is now 18 entries long, grouped as the transport's.
