# Plate reverb: upgrades and a room voicing

Written 2026-10-11. A proposal: nothing here is built or measured yet. It
covers the Dattorro plate in `packages/engine/src/worklet/reverb/` (the
`room` return and the Plate insert) and lists seven changes and a new
preset bank to show them off. Each one becomes its own ticket. Every value below is a starting point, to be tuned
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
  a plate fed a stereo signal (a group or the master, where parts arrive
  already panned) puts every source's reverb in the centre.
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
  The range is the retro reverb's, 0.2 to 20 s.
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
  low gain at DC and exactly the line's gain at Nyquist, so at `lowDecay` 1
  the band does nothing. `lowDecay` takes the retro reverb's range (0.25 to 4).
- **`lowCross` reaches higher than the retro reverb's.** Its range is 80 Hz
  to 10 kHz, where the retro reverb's stops at 2 kHz
  (`RETRO_REVERB_BOUNDS`). With `lowCross` in the kHz, the split becomes
  "everything but the top rings longer", a second way to darken a tail
  without filtering it.
- **Keep `tankLowCut` and `tankHighCut`.** The low cut is a rumble guard,
  and the high cut stays the plate's main darkening control.
- **HOLD** keeps its own gain (`HOLD_DECAY`) and bypasses the low band's
  output, not its state. The band's lowpass keeps tracking the circulating
  signal at its real coefficient, so releasing HOLD doesn't step the
  feedback. The tank's damping filters do the same today (`tank.ts`, the
  comment above `dampLp`).
- **Format:** `decay` changes meaning, so `ARRANGEMENT_VERSION` bumps.
  Converting an old gain to seconds depends on Size and the diffusion
  settings, so an upgrade would need a measured table. Proposed: no upgrade.
  Until item 8 replaces them, the `SPACES` rows are converted to seconds
  from each one's measured T30 today.
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
- **Format:** an additive field. If its default renders a song saved
  without `build` bit for bit as before, which a missing-field render test
  pins, it bumps nothing. Otherwise item 2 bumps `ARRANGEMENT_VERSION` on
  its own, with no upgrade: item 1's bump has landed by then, so it can't
  share it.
- **Measure:** first arrival and energy in the first 100 ms against Build,
  and the CPU cost per quantum.

### 3. Stereo input

