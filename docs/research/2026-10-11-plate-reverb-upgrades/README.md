# Plate reverb: upgrades and a room voicing

Written 2026-10-11. A proposal: nothing here is built or measured yet. It
covers the Dattorro plate in `packages/engine/src/worklet/reverb/` (the
`room` return and the Plate insert) and lists seven changes. Each one
becomes its own ticket. Every value below is a starting point, to be tuned
by ear and checked with the measurements listed under each item. None of it
is a measured claim.

## Where the plate stands

- **Decay is a feedback gain.** `decay` (0 to 1) multiplies the signal at
  the two gain points in each half of the tank. The tail's length therefore
  depends on Size as well: the same `decay` rings longer in a bigger tank.
  No setting reads as a time.
- **Damping only removes.** `tankLowCut` and `tankHighCut` are one-pole
  filters inside the loop. They can make the lows or highs die faster, but
  they can't make the lows ring longer than the mids, which is the main
  difference between rooms.
- **The onset is fixed.** The input passes through four all-pass diffusers
  into the tank, and fourteen fixed taps read it. There is no control over
  how the reverb builds.
- **The input is mono.** `_writeInput` sums L and R before the pre-delay, so
  a panned source's reverb sits in the centre.
- **Two modulation points.** Lines 4 and 8 (the first all-pass in each half)
  are read with a moving delay driven by a sine and a cosine, detuned by
  1.0007 so the two halves drift apart.
- **Seven taps per side** (`TAPS_PER_SIDE`), from Dattorro's table 2.
- **The insert's Mix is linear:** `wet = mix` and `dry = 1 − mix`
  (`plateMix`). Mix 0.5 is about 3 dB quieter than either end on an
  uncorrelated wet signal.
- **One voicing.** The `room` space in `SPACES` is a smaller, shorter plate
  (size 0.28, decay 0.45). The input diffuser lengths are fixed at 3.6 to
  12.7 ms (`INPUT_DELAYS`) and don't follow Size.

## The changes

### 1. Decay in seconds, with a low band

- **Decay** becomes an RT60 in seconds. Each gain point takes the gain that
  loses 60 dB over Decay seconds along the delay it precedes:
  `g = 10^(−3·L / (Decay·fs))`, where `L` is that segment's length in
  samples at the current Size. Size then changes the room, not the tail.
- **The loss is charged on every segment.** If all the loss sits at a
  single point, energy held in the all-passes skips it, and the tail
  outlasts the setting by an amount that grows with the delay lengths. The
  test is the measured T30 against Decay across the whole Size range and
  both tank-diffusion knobs. Any loss that remains is corrected by a
  measured table, not a guessed factor.
- **The low band:** `lowDecay` (a multiplier on Decay) and `lowCross` (Hz),
  named as the retro reverb's, and built the same way
  (`worklet/retro/retroLowBand.ts`): a first-order shelf from a one-pole
  lowpass and its complement at each gain point. The shelf is exactly the
  low gain at DC and exactly the line's gain at Nyquist, so `lowDecay` 1 is
  today's path. `lowDecay` takes the retro reverb's range (0.25 to 4).
- **`lowCross` reaches higher than the retro reverb's.** Its range is 80 Hz
  to 10 kHz, where the retro reverb's stops at 2 kHz
  (`RETRO_REVERB_BOUNDS`). With `lowCross` in the kHz, the split becomes
  "everything but the top rings longer", a second way to darken a tail
  without filtering it.
- **Keep `tankLowCut` and `tankHighCut`.** The low cut is a rumble guard,
  and the high cut stays the plate's main darkening control.
- **HOLD** keeps its own gain (`HOLD_DECAY`) and bypasses the low band.
- **Format:** `decay` changes meaning, so `ARRANGEMENT_VERSION` bumps.
  Converting an old gain to seconds depends on Size and the diffusion
  settings, so an upgrade would need a measured table. Proposed: no upgrade,
  and every `SPACES` row is retuned in seconds.
- **Measure:** octave-band T30 against Decay and `lowDecay`, over the whole
  Size and diffusion ranges, including the corners (Size 0.05 and 4, decay
  at both ends of its new range, tank diffusion 0.8).

### 2. A Build control

- **Where it sits:** a short multi-tap delay per side, between the input
  diffusers and the tank.
- **What it does:** one knob, `build` from 0 to 1, blends the taps' gains
  across a small table of rows and stretches their times, from about a tenth
  of the full spread at 0 to the full spread at 1. The same tap sum also
  goes to the wet output directly, at a level that falls as Build rises.
- **At 0:** a dense, immediate onset with an early burst ahead of the tail,
  for drums. This path must keep transients snappy.
- **Higher up:** the reverb swells in, for pads and vocals.
- **The tables are ours:** tap times, gains and the direct level are tuned
  by ear and kept in `reverbConstants.ts`.
- **Format:** an additive field. Its default must reproduce today's onset,
  or this item joins item 1's version bump.
- **Measure:** first arrival and energy in the first 100 ms against Build,
  and the CPU cost per quantum.

### 3. Stereo input

