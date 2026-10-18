# The Transient insert: attack and sustain shaping with no threshold

- **Date:** 2026-10-18
- **Status:** accepted. tacowars listened to the three timing rows and
  approved the PR on 2026-10-18, with `medium` to ship (decision 5)
- **Links:** windsor#897 · the compressor's sleep and meter (windsor#660,
  windsor#793) · Advanced Drive's smoothing (#701) · the switch fade
  (windsor#630) · format rules `2026-09-28-format-versions-refuse-never-destroy`
  · the sweep, the cost and the listen:
  `docs/research/2026-10-18-transient-insert/`

## Context

Windsor's music is drum-heavy, with snappy attacks mixed with pads. The
compressor changes a hit's level by its level, and the fader changes it all.
Nothing changed a hit's envelope: more click on a kick, less ring on a snare,
a shorter tail on a hat without a gate. A transient shaper does that, and the
envelope-difference design needs no threshold, so it treats a quiet hit as it
treats a loud one.

The reference values are the hardware's published manual and Paul White,
*Sound On Sound*, October 1998.

## Decisions

1. **Naming.** A new kind, `transient`, labeled **Transient**, in the
   Dynamics group after Pump. Code, comments, docs and the PR say
   "transient shaper" and "envelope difference", and name neither the
   hardware this follows, nor its maker, nor the maker's name for the
   technique (`CLAUDE.md`, Invariant 7).
2. **Controls.** A flat spec, every number a k-rate param and a linear
   automation row:

   | Field | Range | Default | Unit |
   |---|---|---|---|
   | `attack` | −15 … +15 | 0 | dB |
   | `sustain` | −24 … +24 | 0 | dB |
   | `output` | −20 … +6 | 0 | dB |
   | `mix` | 0 … 1 | 1 | |
   | `enabled` | bool | on | |

   Attack, Sustain and Output are the reference's ranges; Mix is Windsor's,
   for parallel use. There is no threshold, ratio, timing knob, sidechain or
   link control.
3. **The model is an envelope difference, level-independent.**
   - `d = max(|L|, |R|)` per sample: stereo-linked, both channels one gain.
   - **P** is the true maximum of `d` over the last `hold` (a monotonic
     queue), so a low note does not ripple it.
   - **F** follows P with an instant rise and a one-pole `fRelease`.
   - **A** follows F up with a one-pole `aAttack` and down instantly.
   - **S** follows F up instantly and down with a one-pole `sRelease`.
   - `sA = 1 − A/F` and `sS = 1 − F/S`, each 0 while its denominator is
     under the floor. They are ratios, so a hit at −40 dBFS takes the shape
     a hit at 0 dBFS takes, and a steady tone takes none.
   - `gainDb = attack·sA + sustain·sS`, as `2^(gainDb·log2(10)/20)` through
     `exp2InPlace`; `out = outputGain·(mix·gain·x + (1 − mix)·x)`.
   - Every coefficient comes from the worklet's `sampleRate`, through
     `exp2InPlace`, never `Math.exp`, `Math.pow` or `**`.
4. **No latency and no lookahead.** An Attack cut lets the first samples of
   a hit through, as the reference does.
5. **Timing is a table, chosen by ear.** `TRANSIENT_TIMINGS` in
   `inserts/transientTables.ts` holds `tight` (12, 5, 8, 200 ms), `medium`
   (20, 10, 15, 400 ms) and `loose` (25, 20, 30, 800 ms) for `hold`,
   `fRelease`, `aAttack` and `sRelease`. `medium` ships, as the named
   constant `TRANSIENT_SHIPPED_TIMING`: tacowars picked it from the listen.
   The DSP takes its row as a parameter, and `processorOptions.timing`
   overrides it for the tests and the listen only. `hold` sets the lowest
   note the detector rides without ripple, about `1/(2·hold)`, and how late
   a short hit's decay starts to count as sustain.
6. **Smoothing and the switch.** Attack, Sustain, Output and Mix go through
   a 20 ms one-pole that iterates only the slots that moved. `enabled`
   crossfades linearly over `INSERT_SWITCH_FADE_S`, so fully off is the
   input to the bit, and switching on from fully off restarts P, F, A and S
   from rest.
7. **Neutral is transparent.** At Attack 0, Sustain 0, Output 0 dB and
   Mix 1, once the smoothers have landed, the arithmetic gives the input
   sample for sample: the gain and the Output are `2^0`, exactly 1.
8. **Sleep, on the compressor's pattern.** The floor is the plate's 1e-9
   over the worst-case gain, +15 + 24 + 6 = 45 dB, derived from the bounds
   in `transientConstants.ts` (5.6e-12). The insert sleeps once a block's
   input is under it and P, F, A and S have all released under it; the
   shapes are 0 under the same floor, so an awake insert plays exactly
   `outputGain·x` over such a block, which is what the asleep one plays,
   with its smoothers and switch fade stepping each sample. The tail is
   `sRelease · ln(1/floor)`: 5.2 s at `tight`, 10.4 s at `medium`, 20.7 s at
   `loose`.
9. **The card.** Attack and Sustain in a column of two, Output beside them,
   Mix at the big dial, then a bipolar gain meter, on the compressor card's
   row. The readouts are signed dB (`+3.0 dB`) and Mix in percent. The
   meter is built as `compressorMeter.ts` is, with a center line at 0 dB,
   boost filling up and cut filling down on a ±24 dB scale, and the
   worklet posts each window's largest boost and cut of `gainDb` at the
   compressor's 30 Hz, only while the card is on screen. `InsertStage`
   gains `shaping`, beside `reduction`.
10. **Additive to the song format.** A new kind: no version bump and no
    presets.

## Consequences

- The Dynamics group's automation rows moved from
  `automation/automationInsertTables.ts` to `automationDynamicsRows.ts`,
  unchanged: the Transient's rows took the catalog's file past its size
  limit, and the group is the seam.
- Switching on from fully off mid-note restarts the detector, so the
  sound's next samples read as an onset and take the Attack setting for
  about `aAttack` (the sweep's "On at 120 ms" rows).
- On a short hit, the `hold` window delays the sustain shape. The library's
  `kick` is about 70 ms long, and at `medium` Sustain +24 raised its energy
  after 60 ms only from 0.104 to 0.152 (`transientMusical.test.ts`'s run).
  That is the trade the listen compares across rows.

## Not done

Lookahead, presets, a timing or Speed knob, sidechain keying, an unlinked
stereo mode and program-dependent timing.
