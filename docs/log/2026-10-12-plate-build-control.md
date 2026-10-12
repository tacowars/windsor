# The plate's Build control, and the render it moves

- **Date:** 2026-10-12
- **Status:** proposed with windsor#761; the deviations below wait for
  tacowars's ruling
- **Links:** issue windsor#761 · the plan
  `docs/research/2026-10-11-plate-reverb-upgrades/README.md` §2 · the
  measurements `docs/research/2026-10-12-plate-build/README.md` · item 1,
  `2026-10-12-plate-decay-in-seconds` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy` · the no-step test in
  `2026-08-31-dattorro-reverb-not-plateau` §3

## Context

The plate's onset was fixed: the input went through four all-pass diffusers
straight into both halves of the tank. The plan's §2 adds one knob, `build`
from 0 to 1, that sets how the onset forms: dense and immediate with an early
burst at 0, for drums, and swelling in higher up, for pads and vocals.

## Decisions

1. **A multi-tap delay between the diffusers and the tank.** The diffused
   signal is written into one line, and six taps per side read it back,
   linear between samples as the tank's reads are. The left sum feeds the
   left loop (line 4) and the right sum the right loop (line 8), where the
   diffused signal fed both. The input stays mono until item 3.
2. **The tables are Windsor's own** (`worklet/reverb/reverbBuildTables.ts`),
   voiced by measurement: tap times from 0 to 149 ms at Build 1, fixed in
   seconds, stretched by `0.1 + 0.9 × build`; three gain rows (Build 0, 0.5
   and 1), each of unit energy per side, blended linearly; a direct level of
   0.6, 0.15 and 0 at the same rows, sending each side's tap sum to the wet
   output ahead of the tail.
3. **Build 0's first tap carries most of the energy** (0.905 of a unit-energy
   row). Six taps falling gently inside 15 ms combed the tank's feed: a
   third-octave band 7.2 dB down, and a 220 Hz tone through the Size sweep
   peaked 8 dB lower at Build 0 than at 0.1. The dominant first tap holds the band dips to 2.4 dB
   at Build 0 and 3.6 dB at 0.1.
4. **The default is 0.1**, chosen by measurement: the highest step of 0.1 at
   which the `hall` space, the default send, keeps at least the energy in its
   first 20 ms that it had before (0.0223 against 0.0098) with its first
   arrival no later (0 ms against 12.5 ms). Every row of `SPACES` takes it.
   The issue asks for the ear here, and tacowars's listen decides it.
5. **Live moves.** `build` is smoothed per block as Size is, and the taps'
   times and gains and the direct level ramp a sample at a time. The first
   block after construction or sleep lands Build on its parameter outright,
   as the tank's gains are, so a woken plate renders as a fresh one. HOLD's
   input mute stays before the diffusers, and whatever the Build line holds
   drains into the tank and the direct path.
6. **Hot path.** The tap reads and sums are written out in the tank's sample
   loop; the only call there is `Math.floor`, as the tank's own reads make.
   `configureBuild` runs once a block. The line is allocated at
   construction. The plate costs about 12 % more a quantum (39.6 → 43.8 µs
   at Build 0 and 44.3 µs at 1 in Node, 37.8 → 42.4 and 42.5 µs in Chrome,
   Apple M1).
7. **The sleep span grows by Build's longest tap** (149 ms), since a sample
   can now sit that long in the Build line before the tank hears it.
8. **The reverb golden is re-pinned on purpose.** At the default Build the
   tank hears the tap sums and the output carries the direct path, so every
   render that reaches the tank moved. Of `main`'s eighteen scenarios,
   seventeen moved: `decay-long`, `decay-short`, `decay-step`,
   `filters-and-modulation`, `hold`, `hold-released`, `impulse`, `low-band`,
   `low-band-moves`, `max-diffusion`, `size-and-decay`, `size-box`,
   `size-cathedral`, `size-glide`, `sleep`, `sleep-and-wake` and `wet-late`.
   `dry-only`, which never reaches the tank, kept its hash. Three scenarios
   were added: `build-zero`, `build-one` and `build-moves` (Build moved across
   its range, with HOLD). `fmProcessorGolden` did not move, and the Retro
   Reverb's tests pass untouched.
9. **`ARRANGEMENT_VERSION` goes from 11 to 12, with no upgrade.** No value of
   `build` renders a song saved without it as before, and a hidden "off" state
   was not attempted. A song saved at version 11 or earlier is refused with
   the standard format message. `songMigrations.ts` keeps its steps up to 10.

## Deviations for tacowars

1. **The time to the peak is read to within 1 dB.** The issue asks for the
   time to the wet envelope's peak. Once a long tail has built, its envelope
   stays within about ±1 dB for hundreds of milliseconds, and the single
   loudest 10 ms window wanders inside it: on `hall` it reads 170, 220, 200,
   190, 280 and 230 ms from Build 0.3 to 0.8. The note and the test read the
   first 10 ms window at which the envelope (each window averaged with two
   either side) comes within 1 dB of its peak. On that reading the time rises
   with Build and never falls by more than one window, in all three spaces at
   both rates.
2. **The Size sweep at `lowDecay` 4 moves with Build.** The test's 8 s sweep
   of Size from 0.05 to 4 and back reads 0.92 of its ceiling on `main`, and
   0.83 to 1.04 across Build: 4 % over at Build 0.3. This is the Doppler of a
   long swept tail that `2026-10-12-plate-decay-in-seconds` decision 5
   accepted; Build changes how much 220 Hz the tank holds, which the ceiling
   scales with. The pinned test runs at the default Build and passes.
3. **One live-move cell is 0.5 % over.** Build swept 0 → 1 → 0 over 1 s each
   way with the drum loop, at 44.1 kHz, steps 1.01× the still plate's largest
   step: a swept tap plays the signal up to about 14 % fast. Its tone figure
   is 0.32 of the ceiling, and 48 kHz reads 0.81.
4. **Five corners of the whole box** (Size 4, Decay 60 s, `diffusionIn1` 1)
   do not order the time to the peak by Build: the tank's own 0.6 s lines
   dominate its first second.
5. **The Build line is sized from the running rate**, not from a fixed
   highest rate: 149 ms at whatever rate the worklet runs, rounded up to a
   power of two, so it never wraps short at any rate, 96 kHz included.

## Consequences

- Every song saved before version 12 is refused.
- The plate's sound changes wherever the tank runs, Build 0.1 by default, and
  tacowars listens on the PR preview before it merges.
- Item 8's preset bank sets Build per preset.
- `build` is a field of `ReverbSpace`, so it rides on the return, the Plate
  insert, `REVERB_SPACE_RANGES`, the automation rows and the cards with no
  change to the engine's index.
