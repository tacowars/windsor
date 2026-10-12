# The plate's output taps, and the render they move

- **Date:** 2026-10-12
- **Status:** proposed with windsor#766; the deviations below wait for
  tacowars's ruling
- **Links:** issue windsor#766 · the plan
  `docs/research/2026-10-11-plate-reverb-upgrades/README.md` §5 · the
  measurements `docs/research/2026-10-12-plate-output-taps/README.md` ·
  items 1 to 4, `2026-10-12-plate-decay-in-seconds`,
  `2026-10-12-plate-build-control`, `2026-10-12-plate-stereo-input` and
  `2026-10-12-plate-modulation` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy` · the no-step test in
  `2026-08-31-dattorro-reverb-not-plateau` §3

## Context

The plate read its stereo output from Dattorro's table 2: seven taps a side
at full magnitude, five of their lines shared between the sides, none on the
two all-passes that take the input (lines 4 and 8). The plan's §5 asks for
a denser, wider early field: more taps a side, spread over all eight tank
lines, the sides interleaved around the loop, two magnitudes, and signs
chosen for decorrelation, in a table of Windsor's own.

## Decisions

1. **Twelve taps a side** (`worklet/reverb/reverbTapTables.ts`), each a time
   at Size 1, a tank line and a signed gain of 1 or 0.75. Twelve came closer
   to every criterion than ten in the search, for 1.9 µs a quantum more.
   Times scale with Size as table 2's did, through `_applySize`.
2. **How the table was chosen** (research note, "How the table was
   chosen"):
   - **The lead zone.** A click entering a half reaches its first two lines
     at once, since the half's first all-pass passes it straight on, and its
     last two a long line later. Every slot a click reaches inside 52 ms at
     Size 1 belongs to the side whose input feeds that half. So the other
     side hears nothing of that input in the windows where it heard nothing
     on `main` (50 ms at Size 1, 200 ms at Size 4), and lines 4 and 8 are
     each read by one side only.
   - **Interleaved.** Past the lead zone, each half's slots, in the order a
     click reaches them, are dealt to the other side and back in turn. All
     eight lines are read, each side reading seven: all but the other half's
     first all-pass.
   - **Gains, signs and times** came from a hill climb over captured tap
     signals. The output is linear in the tap gains, so every criterion
     could be read for any gains from one render per case. The climb raised
     the least margin against `main` over early density, correlation, the
     mono sum, windsor#763's side-lead and mirror cells at 48 and 44.1 kHz,
     the T30 of Decay 2 s at Size 4, and a centred source's balance. It then
     moved tap times in 1.5 to 3 ms steps, never past another tap.
3. **The injections do not swap.** Each output keeps the larger share of its
   |gain| on the half its own input feeds: the left 7 against 4 on lines 8
   to 11, the right 6.5 against 4.25 on lines 4 to 7. L still feeds the
   right loop and R the left. `mixer/reverbTaps.test.ts` holds the share.
4. **Every tap stays inside its line.** Each lies between 1 ms and 95 % of
   its line at Size 1: the shortest is 2.2 ms, 4.8 samples at Size 0.05 and
   44.1 kHz, and the longest 81 % of line 9. `mixer/reverbTaps.test.ts`
   replays every tap and line length sample by sample through Size jumps of
   0.05 → 4 → 0.05 and 4 → 0.05 → 4 in one block, and a sweep over 1 s each
   way, at 44.1, 48 and 96 kHz. Every read stays a sample behind the write
   head and two inside the line.
5. **`OUTPUT_TRIM` is 0.4781** (0.6 before). It puts a centred click's wet
   RMS over its first second at `main`'s, averaged in dB over Build 0, 0.5
   and 1 in the default space at 48 kHz. Each of Build 0, 0.1, 0.5 and 1
   reads within 0.11 dB of `main`, and within 0.13 dB at 44.1 kHz.
6. **The hot path.** The tap reads are written out in the tank's sample
   loop, in two loops, one a side, each tap a table read of line, delay and
   signed gain and a linear read with `Math.floor`. `_readTap` is gone, and a
   per-tap gain is a table read, not a branch. Written this way, table 2
   renders `main`'s golden to the bit and costs 0.8 µs a quantum less. The
   new table costs 45.86 µs a quantum against `main`'s 42.58 in Node 24.21.0
   (+7.7 %), and 47.6 against 44.0 µs in headless Chrome 155 on the page's
   main thread (+8.2 %), on an Apple M1 shared with other sessions. Nothing
   allocates per block (`mixer/reverbAllocation.test.ts`).
   `poleCoefficients` moved to `platePoles.ts` with the same arithmetic,
   because the written-out loops took `tank.ts` past 350 lines.
7. **Build's direct path is unchanged.** It keeps its old gain through its
   own trim: the tank scales the direct sum by `OUTPUT_TRIM` with the taps',
   so `plateBuild.ts` aims the direct level at `BUILD_DIRECT_TRIM` (0.6,
   `main`'s trim) over `OUTPUT_TRIM` of its row, once a block
   (`mixer/reverbTaps.test.ts`). With it, a centred click's first second
   reads +0.01, +0.07, +0.01 and +0.11 dB against `main` at Build 0, 0.1, 0.5
   and 1 at 48 kHz, and +0.07, +0.11, +0.02 and +0.13 dB at 44.1 kHz, so
   item 5's bounds hold.
8. **The reverb golden is re-pinned on purpose.** Every render that reaches
   the tank is read through the new taps and trim. Of `main`'s twenty-six
   scenarios, twenty-five moved: `anti-phase`, `build-moves`, `build-one`,
   `build-zero`, `click-left`, `click-right`, `decay-long`, `decay-short`,
   `decay-step`, `filters-and-modulation`, `hold`, `hold-released`,
   `impulse`, `low-band`, `low-band-moves`, `max-diffusion`,
   `mod-deep-fast`, `mod-held`, `size-and-decay`, `size-box`,
   `size-cathedral`, `size-glide`, `sleep`, `sleep-and-wake` and `wet-late`.
   `dry-only`, which never reaches the tank, kept its hash. No scenario was
   added. `fmProcessorGolden` did not move, and the Retro Reverb's tests
   pass untouched.
9. **No format bump.** No field was added, removed or rescaled.
   `ARRANGEMENT_VERSION` stays 13, and there is no upgrade.

What it measures against `main` (research note): early density up 2.6 to
9.3 % at Build 0 and 28.5 to 174 % at Build 1, at Size 0.25, 1 and 4, both
rates. L/R correlation on centred noise is lower at every Size at 48 kHz
(0.0023 against 0.0314 at Size 0.25). The mono sum is within 0.24 dB in
total, with no band more than 1.2 dB under. T30 is within 10 % of Decay at
2, 10 and 60 s at Size 0.25, 1 and 4: Decay 2 s at Size 4 reads −9.2 to
−9.9 %, where `main` read up to −10.5 %. The live moves pass, at 0.49 to
0.86 of the still plate's step.

## Deviations for tacowars

1. **Some side-lead cells are worse than `main` by more than 0.5 dB.** At
   Build 0, in late or middle windows where `main` led by under 0.8 dB: by
   0.20 and 0.12 dB past the allowance at 48 kHz (Size 1, 200–1000 ms, R
   0.7 → 0.0 dB; Size 4, 200–1000 ms, L −0.0 → −0.6 dB), and by 0.01 to
   0.21 dB at 44.1 kHz in five cells (one of them a mirror cell). Each
   owner's early taps catch the other input's energy as it crosses into
   their half, before the fed side's own early taps see it come round. The
   search found no table that held these cells and the density together.
   Every cell where the other side was silent on `main` stays silent, every
   first-window lead grows, and the mirror improves in most cells: Build 1 at
   Size 4, which windsor#763 left at 8.22 dB, reads −2.48.
2. **A centred source sits up to 1.2 dB off centre at Size 4**, against
   `main`'s 0.24 dB. In the default space at Build 0, 0.5 and 1 it reads
   −0.61, −0.88 and −1.20 dB (noise −0.62), and within 0.5 dB at Size 0.25
   and 1. Across the whole box, inside the diffusions' range, the worst cell
   is 1.50 dB, at Size 4. The criterion joined the score late: a table
   chosen without it read 1.8 dB.
3. **The correlation at 44.1 kHz** is 0.0007 and 0.0006 over `main`'s at
   Size 1 and 4 (0.0059 against 0.0052, 0.0044 against 0.0038), inside how
   far a 10 s estimate wanders at these values. At 48 kHz it is lower at
   every Size.
4. **Two earlier allowances widen, each by the margin measured.**
   - The low band's modulated corner in `mixer/reverbLowBand.test.ts` (375 Hz
     at Size 0.05, Decay 10 × 4, 8 Hz, 4 ms) reads 33.9 s of 40, −15.4 %
     (`main` −13 %), and is held to 16 %.
   - In `mixer/reverbModulation.test.ts`, the loudest drum step under the 1 s
     `modDepth` sweep reads 1.018 of the still plate's, and is held to 1.03
     (it was 1.01). The steady-tone check, the no-step test itself, passes
     unchanged.
5. **Decay 0.2 s at Size 4 is much louder than on `main`**: up to +27.5 dB
   over the first second. On `main` the tail had all but died before table
   2's taps read it; the new early taps catch it. Every other cell in the
   box inside the diffusions' range is within −1.1 and +3.6 dB of `main`.
6. **Early density falls under `main`'s in small corners** of the box: at
   Size 0.05, and at Size 0.25 at Build 0, by at most 3.8 % inside the
   diffusions' range (6.1 % at 96 kHz). Past the ceiling, Size 0.05 at Build
   1 under HOLD falls by up to 67 %.

## Consequences

- The plate's early field is denser and its image wider wherever the tank
  runs, and tacowars listens on the PR preview before it merges.
- Item 7's voicing table carries a tap table per voicing; this one is the
  plate's.
- The plate costs about 8 % more a quantum.
