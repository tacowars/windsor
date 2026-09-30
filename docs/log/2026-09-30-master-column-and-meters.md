# The Mixer tab's master column and meters

- **Date:** 2026-09-30
- **Status:** accepted (tacowars, 2026-09-30)
- **Links:** mockup `docs/research/2026-09-30-master-output/mockup.html` ·
  the insert rack's record `2026-09-30-insert-rack-and-send-bus-chains` ·
  the output stage's issue windsor#94

## Context

The insert rack and the send buses gave every chain one look, but the
master's tail kept the old one. The Mixer tab showed the send buses, then
the master's inserts, a Level knob reading a linear 2.00, a pair of
`<meter>` bars with a Reset peaks button, and the Output section. That
section had its own four `<meter>` bars (In L, In R, Out L, Out R), a GR
bar and a clip light. Nothing stayed on screen once the page scrolled.

Two meter sets read almost the same signal. The master's L/R meter taps
the master strip's output (`masterStrip.meter`, its own peak-meter
worklet). The output stage's In L/R read the same signal after the Music
fader, from the stage's report.

Every meter rode the shared frame loop through `watchPlayhead`. That loop
keeps scheduling a frame while the tab is hidden and checks
`closest('[hidden]')` on each one, and every `<meter>` value change costs a
style and layout pass.

tacowars compared three page orders in the mockup (master first, a side
column, sends first), segmented and smooth meters, and a bridge that
shows while the meters are scrolled away.

## Decision

1. **The Mixer tab has two columns.** The left column scrolls: the
   master's insert rack, then Send A and Send B. The right column is the
   master column, about 260 px wide and sticky at the top of the tab.
   Below about 760 px the master column stacks above the racks and stops
   being sticky.
2. **The master column holds everything after the master inserts**, from
   top to bottom:
   - a header, "Master out", with the stage lamp;
   - the meters: the Level fader, In L and R, one dBFS scale shared by In
     and Out, Out L and R, and the GR bar;
   - the mode as a two-by-two segmented control (Limiter, Soft clip, Hard
     clip, Off) and the Lookahead toggle;
   - the transfer curve and the Ceiling knob.
3. **One set of meters, from the output stage's report.** In reads the
   stage's input and Out reads its output. The Mixer no longer uses
   `masterStrip.meter`, so the tab runs one less worklet while it is open.
   The meters now include the Music fader and show what reaches the stage.
4. **The meters are segmented vertical bars.** The mockup's spec table
   gives the sizes:
   - a 10 px bar in a channel 28 to 32 px wide;
   - the `PEAK_METER` range of −60 to +6 dBFS, with the height following
     ((dB + 60) / 66)^1.6;
   - colour zones: teal below −12 dBFS, amber from −12 to 0, red above 0;
   - a one-second peak-hold line, and a fall of 24 dB/s.

   The Out bars draw the ceiling as a line. The GR bar reads 0 to 12 dB
   from the top. In the clip modes it becomes Over, and in Off it dims.
5. **Readouts and LEDs reset themselves.** Each bar has its held-peak
   readout above it, and clicking the readout resets it. The In bars have
   a clip LED that latches on a sample above 0 dBFS before the stage.
   Clicking the LED clears it. The Reset peaks button goes. The In LEDs
   listen to every report, as the stage's watch does
   (`outputStageWatch.ts`), so a hidden tab never misses one.
6. **The stage lamp keeps windsor#94's latch rules** and names what it
   latched on: Limiting, Clipping, or Over 0 dB in Off. The name belongs to
   the report that latched it: a mode change before the lamp is cleared
   keeps the name, since a report and a mode change may cross
   (`outputStageWatch.test.ts`). Unlatched, it names the current mode's
   action. Clicking the lamp clears it.
7. **The Level control is a vertical fader reading dB.** Its dB steps
   follow the meter scale. The song still stores the linear
   `master.level` from 0 to 2, so the format doesn't change.
8. **The transfer curve** is a 96 px square showing −24 to +6 dB on both
   axes. It draws the mode's curve and the ceiling. It is redrawn only on a
   mode or ceiling edit, and a dot at the louder input peak is the only
   part that moves. The curve is the engine's, never an approximation:
   - Soft clip is the identity up to `OUTPUT_SOFT_CLIP.kneeDb` below the
     ceiling, then the clipper's rational curve (`outputStageClipper.ts`).
     The engine exports that static curve so the plot and the DSP share it.
   - Hard clip is the identity up to the ceiling, then flat.
   - Limiter draws its settled peak level, the identity up to the ceiling
     and then flat. Its gain moves in time, and the final clamp is at the
     ceiling.
   - Off is the identity.
9. **A meter bridge** sticks to the top of the tab while the master
   column's meters are out of view. That happens only below the stacking
   width. It shows Out L and R as thin bars with the ceiling mark, GR or
   Over, the mode and ceiling, and the stage lamp.
10. **The meters cost nothing while nobody sees them.**
    - Their loop starts when the Mixer tab is shown and stops when it is
      hidden. It also stops on `visibilitychange` to hidden, and when an
      IntersectionObserver reports the meters off screen. Stopping means
      the loop schedules no frame, rather than scheduling frames that do
      nothing.
    - The meters paint only when a new stage report lands (30 Hz), whatever
      the display's refresh rate.
    - Each bar is a fixed gradient under a cover moved with `transform`,
      stepping at the report rate with no transition (see the amendment).
      Drawing needs no layout, and `<meter>` is no longer used here.
    - A readout's text changes only when its value changes at the shown
      precision.
    - The top-bar output light stays the always-on indicator, unchanged.
    - The stage's 30 Hz report keeps running for the light and the
      latches.
11. **The claim is measured.** The implementing work records the Mixer
    tab's main-thread cost before and after, with the tab shown and
    hidden, under `docs/research/` (invariant 5).

## Consequences

- The Mixer tab's `masterMeter.ts` and the Output section's `<meter>` rows
  are replaced. `masterStrip.meter` has no user in the app. Removing it
  from the engine is a separate engine change.
- The meter part (bar, scale and readout) is written once and used by the
  column and the bridge. A part's strip on the Song tab could use it
  later.
- No format change: no field is added, renamed or re-scaled.
- The work is UI and interaction, so its PRs are `reviewed`.

## Amendment, 2026-09-30

Decision 10 first gave the bars a short transition between reports (34 ms,
as in the mockup). windsor#194 measured it: showing the Mixer cost about
33 ms of main-thread time a second, against 17 before the change, because a
transition restarted at every report keeps an animation running all the
time. Without it, the cost was about 9.5 ms a second
(`docs/research/2026-09-30-master-output/after.md`). tacowars chose the
cheaper build: the bars step at the report rate with no transition, since
the difference is barely visible. The mockup keeps its transition as a
drawing reference only.