- **How:** keep L and R apart through their own input diffusers, and inject
  L into the left half of the tank (line 4's input) and R into the right
  half (line 8's), where the shared `split` goes today. The two diffuser
  chains get different lengths so the sides decorrelate.
- **Why:** on a strip insert, a panned snare's reverb then leans to its
  side. A mono input still fills both halves.
- **Optional:** inverting one injection decorrelates further. Check its
  mono sum before keeping it.
- **Format:** none. The wet image changes, but no field does.
- **Measure:** L/R balance with an impulse on each side, L/R correlation on
  noise, mono-sum level, and the cost of the second diffuser chain.

### 4. Lighter, less regular modulation

- **More points:** modulate all four tank all-passes (lines 4, 6, 8 and
  10), so each point moves less for the same overall spread. Lines 6 and 10
  then need the cubic read.
- **A less regular source:** replace the sine/cosine pair with an LFO that
  doesn't repeat audibly, for example a triangle whose direction flips at
  random intervals, or smoothed noise. One phase per point, and nothing
  allocated per block.
- **Default:** light. A plate's modulation should keep a long note from
  ringing at the tank's resonances, not be heard as chorus.
- **Measure:** the spectral spread of a steady 1 kHz sine (RMS width within
  ±250 Hz of a Welch spectrum), swept over depth and rate, and the cost
  per quantum.

### 5. A denser output field

- **The taps:** more taps per side, spread over all eight tank lines, with L
  and R interleaved around the loop, two magnitudes (full and three
  quarters), and signs chosen for decorrelation. Our own table, in
  `reverbConstants.ts`, replacing table 2.
- **Why:** a smoother early field and a wider image.
- **Measure:** early density (samples above a floor in the first 100 ms),
  L/R correlation, the wet level against today's (`OUTPUT_TRIM` is
  re-derived), and the cost per quantum.

### 6. An equal-power Mix

- **How:** the Plate insert's Mix becomes `wet = sin(mix·π/2)`,
  `dry = cos(mix·π/2)`. Mix 0 and 1 are unchanged, and Mix 0.5 goes from
  0.5 / 0.5 to 0.707 / 0.707.
- **Format:** Mix between its ends changes level, so this is a re-scale. It
  ships in item 1's version bump.

### 7. A room voicing

- **One tank, two voicings.** A `voicing` field (`plate` or `room`) selects
  a row of data, not a second processor. The row holds:
  - the input diffuser lengths, and whether they follow Size;
  - the default input and tank diffusion;
  - the Size range;
  - the Build table;
  - the output tap table.
- **Plate:** much shorter input diffusers than today's (well under 2 ms),
  so the onset is instant and dense.
- **Room:** input diffusers around today's lengths, scaled with Size, with
  less diffusion in the tank so early reflections stay distinct.
- **The room needs items 1 and 2.** Rooms live at short decays with their
  own low-band behaviour, and their character is in the early field.
- **Starting points for `SPACES`,** all in seconds after item 1:

  | Space | Decay | Low band | Pre-delay | Top | Diffusion | Build |
  |---|---|---|---|---|---|---|
  | Snare room | 0.3–0.7 s | ×1.25–1.4 below ~600 Hz | 5–17 ms | dark, 3–7 kHz | input partial | 0–0.2 |
  | Wood room | ~1.3 s | ×0.8 below ~800 Hz | 0 | ~5.5 kHz | full | ~0.1 |
  | Small hard room | ~0.6 s | ×1.25 | ~4 ms | ~9 kHz | input and tank low | 0 |
  | Drum plate | 0.5–1.2 s | ×1.5 below several kHz | 0–10 ms | dark, 3–5 kHz | full | 0–0.1 |
  | Vocal plate | 0.7–1.2 s | ×1–1.2 | 0–20 ms | shelved from ~5 kHz | input low | 0.15–0.2 |
  | Large plate | 2–2.6 s | ×0.8–1.5 | 10–15 ms | open | full | 0 |
  | Swelling plate | 1.5–2 s | ×1 | 0–10 ms | open | input lower | ~0.5 |

  These are aims for the ear, and each converts to fields once items 1, 2
  and 7 fix the units.
- **Format:** an additive field defaulting to `plate`. Whether today's
  `room` row moves to the room voicing is decided when it's tuned.
- **Measure:** first arrival, early density, and the T30 of each voicing
  across Size.

## Out of scope

- **Large realistic spaces.** This tank voices plates and small to medium
  rooms. Halls and natural large rooms need a different structure, such as
  a feedback delay network, and are a separate piece of work.
- **Gated reverb.** The retro reverb's `gated` mode covers it.
- **More segments in the tank.** A ring with more junctions would widen the
  room voicing further, but it restructures `tank.ts`. Start with what the
  tables reach.

## Order and review

1. Items 1 and 6, with the one format bump.
2. Item 2.
3. Item 3.
4. Item 4.
5. Item 5.
6. Item 7, once items 1 and 2 have landed.

Every item except item 6 changes the plate's render, so
`mixer/reverbGolden.test.ts` pins a new one, and each PR is `reviewed`: it
waits for tacowars's listen on the preview. Each brief asks for a sweep over
every parameter's whole range up front. CPU figures go beside each PR's
research note, naming the machine and the backend.
