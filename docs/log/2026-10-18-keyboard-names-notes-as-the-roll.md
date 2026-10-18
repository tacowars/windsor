# The keyboard names its notes as the Roll does: note 60 is C4

- **Date:** 2026-10-18
- **Status:** accepted (tacowars asked for one naming on 2026-10-18).
- **Links:** this record's issue, windsor#931 · the keyboard fold
  `2026-10-18-keyboard-fold` · the keyboard on a tablet
  `2026-10-17-the-keyboard-on-a-tablet`
- **Supersedes:** the naming note in `2026-10-18-keyboard-fold` ("Note
  names follow the keyboard's octave label…") and the "one octave naming"
  item under Later in `2026-10-17-the-keyboard-on-a-tablet` decision 11,
  without editing either.

## Context

The audition keyboard named note 48 "C4": its octave label, the expanded
view's C names and the fold's labels all printed the keyboard's octave
number as it stood. The Roll's key column (`noteName` in
`consoleFormat.ts`), the sequencers' Octave knobs (the engine's
`rootNote`, where octave 3 is note 48) and the spectrum bench's axis call
note 60 C4, so note 48 is C3 there. The same pitch read A4 on the keyboard
and A3 on the Roll.

## Decision

1. **One naming: note 60 is C4**, the one the Roll, the Octave knobs and
   the bench already use. Only the keyboard's labels change. The keyboard's
   octave state, its bounds, its default and every note it plays stay as
   they were, so the default label now reads `C3` where it read `C4`, and
   its first key still plays note 48.
2. **Every keyboard label goes through `noteName`.** The octave label (the
   Parts row and the expanded bar) and the expanded view's C names come
   from `octaveLabel` (`keyboardKeys.ts`), the C at the keyboard's octave;
   the fold's label and a folded root's octave mark name their own note
   with `noteName`. No label adds or subtracts an octave of its own.
3. **Labels only.** No format change and no version bump.

## Reading the older records

Examples in the accepted records keep their old numbers. Read a keyboard
note name there one octave lower: the keyboard's old `A3` (note 45) is the
new `A2`, its old `C4` (note 48) the new `C3`. The note numbers in those
records are unchanged.
