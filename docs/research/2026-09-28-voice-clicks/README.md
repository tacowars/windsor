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

## Round 2: Pat's verdict and `clippy.json`

Pat listened to round 1. It was much better than `main`, which clicked on
nearly every step, but two clicks remained, heard in a second demo,
`clippy.json`. That demo has the same line and carrier with sustain 1 and a
0.4 s release. It sits under a resonant low-pass (Q 4.76) at 55 Hz, which its
envelope opens 4.2 octaves, plus 6 more on an accent (`filter.modWheelDepth` 6
at mod 1). The fixture is `CLIPPY_PATCH`.

### Stop and pause: fixed

Both stop and pause reach the worklet the same way. ■ is
`AudioSystem.stopMusic` and ‖ is `setMuted(true)`, and each calls
`ArrangementPlayer.releaseAll`, which sends the held note's off and an
`allNotesOff`. The worklet releases every voice. Nothing on that path
kills a voice.

The voice's own end made the click. `renderBlock` (and `allocate`) freed a
released voice as soon as `Voice.finished` was true, and `finished` checked
only that the carriers' envelopes had ended. At that moment the last
amplitude ramp had not been rendered yet, and the resonant filter was still
ringing. Stopping at step 7 or 15, the output was 0.12 or 0.074 when the voice
was dropped at the end of its 0.4 s release, and the next sample was 0.

`finished` now also requires every carrier's amplitude ramp to be within
`DORMANT_AMP` of 0, and the filter to be quiet (`filterQuiet`, the same test
dormancy uses, now shared). After the fix, the tail's largest step is
0.026–0.038, the signal's own. The voice rings out and ends 1.1–1.5 s after
the stop, and the last 100 ms before it ends is exact 0. A released voice now
lives for as long as its filter rings down to the −180 dB dormancy floor. That
costs one voice slot for about a second under a slow, resonant filter, and a
new note steals the oldest released voice first.

`fmProcessorGolden` changes for 48 more presets, all of them filtered: the
golden's 0.6 s tail now includes the rest of their filter's ring where it
was cut before. The table was refreshed on Node 24. `fmProcessorHeadroom`,
`fmProcessorDormancy`, `fmProcessorSlide` and the other `fmProcessor*` tests
pass unchanged.

### Accented steps: the patch's filter sweep (needs Pat)

On `clippy.json` the largest step at an accented note-on is 0.17–0.23 (five
seeds), against 0.039 later in the same notes. Round 1's clicks were in the
steal, 200–300 frames in. These land 34–73 frames into the new note: a
roughly 6 kHz resonant ring, excited as the filter opens. In the table, the
onset is the first 600 frames and "later" is 1500–5500 frames.

| Variant (5 seeds) | Accent onset | Later |
|---|---|---|
| As written | 0.168–0.232 | 0.039 |
| Control rate every sample (`CTRL_INTERVAL` 1, experiment only) | 0.107–0.155 (one seed) | 0.039 |
| Filter attack 10 ms instead of 2 ms | 0.067–0.103 | 0.039 |
| Accent does not reach the filter (`filter.modWheelDepth` 0) | 0.058–0.071 | 0.037 |
| Resonance 0.707 | 0.090–0.158 | 0.039 |
| Filter off | 0.037–0.057 | 0.039 |

The click is the sweep the patch asks for. An accent opens a Q-4.8 low-pass
about ten octaves (from 55 Hz to the Nyquist clamp) over its 2 ms attack. The
engine's 32-sample control-rate staircase accounts for only about a fifth of
it: updating every sample leaves 0.11–0.15. A slower filter attack or a smaller
accent depth removes it. Under issue decision 5 this is a patch setting
behaving as designed, so the engine is not changed to hide it. What to do is
Pat's call:

- **In the patch:** a filter attack of about 10 ms, or a smaller
  `filter.modWheelDepth` (the accent's filter depth). Either keeps the accent
  bright without the tick.
- **In the engine (a new ticket):** per-sample cutoff interpolation inside
  the render loops would smooth the staircase. It costs a coefficient
  recompute per sample in the hot loop, and it removes only the smaller part
  of this click.

## Listening

Pending: Pat's verdict. Round 1: open `songs/clicks.json`, play it, and
listen for a tick on each step, loudest on the two accented steps. Round 2:
open `clippy.json`, play it, press ■ and ‖ mid-note, and listen for a tick
as the last note's ring ends. The accented-step tick in `clippy.json` is
expected to remain until the patch question above is decided.
