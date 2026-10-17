# Spectre: a spectral delay insert

- **Date:** 2026-10-16
- **Status:** accepted. tacowars tried Spectre in the app and approved it on
  2026-10-17. Decisions 5, 6, 8 and 13 are revised by
  `2026-10-17-spectre-drawn-cells`
- **Links:** the insert contract `inserts/insertKind.ts` · the Pump's
  breakpoint params `2026-10-13-pump-insert` · the sleep rules
  (windsor#793) · format rules `2026-09-28-format-versions-refuse-never-destroy`

## Context

A spectral delay splits a sound into frequency bands and gives each band its
own delay and feedback. A hit becomes a run that climbs or falls through the
spectrum, and a chord smears into an arpeggio. Frozen, the delays hold the
sound and replay it, and the curves can then be moved under it. No Windsor
insert works in the frequency domain. Every algorithm here is Windsor's
own.

## Decisions

1. **A new kind, `spectre`, in the Time group.** It is a worklet insert
   (`worklet/spectre/`) with a stereo input and output.
2. **A short-time Fourier transform with square-root windows on both
   sides.** Each channel frames its input at `size` = 2 × the chosen bands
   (128 to 2048). A rate of 1.75 × 48 kHz or more doubles the frame, and
   4 × 48 kHz quadruples it, so a setting keeps its sound across rates.
   - Frames start 1×, 2× or 4× per window. The analysis and the synthesis
     each apply the square root of a raised cosine, a tent or a flat shape,
     so their product is the shape itself.
   - The overlap-add gain is the hop over the shape's sum. At 2× and 4× the
     path is transparent to the float32 bit (`spectreDsp.test.ts`).
   - 1× with a shape ripples, and `hard` grinds at frame edges. Both are
     offered on purpose.
   - The FFT is Windsor's own radix-2 transform of the real frame packed as
     half as many complex samples. Its twiddles come from
     `tapePortableMath.ts`.
3. **Latency is the frame less one sample, wet and dry alike.** The dry is
   read from its own ring at the same slot, so Mix never combs. Off is the
   late dry to the bit, as Tape's is. There is no host delay compensation,
   so the default 512 bands put 1023 samples (21 ms at 48 kHz) on the strip.
   Spectre works best on a send, or at Mix 1.
4. **Each band is a complex feedback delay counted in whole frames.**
   - With gain g, delay d (in frames) and feedback f, the band's output is
     the ring's value d frames back, and the ring takes `g·x + f·y`.
   - At d = 0 the output is `g·x`, and feedback needs a delay to act.
   - The delay's resolution is the hop, which is part of the sound, not a
     defect. A move of the delay curve jumps each band's read, and the
     spectrum smears rather than clicks.
   - Freeze glides over 50 ms to g = 0 and f = 1, so the ring loops what
     it holds.
5. **Three drawn curves over a log-frequency axis.** Gain, delay and
   feedback are each 2 to 8 breakpoints on 20 Hz–20 kHz, so a curve doesn't
   depend on the rate or the frame.
   - Gain's 0 is silence, and above 0 it spans 60 dB.
   - Delay's 1 is the full scale: a tempo division while synced, `timeMs`
     while free, up to 8 s.
   - Feedback is the value itself, up to 1.
   - The params travel as Pump's do: `<p>Count`, `<p>At<i>`, `<p>Val<i>`.
6. **The moves are the performance.**
   - Each curve's **Shift** (±4 octaves) slides it along the axis, and its
     **Offset** (±1) moves its values.
   - **Spread** slides the right channel's curves from the left's.
   - **Scatter** adds a fixed random share of the full scale to each band's
     delay.
   - **Grid** snaps every band's delay to a tempo division.
   - All of these are automation rows, gliding over 30 ms a frame at a time.
     Freeze is a switch lane.
7. **Eleven input modulations, one at a time, with three amounts.** They
   reshape the bands before the delays:
   - blur, holes, invert, shift, comb, gate and phase work within a frame;
   - pulse, scatter, swell and smudge keep frames.
   - Each is pinned transparent at its null setting
     (`spectreMods.test.ts`).
   - Their draws are seeded, so a render is reproducible, and the golden
     pins every algorithm that draws.
8. **An LFO at the frame rate.** Sine, triangle, saw, square and random,
   free or synced, with depths into the delay's offset, the gain curve's
   shift (±2 octaves) and the first amount.
9. **A choice change fades through silence.** Resolution, overlap and
   window rebuild from silence over 8 ms each way, because the latency can
   change. Every layout's coefficients are worked out at construction
   (`spectreLayouts.ts`), so the rebuild reads tables and boxes no double.
10. **It sleeps as the delay does.** A silent block puts it to sleep once
    no frame has written into the delays above 1e-7 for the longest delay a
    band can reach (8 s) and the modulations' memory. Asleep, the controls,
    the LFO and Freeze still step every frame, and a loud block wakes it
    from rest. A frozen ring that still holds sound never sleeps.
11. **Memory is set at construction.** The band memory holds 8 s at the
    smallest hop the overlaps allow. That is 4 × 8 × rate floats a channel,
    6 MB a channel at 48 kHz (`spectreDsp.ts`). Only the frames the current
    layout uses are cleared.
12. **Additive to the song format.** It is a new kind, so there is no
    version bump.
13. **The curves open wide.** Ten octaves of curve in a 384 px rack plot
    is cramped, and spectral editing has always wanted a large graph.
    - The Curves page's **Expand** opens the editor over the page, as wide
      and tall as the window allows, on the console's expanded-view ground
      (the Roll's `.roll-overlay`).
    - The overlay has the curve picker and every curve's Shift and Offset
      above it, and labels every minor frequency line once the plot is
      wide.
    - Unlike the Roll's Expand, it moves nothing out of the rack. It is a
      second editor over the same insert, committing through the same
      model, and the rack card redraws when it closes (Escape or Close).
    - A window resize lays the plot out again. tacowars asked for this
      during the build.

## Not done

- **No per-band drawing at full resolution.** A curve holds at most 8
  points; a comb-like gesture comes from the comb modulation.
- **No separate L/R curves.** Spread covers the stereo use.
- **No presets yet.** tacowars should listen first.
- **No sonogram on the card.** Drawing what each band carries would need a
  scope message per frame, as Pump's has.
- **No worst-quantum reading.** The cost note measures the mean in Chrome
  (1.4 % of a 48 kHz quantum at the defaults,
  `docs/research/2026-10-16-spectre-insert/`); a frame's work falls in one
  quantum of its hop, and its peak needs the live load meter.
