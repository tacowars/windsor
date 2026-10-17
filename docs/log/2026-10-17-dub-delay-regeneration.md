# The Dub delay's loop, rebuilt around regeneration

tacowars asked for the Dub delay (`kind: delay`, record
`2026-09-25-698-stereo-dub-delay`) to be rebuilt around one behaviour: as
Feedback is pushed toward the top, the repeats should regenerate into a
sustained, self-oscillating loop that keeps darkening and roughening, the
way classic dub echoes run away, rather than either dying out or blowing up.
The design comes from a study of how that behaviour is produced, done
outside this repository. Nothing was carried over from that study: no
code, no constants, no curves. Every range, curve, default and algorithm
here is Windsor's own.

1. **One loop, everything inside it.** Each line's repeat passes, in order:
   the read (interpolated, Wow-modulated), the loop filter, the saturation
   and its governor, a low cut, and a damping shelf, then × Feedback with
   Cross, then + the new input, then the write. Nothing is applied once on
   the way out, so every repeat is filtered, saturated and damped again,
   and the colour compounds.
2. **Feedback stops at unity** (it ran to 1.2 before). Growth past unity
   comes only from the filter's resonance or from Sustain, and the governor
   (3) bounds it.
3. **A level governor in the saturation, always on.** Two mean-square
   followers (`detectSeconds`), one before the shape and one after, set a
   smoothed gain (`gainSeconds`) that brings the output's RMS to the
   input's, or to `ceiling` if the input is louder. So:
   - Drive adds harmonics, not level: Drive 0 to 30 dB holds the wet level
     within 0.1 dB in both characters (`delayDsp.test.ts`).
   - A loop lifted past unity, by a resonant filter at high Feedback or by
     Sustain, grows to the ceiling and **holds there** as a steady
     self-oscillation that keeps passing the filter and the damping. It
     holds within 1.5 dB over four further seconds at 44.1, 48 and
     96 kHz.
   - It runs at Drive 0 as well, so no setting lets the loop grow without
     bound. The governor's output RMS never exceeds its input's, so it adds
     no loop gain on average, which the sleep (8) relies on.
   - Its lift is capped at `maxGain` × Drive's gain, enough to bring back a
     shape Drive scaled down, and a fold that thinned its input.
4. **The loop filter** is a zero-delay-feedback state-variable filter (the
   trapezoidal-integrator form from the published TPT literature), written
   for the delay rather than shared with `fm/svf.ts`. That one calls
   `Math.tan` and returns its sample. This one tunes through the portable
   tangent and powers, so the golden holds on arm64 and x64, and passes its
   sample through fields. Four shapes from one state:
   - lowpass and highpass;
   - bandpass;
   - peak (a bell added to the input).

   **Resonance is each shape's gain at its cutoff**, −12 to +20 dB. On
   lowpass and highpass it is also the Q, floored at `minimumQ`. On
   bandpass and peak, Width (octaves) sets the Q. Coefficients are retuned
   every `filterInterval` samples, with the motion's Sweep added to the
   cutoff in octaves.
5. **Two characters.** Each is scaled by Drive going in and divided by it
   coming out, so a quiet signal passes at unity whatever the Drive.
   - **Warm** is the algebraic sigmoid z / √(1 + z²), leaned by `warmBias`
     so one half of the wave bends sooner (even harmonics). The low cut
     after it removes the offset the lean leaves.
   - **Fold** is a triangle fold, its corners rounded by the same sigmoid.

   A character change, like a filter-shape change, crossfades the old
   shape's output to the new one's over the switch fade, from the one
   state.
6. **Cross** replaces the old ping-pong feedback. It splits each line's
   feedback between itself and the other, so 0 keeps the lines apart and 1
   alternates every repeat. Its matrix adds no gain. The `ping-pong` mode
   now only routes the input (both channels into the first line), so
   ping-pong with Cross 1 is the old ping-pong.
7. **Sustain**, a switch with an automation lane, moves the loop's gain to
   exactly unity and the input's to zero over `sustainSeconds`. The lines
   hold what they carry while it keeps passing the loop, and the dry signal
   stays, so you can play over a held loop. It is user-owned like Mix: a
   starting point leaves it as it is.
8. **Motion.** One LFO with four shapes: sine, triangle, random (held) and
   drift (glided random). Its right side runs `stereoPhase` ahead of its
   left. Wow moves both lines' times by up to `wowSpan` each way, and Sweep
   moves the cutoff by octaves. The output passes a smoother, so a held step
   or a shape change moves the time smoothly. It is seeded (mulberry32,
   `DELAY_DSP.seed`), so a render is deterministic.
9. **Sleep.** The plate's pattern is kept, with a new `held` condition:
   - Held when Sustain is on or moving.
   - Held when Feedback times the filter's largest gain at the current or
     target Resonance reaches unity. That gain is the low-pass peak
     Q / √(1 − 1/4Q²), which bounds the bell's and the band's.
   - Held lines never sleep. A Sustain pressed on empty lines has nothing
     to hold and sleeps.
   - Asleep, `rest` steps the controls, the motion and the filter's tuning
     as `tick` does.
10. **The song format goes to 18.** `highpass` and `lowpass` are gone and
    Feedback's top moved, so old delays would load wrong.
    `SONG_MIGRATIONS[17]` (`song/delayUpgrade.ts`) translates every delay
    in a version-17 song, on every chain and in a host's slot:
    - `highpass` becomes `lowCut`, and `lowpass` a flat lowpass `cutoff`,
      each clamped into its new range;
    - Feedback is clamped to unity;
    - ping-pong gets Cross 1, and every other mode Cross 0;
    - Damping, Wow and Sweep start at 0.

    The result is close, not identical, since the saturation's curve is
    new. A lane on the old `highpass` or `lowpass` is dropped by the lane
    normaliser. The traversal the bloom upgrade used became `everyInsert`,
    shared by both upgrades.
11. **Six starting points**: Tape echo, Roots dub, Runaway, Bucket brigade,
    Telephone and Sub engine, each aimed at one kind of regeneration. They
    are original settings, not anyone's factory presets, and are
    unauditioned until tacowars listens.
12. **Cost and portability.** The render allocates nothing
    (`delayAllocation.test.ts`, every new control in its scenario). The DSP
    calls no transcendental `Math` function, and a golden pins 15
    scenarios (`delayGolden.test.ts`).

Not done: four separate early taps in front of the lines; per-line
Feedback; a tempo-synced motion rate; a stereo spread control on the
motion.
