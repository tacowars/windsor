# Voice clicks in a retriggered mono line (windsor#7)

Pat heard clicks in `songs/clicks.json`, like an envelope or a voice cutting in
or out. This note records where they come from, what was measured, and the fix.

## The reproduction

The demo is one `grid` part at 120 BPM, divisor 6 (a sixteenth, 6000 frames
at 48 kHz), sixteen steps that are all notes. Step 0 slides and steps 7 and 15
are accented (velocity 1, mod 1). Its one patch, `(init:0)`, is a mono sine
carrier with feedback 0.73 (op 1, attack 0.5 ms) under a 12 dB low-pass at
30 Hz. The filter is opened by its envelope (`envAmount` 1.1), the LFO
(`lfoAmount` 4) and key tracking (0.52). Its resonance is 0.707, so it does not
self-oscillate.

`packages/engine/src/__fixtures__/voiceClicks.ts` carries the patch field for
field and the line as MIDI notes. It sends the events in the grid sequencer's
order: a plain step is the off then the on, a slide is the on then the off.
`voiceClicks.test.ts` renders the line twice through
`__fixtures__/workletHarness.ts` (seeded, so the render is repeatable) and
measures the largest sample-to-sample step in the left channel, as
`reverbHarness.ts` does. It measures the whole render and also the window of
each step, from its note-on to the next.

## What was measured

Harness renders on Node, before and after the fix. These are sample values
from a deterministic render, not timings.

| Case | `main` | Fixed |
|---|---|---|
| Whole mono line, largest step | **0.244** | 0.027 |
| Same line, largest step 1000–5000 frames into any step (the signal's own) | 0.026 | 0.027 |
| Slide into step 0 (second pass) | 0.005 | 0.005 |
| The step after the slide | **0.089** | 0.002 |
| Accented step 7 / the step after it | **0.061** / 0.024 | 0.007 / 0.004 |
| Accented step 7, second pass / the step after it | **0.244** / 0.002 | 0.025 / 0.002 |
| Poly patch, one note retriggered, 16 voices | 0.005 | 0.005 |
| Poly patch, one note retriggered, pool of 1 (every note steals) | **0.145** | 0.002 |
| Same line with the filter off | 0.067 | 0.067 |

On `main`, the largest step in a step's window lands 192–312 frames after the
note-on. That is the 4 ms steal fade (192 frames) plus the rest of the render
segment. Poly with free voices never steals and never clicks. With the filter
off the line has no steps above the signal's own: the unfiltered saw's
steepest edge is 0.067 everywhere.

## The code path

A mono note-on calls `FmPartProcessor.cutSounding()`
(`worklet/fm/fmProcessor.ts`), which gives every sounding voice
`Voice.steal()`, a linear fade to 0 over 4 ms. When the fade reaches 0 the
render loop calls `Voice.kill()`. A full pool steals the same way through
`allocate()`. Two things made that end in a click:

1. **The fade ran before the filter** (`voiceRender.ts` and `voiceKernel.ts`:
   the carrier sum, then `sig *= fade`, then the SVF). The fade took the
   filter's input to 0, but a low-pass at a few tens of hertz is still
   ringing when its input stops. At the kill the voice's output was that
   ring, not 0.
2. **A killed voice went on rendering to the end of the segment.**
   `renderBlock` walks each voice in control-block chunks up to the next event
   or the block's end, and it did not re-read `active` between chunks. `kill()`
   resets `fade` to 1 and zeroes the amplitudes, but it leaves the filter
   state as it is. So the rest of the segment rendered the old voice's filter
   ring at full level, and the segment's end cut it to 0. The comment on
   `kill()` (#453) already knew that the rest of the block is rendered. It
   zeroed the amplitude ramps for that reason, but it did not account for the
   filter.

Each change alone does not fix it. Moving the fade after the filter without
the second change made the whole line 0.548: the ring came back from 0 to full
level at the kill. Stopping the render at the kill without moving the fade left
it at 0.253: the ring was cut at the fade's end instead of the segment's.

This is not a patch setting behaving as designed (issue decision 5). The
filter is not resonant, and the accent does not cause the click. The clicks on
accented steps are the same steal, and they are larger only because the accent
opens the filter further (mod 1 multiplies the LFO's depth about tenfold), so
more is ringing at the kill. Mono is where the demo hears it, because every
step steals. A poly part that exhausts its voices steals the same way and
clicked the same way.

## The fix

- `voiceRender.ts` and `voiceKernel.ts`: the steal fade multiplies the
  filter's output, not its input. The voice therefore reaches 0 where it is
  heard, and the kill cuts silence. Both loops make the same change in the same
  order, so `fmProcessorKernel.test.ts` still holds the kernel to the generic
  loop bit for bit.
- `fmProcessor.ts`: `renderBlock` stops rendering a voice at the first chunk
  after it is killed.

Nothing new is allocated. The change is one branch per control block and a
moved multiply.

## The threshold

The test fails above a step of **0.05**. That is about twice the largest step
the line makes away from any boundary (0.026, on the brightest accented note).
A larger step is a discontinuity that no note in this line produces. The
signal's own steps now reach 0.027, and `main`'s clicks reach 0.06–0.24. One of
`main`'s steals lands near a zero crossing of the ring and measures only
0.007, so the whole-line assertion is the one that matters. The per-case
assertions pin that each case also stays clean.

## The golden

`fmProcessorGolden` changed for exactly the 53 factory presets with
`mono: true`, in all three paths. The golden's chord plays four notes, so in
mono every note after the first steals, and those renders now end without the
cut. Every poly preset's render is bit-identical. The table was refreshed on
Node 24 (`.nvmrc`). `fmProcessorHeadroom`, `fmProcessor`, `fmProcessorSlide`
and `fmProcessorDormancy` pass unchanged.

## Listening

Pending: Pat's verdict. Open `songs/clicks.json`, play it, and listen for a
tick on each step, loudest on the two accented steps.