- **How:** keep L and R apart through their own input diffusers, and inject
  each where the shared `split` goes today, on the side its own output
  reads most. Table 2's left output takes four of its seven taps from the
  right half's lines (9, 10, 11) and the right output four from the left
  half's (5, 6, 7). So L goes into the right half (line 8's input) and R
  into the left half (line 4's). If item 5's tap table later changes that
  weighting, it swaps the injections with it. The two diffuser chains get
  different lengths so the sides decorrelate.
- **Why, and where it helps:** a part's own inserts and its sends sit before
  its pan (`mixer/channelStrip.ts`), so a part's strip and send A hear it
  centred, and stereo input changes nothing there. It helps wherever the
  plate is fed stereo:
  - **on a group or the master,** whose inserts receive their parts already
    panned (`mixer/groupBus.ts`, `mixer/masterStrip.ts`). A drum group's
    hard-left hat then gets its reverb on the left;
  - **after a stereo insert on a strip,** such as a chorus or a delay, whose
    width the plate now keeps.

  A mono input still fills both halves.
- **Optional:** inverting one injection decorrelates further. Check its
  mono sum before keeping it.
- **Format:** none. The wet image changes, but no field does.
- **Measure:** at the processor, L/R balance with an impulse on each side,
  L/R correlation on noise, mono-sum level, and the cost of the second
  diffuser chain. Through the whole graph, a test that routes two parts,
  hard-panned left and right, into a group carrying the plate, and checks
  that each side's wet energy follows its part.

### 4. Lighter, less regular modulation

- **More points:** modulate all four tank all-passes (lines 4, 6, 8 and
  10), so each point moves less for the same overall spread. Lines 6 and 10
  then need the cubic read.
- **A less regular source:** replace the sine/cosine pair with an LFO that
  doesn't repeat audibly, for example a triangle whose direction flips at
  irregular intervals, or smoothed noise. One phase per point, and nothing
  allocated per block.
- **Deterministic:** the irregularity comes from a seeded generator that
  lives in the processor's state, never `Math.random()`. The seed is fixed
  per instance and reset whenever the tank is cleared. So the same input
  and parameters always render the same samples, and
  `mixer/reverbGolden.test.ts` can keep pinning them bit for bit.
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
  - the Build table;
  - the output tap table.

  Both voicings keep today's Size range, 0.05 to 4
  (`REVERB_SPACE_RANGES.size`), so "full Size" is 4 in either.
- **Plate:** much shorter input diffusers than today's (well under 2 ms),
  so the onset is instant and dense.
- **Room:** input diffusers around today's lengths, scaled with Size, with
  less diffusion in the tank so early reflections stay distinct.
- **The room needs items 1 and 2.** Rooms live at short decays with their
  own low-band behaviour, and their character is in the early field.
- **Starting points for the voicings,** all in seconds after item 1. Item
  8's presets are built from them:

  | Space | Decay | Low band | Pre-delay | Top | Diffusion | Build |
  |---|---|---|---|---|---|---|
  | Snare room | 0.3–0.7 s | ×1.25–1.4 below ~600 Hz | 5–17 ms | dark, 3–7 kHz | input partial | 0–0.2 |
  | Wood room | ~1.3 s | ×0.8 below ~800 Hz | 0 | ~5.5 kHz | full | ~0.1 |
  | Small hard room | ~0.6 s | ×1.25 | ~4 ms | ~9 kHz | input and tank low | 0 |
  | Drum plate | 0.5–1.2 s | ×1.5 below several kHz | 0–10 ms | dark, 3–5 kHz | full | 0–0.1 |
  | Vocal plate | 0.7–1.2 s | ×1–1.2 | 0–20 ms | ~5 kHz | input low | 0.15–0.2 |
  | Large plate | 2–2.6 s | ×0.8–1.5 | 10–15 ms | open | full | 0 |
  | Swelling plate | 1.5–2 s | ×1 | 0–10 ms | open | input lower | ~0.5 |

  These are aims for the ear, and each converts to fields once items 1, 2
  and 7 fix the units.
- **Switching voicing mid-tail can't click.** Picking a preset applies it
  live (`plateReverbCard.ts`). A change of voicing swaps the input diffuser
  lengths, the Build table and the signed tap table, so reading the same
  tank through them on the next quantum would step. The processor ducks
  instead:
  - the wet output fades to zero over the insert switch's fade
    (`INSERT_SWITCH_FADE_S`, 5 ms);
  - while it's silent, the tables swap and the input diffusers and the
    Build delay are cleared, since their contents were written for the old
    lengths;
  - the wet output fades back in over the same time.

  The tank's loop isn't cleared, so the tail carries on in the new
  voicing's taps. Every other field keeps its own smoothing.
- **Test it:** with a charged tail, switch plate → room and room → plate.
  The largest sample-to-sample step across the switch must stay within the
  tail's own slew, measured as the Size-sweep test measures it
  (`docs/log/2026-08-31-dattorro-reverb-not-plateau.md` §3).
- **Format:** the field is new, but the plate row's shorter diffusers change
  how every song saved before item 7 sounds: an absent `voicing` reads as
  `plate`, and the plate row is no longer the plate it was saved with. So
  item 7 bumps `ARRANGEMENT_VERSION` too, with no upgrade, as item 1 does.
  Today's `room` space gets its room-voiced successor in item 8 (Back
  Room).
- **Measure:** first arrival, early density, and the T30 of each voicing
  across Size.

### 8. A new preset bank

- **It replaces `SPACES`.** Today's six spaces (`plate`, `room`, `hall`,
  `cathedral`, `wash`, `shimmer`) give way to a bank of 27, built like the
  retro reverb's (`inserts/retroReverbPresets.ts`): each preset has a
  number, a label and a group, and writes every sound field. Mix and the
  on/off switch stay the user's. The Starting point picker lists the bank
  by group.
- **Format:** none. A song stores the values, never a preset name, so
  replacing the bank changes no saved song.
- **The names follow the retro bank's theme,** rave and club nights, and
  reuse none of its twenty.
- **What it covers:** everyday presets to reach for first, and at least one
  preset that shows off each of items 1 to 5 and 7.
- **The default carries over.** Today's default is the `hall` space: a new
  Plate insert starts there (`PLATE_REVERB_SPACE_DEFAULT`), and so does send
  bus A. It becomes **Resident**, the new default. Its Decay is today's
  measured T30 at size 1.4 and decay 0.78, and its new fields sit where they
  change least. Items 3 to 5 still change its render, so it is checked by
  ear against a render of today's `hall` on the same material.
