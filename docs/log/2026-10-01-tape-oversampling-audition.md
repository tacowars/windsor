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
  reads: "2× is lighter on CPU; 4× is cleaner on bright, hard-driven
  sounds." (It first read as an audition-only hint, until tacowars kept
  both factors; see below.)
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
5. Keep in mind the cost, with a caveat: the only browser numbers so far
   are for the research candidates, not the shipped Tape path. On the
   recorded M1 in Chrome 154 they put the 2× candidate under the 1.33 ms
   four-instance mean target and the 4× candidate above it
   ([browser cost](../research/2026-09-30-tape-browser-cost/README.md)).
   The shipped bundle adds the retained EQ, transport, hiss and dropouts
   and the kernel-derivative filter, and is measured separately by
   windsor#250; until that lands, treat the ratio between 2× and 4× as
   the meaningful part, not the absolute fit to the budget.

The result of the audition, and the PR that deletes the losing factor and
the picker with its `ARRANGEMENT_VERSION` bump (design decision 1), come
later.

## Outcome (2026-10-01)

tacowars auditioned 2× and 4× on the PR #251 preview and approved the
PR, then asked "can't we keep 2× and 4×?" Both stay. `oversampling` is a
per-insert product setting, 2× by default, and no factor or control is
removed, so the further `ARRANGEMENT_VERSION` bump that the
[integration design](2026-09-30-tape-magnetic-integration-design.md)'s
decision 1 scheduled for the removal does not happen. The product
reason is the measured tradeoff recorded by the
[shipped probe](../research/2026-10-01-tape-shipped-probe/README.md):
on the recorded M1 the shipped 2× path keeps four instances inside the
four-track budget and the 4× path does not, while 4× is cleaner on
bright, hard-driven material and barely resets under the clipped-noise
stress that resets 2×. Choosing per track is the point. The tooltip now
says only that.
