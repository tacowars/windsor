# Song automation lanes: absolute curves on each part, played from the one clock

- **Date:** 2026-10-01
- **Status:** accepted; the epic windsor#339 builds it.

## Context

tacowars asked for automation lanes in the Song tab, in the style of Ableton's
arrangement view. A part folds out rows of curves beneath it, and those curves
move its mixer knobs, its insert parameters and a curated set of FM voice
parameters over song time. Drawn lines, bendable curves and stamped shapes
give sound movement. A square on the volume gives trance-style chops. The
design was agreed with tacowars on 2026-10-01.

What the engine had:

- **One clock.** The `Scheduler` (`sequencing/scheduler.ts`) issues swung
  ticks with an AudioContext `time`, 120 ms ahead. Offline render replays
  the same scheduler (`render/renderPass.ts`).
- **No parameter scheduling anywhere.** Every live edit is a `.value =`
  write. The only ramps are the mute, solo and rebuild gates, and they call
  `cancelScheduledValues` on their own nodes.
- **Strip targets reach audio three ways:**
  - The fader is the FM worklet's k-rate `gain`, unsmoothed.
  - Pan is four native gains.
  - The sends are native gains.
- **Insert targets reach audio two ways:**
  - The worklet inserts have k-rate parameters, mostly with smoothing.
  - The native inserts have native AudioParams.
- **FM patch fields travel only as a whole-patch message.** A ringing voice
  keeps its old patch during song playback.
- **The exception is the `cutoffMod` AudioParam.** It is already live on
  ringing voices.
- **Step-mod lanes** (`worklet/fm/stepModTables.ts`) already list the FM
  targets a grid step can push.

## Decision

1. **Lanes are song-absolute.** A point's position is a song tick. Moving or
   resizing a region leaves the automation where it is, as in Ableton's track
   automation. Clip envelopes that travel with a region are not part of this.
2. **Lanes belong to a part.** They are stored in `DocumentPart.automation`.
   Version 1 has no lanes on returns, groups or the master. A part's lanes can
   target:
   - **its strip:** level, pan, send A and send B;
   - **its inserts:** each continuous field, keyed by the stable insert id.
     Stepped and enum fields (kind, model, tempo-synced divisions) are not
     targets;
   - **its FM voice**, 29 targets:
     - from the step-mod table, the filter's cutoff, envelope amount,
       resonance and envelope decay, and each operator's level, envelope
       decay, decay curve, feedback and width;
     - added for automation, LFO 1 and LFO 2 amount, LFO 1 and LFO 2 rate,
       and the pitch-envelope amount.
3. **At most 8 FM lanes per part.** Strip and insert lanes have no cap.
4. **Values are absolute, in the target's own units.** A new lane starts as
   a flat line at the parameter's current value. Before its first point a lane
   holds that point's value, and after its last point it holds that one.
5. **A lane is drawn in its knob's own scale.** The level lane is in dB and the
   cutoff lane is in octaves. A straight line is therefore already an even
   fade. Each point carries a `bend` in -1..1 for the segment after it.
6. **An automated knob is locked, with a lit ring.** Its arc and pointer take
   the lane's colour and an AUTO tag sits under its value. It follows the lane
   during playback, and a press on it says the lane must be switched off.
   Turning the lane off, or deleting it, unlocks the knob. There is no record
   mode and no touch-override in version 1. tacowars chose the lit ring over
   the padlock in the mockup.
7. **Automated FM parameters change ringing voices live.** That is the point
   for pads.
8. **Playback is scheduled from the main thread, on the one clock.** An
   automation player subscribes to the transport.
   - It writes AudioParam events at each tick's `time`. Bent segments are cut
     into short linear ramps at tick resolution.
   - On seek, stop, a loop jump, or a lane edit during playback, it cancels
     everything ahead and reschedules.
   - Offline render gets the same events, because it pumps the same clock.
   - The worklets never learn song time.
9. **AudioParams only, never patch messages.** Each target gets its own
   AudioParam, separate from the mute/solo/rebuild gates, so a gate's
   `cancelScheduledValues` never erases automation.
10. **The document stores absolute values, and the FM worklet receives
    offsets.** The main thread schedules the difference from the patch value:
    an octave ratio on `cutoffMod` for the cutoff, and new k-rate parameters
    for the other targets.
    - An offset of 0 must leave the worklet bit-identical. The goldens and the
      drum transients do not move.
    - Step-mod offsets stack on top of the automated value.
    - When the patch is edited while a lane exists, the main thread
      recomputes the offset, so the lane's value still wins.
11. **The FM worklet smooths what would zipper.** The `gain` (fader) and the
    operator feedback are interpolated across a block or a control block. When
    the value is static the result is exact (`a + (b − a)·t` with `a = b`), so
    the goldens still hold.
12. **Shapes stamp points.**
    - Shapes: triangle, square with a duty, saw up, saw down, sine, ramp and
      S-curve. No random and no sample-and-hold.
    - Settings: rate in note values on the song grid, a top and a bottom
      value, and a phase.
    - The stamp writes ordinary points that can be edited afterwards.
      Nothing new runs live.
    - Vertical edges, such as a square's, get a de-click ramp of a few
      milliseconds. The ramp length lives in a constants table.
13. **The Song tab works as the mockup showed.** The mockup is
    `docs/design/automation-lanes-mockup.html`, which runs in a browser with
    no build:
    - The part's `▸` folds its lanes out beneath it. Each lane row holds:
      - the parameter's name and its kind, with a colour chip: teal for the
        mixer, violet for the inserts, amber for the voice;
      - the live value, an on/off button and a delete button, in the mixer
        column;
      - the curve over ghosted regions.
    - A "+ Add lane" row picks the target and shows the count of voice
      lanes against 8.
    - Lanes are one fixed height (56 px).
    - There are three tools:
      - **Edit:** click to add a point, drag a point to move it, drag the
        line to bend it (it snaps straight near the middle), double-click a
        point to delete it, Alt-click a line to straighten it. Shift ignores
        snap.
      - **Draw:** freehand on the snap grid.
      - **Shape:** drag a range.
    - The shape panel is a popover beside the selected range, with a dashed
      preview, and Apply or Cancel. tacowars chose it over a docked pane.
14. **Deleting an insert deletes the lanes on it.** Undo brings both back.
    Swapping a part's preset keeps its FM lanes, clamped to each target's
    range.
15. **The format is additive.** Without `automation`, a song plays exactly as
    before, so neither `ARRANGEMENT_VERSION` nor `PATCH_FILE_FORMAT` changes.
    When `bars` changes, the lanes are fitted with the regions and harmony.
16. **Feeding the FM worklet waits on a measurement.** It is either one k-rate
    parameter per target (29 per node) or 8 slots per part, each mapped to a
    target. The ticket measures the cost of idle k-rate parameters across 16
    parts first and records the result in `docs/research/`. The 8-lane cap
    (decision 3) holds either way.

## Consequences

- **The insert registry gains a parameter descriptor:** id, range, taper and
  unit. It also gains a `stage.param(field)` handle, and a rebuild re-attaches
  automation. The FM targets join the same catalog, which the engine owns.
  The app adds the labels.
- **The decay times and the decay curve reshape a segment that is already
  sounding.** Automating them live is a separate ticket, approved by ear on
  held pads.
- **The Song view's `▸` becomes the fold control.** Lanes are drawn as SVG
  through the existing tick-to-pixel mapping. A lane gesture previews while
  dragging and commits once on release, giving one undo step.