- **Today's other five each have a successor:** `plate` → House Plate,
  `room` → Back Room, `cathedral` → Old Mill, `wash` → Last Train,
  `shimmer` → White Label.

| # | Preset | Group | Voicing | Decay | Use, and what it shows |
|---|---|---|---|---|---|
| 1 | Resident | Everyday | plate | today's `hall` | The default send: today's sound, carried over |
| 2 | House Plate | Everyday | plate | ~1.6 s | The all-round plate |
| 3 | Main Room | Everyday | room | ~1 s | The all-round room |
| 4 | Back Room | Everyday | room | ~0.6 s | A small room that glues a mix |
| 5 | Warm-up | Everyday | plate | ~1.1 s | Dark (top ~4 kHz): sits behind anything |
| 6 | Booth | Everyday | room | ~0.35 s | A tiny, close ambience; Build 0 |
| 7 | Mic Check | Everyday | plate | ~1 s | Vocals: ~20 ms pre-delay, low input diffusion |
| 8 | Long Set | Everyday | plate | ~3 s | A smooth, everyday long tail |
| 9 | Dubplate | Drums | plate | ~0.9 s | Bright and instant: Build 0 and the dense taps (items 2, 5) |
| 10 | Rewind | Drums | plate | ~1.6 s | A big snare plate whose top dies first: lows ×1.5 below ~5 kHz (item 1) |
| 11 | Club Toilets | Drums | room | ~0.6 s | Hard tiles: very small, low diffusion (item 7) |
| 12 | Railway Arch | Drums | room | ~0.5 s | A brick snare room: dark, ~12 ms pre-delay, lows ×1.3 |
| 13 | Cloakroom | Drums | room | ~1.2 s | Coats soak up the bass: lows ×0.8 (item 1) |
| 14 | Stairwell | Drums | room | ~1.3 s | Tall and narrow: on a drum group, panned hats keep their side (item 3) |
| 15 | Sound Clash | Drums | plate | ~1.2 s | Wide: on a percussion group, each part's reverb follows its pan (item 3) |
| 16 | Acetate | Pads & leads | plate | ~1.8 s | Swells in: Build ~0.5 (item 2) |
| 17 | White Label | Pads & leads | plate | ~2.5 s | Clean and bright, light modulation, for leads (item 4) |
| 18 | Euphoria | Pads & leads | plate | ~3.5 s | Lush: deeper, irregular modulation (item 4) |
| 19 | Hands in the Air | Pads & leads | plate | ~4 s | A slow swell for big chords: Build high (item 2) |
| 20 | Breakdown | Pads & leads | plate | ~3 s | Dark pads under a breakdown: Build ~0.8 |
| 21 | Sunrise Set | Pads & leads | plate | ~4 s | Warm: lows ×1.4 |
| 22 | Afters | Ambient | plate | ~6 s | Long and dark |
| 23 | Last Train | Ambient | plate | ~8 s | A wash |
| 24 | Comedown | Ambient | plate | ~5 s | Heavy: dark top, lows ×1.8 |
| 25 | Old Mill | Ambient | room | ~4 s | The biggest room the voicing reaches, at full Size |
| 26 | Lights Up | Ambient | plate | ~5 s | Bright and fading, Build mid: the end of the night |
| 27 | Sound System | Ambient | plate | ~4 s | Dub: the bass blooms, lows ×2 below ~300 Hz |

- **Voiced by measurement, then by ear.** As with the retro bank, each
  preset is rendered at Mix 1 through the shipped processor on a drum loop,
  a pad chord and a lead line, for its RT60, level, spectrum and peak, and
  the bank's levels are matched before tacowars's listen. The figures above
  are aims, and the values in the table file are the measured outcome.
- **Measure:** each preset's T30, level against Resident, and peak, in the
  table file's header.

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
7. Item 8, last, once every item it shows off has landed.

Every item from 1 to 7 except item 6 changes the plate's render, so
`mixer/reverbGolden.test.ts` pins a new one, and each PR is `reviewed`: it
waits for tacowars's listen on the preview. Each brief asks for a sweep over
every parameter's whole range up front. CPU figures go beside each PR's
research note, naming the machine and the backend. Item 8 is `reviewed`
too: its presets are sound design and the picker changes, so it waits for
tacowars's listen and look.
