# The Tape oversampling audition switch and the true Drive readout

- **Date:** 2026-10-01
- **Issue:** [windsor#246](https://github.com/tacowars/windsor/issues/246),
  milestone E, step 3 of [epic #146](https://github.com/tacowars/windsor/issues/146)
- **Follows:** [the integration design](2026-09-30-tape-magnetic-integration-design.md)
  (decisions 1 and 3), [the integration](2026-09-30-tape-magnetic-integration.md)

## What changed

- **Oversampling select.** The Tape card's Tape page has an
  **Oversampling** picker, 2× or 4×, directly after Tape type. It writes
  the song's `oversampling` field through the same commit as Tape type, and
  the running insert switches cores without a reload. The newly selected
  core starts from zero state, so a click at the moment of switching is
  expected and is not a fault. The default is 2×. The picker's tooltip
  reads: "Audition only: 2× costs less CPU; 4× is cleaner on bright,
  hard-driven sounds. One of these will be removed after
  the audition."
- **Drive readout.** The Drive knob keeps its stored range (−32 … +32) and
  its position, but its readout is now the gain the magnetic core receives,
  `driveGain(Drive)`, in signed dB to one decimal: `-12.0 dB` at the
  bottom, `0.0 dB` at the centre, `+12.0 dB` at the top. No other knob
  changes.
- **Randomize and starting points** leave `oversampling` alone. Randomize
  still rolls Drive, and each starting point still sets its own Drive; none
  carries an oversampling factor, so a song keeps the factor it was set to.

Nothing in the song format changes: `oversampling` has been a song field
since the integration, and this only gives it a control.

## How to A/B

1. Open one song with Tape on the tracks you want to judge, and leave
   every Tape setting where it is. Only the Oversampling picker moves.
2. Play it and switch between 2× and 4× on the same passage, at the same
   Drive, on at least: a bass line, a chord part, hats, and something with
   sharp transients (a kick or a plucked sound).
3. Push Drive towards `+12.0 dB` on the bright, hard-driven material
   (hats, bright chords) and listen for aliasing: inharmonic, metallic or
   whistling tones that do not follow the pitch. That is where 4× should
   be cleaner, if anywhere.
4. Ignore the click at the moment of switching; judge the steady sound on
   either side of it.
5. Keep in mind the cost: on the recorded M1 in Chrome 154, only 2× keeps
   four Tape instances under the 1.33 ms mean target; 4× measured
   1.48–1.69 ms, above the four-track budget
   (the [integration design](2026-09-30-tape-magnetic-integration-design.md)'s
   context).

The result of the audition, and the PR that deletes the losing factor and
the picker with its `ARRANGEMENT_VERSION` bump (design decision 1), come
later.
