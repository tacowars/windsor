# The Tape's Wow and Flutter dials run on a square law

- **Date:** 2026-10-16
- **Status:** proposed (windsor#818, awaiting tacowars's listen)
- **Links:** windsor#818 · the measurement
  `docs/research/2026-10-16-tape-motion-range/` · the Tape record
  `2026-09-30-reels-inspired-tape-insert` · the format record
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

A Tape dial's percentage was the motion amount itself: Wow, Flutter and the
Wear macro wrote `value / 100` into `TapeMotion`, whose delay swings that
fraction of `TAPE_DSP.maxDelaySeconds` (25 ms). That is far too strong. Read
off the motion's delay path at 48 kHz over 120 s, Wear 30 swung the pitch
from about −90 to +112 cents (p1 to p99), and the split Wow 5, Flutter 10
that tacowars settled on by ear for a 30-minute drone swung −29 to +38. A
good tape machine's speed error is better than 0.02 % WRMS, under a cent,
and a cheap cassette's approaches 0.5 %, about 9 cents (Rumsey and
McCormick, *Sound and Recording: An Introduction*, 5th edition, Focal
Press, 2006, Appendix 1). All the useful motion sat in the bottom 10–15 %
of the dials, and the top swung several semitones.

## Decision

1. **One curve for Wow and Flutter.** A dial value `d` from 0 to 100 drives
   the motion amount `motionMax · (d / 100) ^ motionPower`, with
   `motionMax: 0.3` and `motionPower: 2` in `TAPE_DSP`. Today's 30 % is the
   new dial's top, 3 % sits at about 32 and 5 % at about 41, and a real
   deck's drift lands in the lower half. The mapping is one pure function,
   `tapeMotionAmount` in `inserts/tapeMotionCurve.ts`, which the tape
   bundle builds from. `tapeDsp.ts` applies it to Wow and Flutter while
   split and to Wear's wow and flutter while unsplit, worked out again only
   when a dial's smoothed value moves.
2. **Dropouts keep their linear scale.** Dropouts aren't pitch, and 30
   sounded right. The Dropouts dial, and Wear's dropout amount while
   unsplit, still drive `value / 100`. Unsplit, Wow and Flutter take the
   same amount, so `TapeMotion`'s equal-amounts arithmetic and its seeded
   stream stay as they are, and `TapeMotion` itself is unchanged.
3. **A format bump with a pass-through upgrade.** The stored `wow`,
   `flutter` and `wear` change meaning, so `ARRANGEMENT_VERSION` goes from
   15 to 16, and `SONG_MIGRATIONS[15]` returns the document unchanged.
   Old songs load, and their stored numbers and lane points play on the
   new, gentler curve: that gentler motion is the point of the change, so
   no value or lane is rewritten. No patch carries a Tape, so
   `PATCH_FILE_FORMAT` stays. The automation rows and the card stay 0–100 %
   and `linear` over the dial value.
4. **Randomise draws gentler motion.** `TAPE_RANDOM` gets `motionMax: 70`
   and `motionPower: 1.5` for the Wow and Flutter dials, so the median draw
   is about dial 25 (a few cents) and the top is dial 70. Dropouts keep
   `wearMax: 50` and `wearPower: 2.5`, and the rate draws are unchanged.

## Consequences

- Every song with a Tape whose Wow, Flutter or Wear is above 0 sounds
  gentler when it next loads: Wear 30 now swings about −8 to +10 cents, and
  Wow 5, Flutter 10 about a cent. Moving the dials to 41 and 58 restores
  the old Wow 5, Flutter 10 within a fraction of a cent.
- A Tape with all its motion at 0 renders exactly as before, and the
  magnetic core's golden is untouched.
- The values are for tacowars's listen (`listen.mjs` beside the
  measurement): if the curve's top or its power is wrong by ear, the two
  numbers in `TAPE_DSP` are the whole change.
