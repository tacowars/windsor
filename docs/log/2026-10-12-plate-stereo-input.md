# The plate's stereo input, and the render it moves

- **Date:** 2026-10-12
- **Status:** proposed with windsor#763; the deviations below wait for
  tacowars's ruling
- **Links:** issue windsor#763 · the plan
  `docs/research/2026-10-11-plate-reverb-upgrades/README.md` §3 · the
  measurements `docs/research/2026-10-12-plate-stereo-input/README.md` ·
  items 1 and 2, `2026-10-12-plate-decay-in-seconds` and
  `2026-10-12-plate-build-control` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy` and
  `2026-09-30-tape-greenfield-direction` · the no-step test in
  `2026-08-31-dattorro-reverb-not-plateau` §3

## Context

The plate summed L and R to mono before its pre-delay. A plate on a group or
the master, where parts arrive already panned, put every source's reverb in
the middle, and a chorus or delay ahead of the plate lost its width. The
plan's §3 keeps L and R apart through their own input stage and injects
each into the half of the tank its own output reads most.

## Decisions

1. **Two input chains, one set of controls.** L and R each have a pre-delay
   ring, input low and high cut states and four input all-passes. One
   `preDelay`, one `inputLowCut`, one `inputHighCut` and the two input
   diffusions set both, at the coefficients the mono path used. Each channel
   enters at unity: a centred source puts into each half what the mono sum
   did, a one-channel input feeds both chains, and no input feeds zeros.
2. **The line layout.** L's diffusers stay lines 0 to 3 and the tank stays
   lines 4 to 11, so no tank line, tap or comment moved. R's diffusers are
   lines 12 to 15 (`INPUT_DELAYS_RIGHT`). `TANK_LINE_END` bounds the lines
   Size scales.
3. **Where each side goes in.** L's chain feeds the right loop (line 8) and
   R's the left loop (line 4): table 2's left output takes four of its seven
   taps from lines 9, 10 and 11. Each chain writes its own Build line, the
   left tap set reads L's and the right tap set R's, and each tap sum goes to
   its own side of the wet output at the direct level. The Build tables are
   unchanged.
4. **The right chain's lengths are 5.312, 3.825, 11.459 and 8.022 ms**,
   against the left's 4.771, 3.595, 12.735 and 9.307 ms, chosen by
   measurement (research note, "The right chain"). 520 sets, each length its
   left counterpart times 0.85 to 0.97 or 1.03 to 1.15, were read for the
   mirror of a click on each side at Build 0 over Size 0.25, 1 and 4. From
   the smallest mirror up, the first set that kept every T30 the earlier
   records pin (the converted spaces, and the Build corners) and Build's
   rise, each with half a point to spare, ships. They are not scaled by
   Size, as the left's are not. The ear checks them on the preview.
5. **The inversion was tried and not kept.** Inverting R's injection
   passes the mono-sum criteria too (its total 0.20 dB over `main`'s, its
   lowest band −0.33 dB), but it moves the L/R correlation of centred noise
   only from 0.006 to 0.004: the tank's output taps already decorrelate the
   sides (`main` reads 0.004). It buys nothing measurable and lifts the
   100 Hz band of the mono sum by 0.8 dB, so the plate keeps one sign.
6. **HOLD and sleep.** HOLD's input mute applies to both chains before their
   filters, so what either holds drains into the tank. Sleep empties both
   pre-delays, both filter states, every line of both chains and both Build
   lines, so a plate woken by R alone renders as a fresh one, to the bit.
7. **The hot path.** R's chain, its filters and its Build reads are written
   out in the tank's sample loop beside L's. Its four lines are read in
   place, once each, linear between samples, with no call but `Math.floor`:
   through the plate's `_read` and `_write1`, as L's chain still reads, the
   plate cost 30 % more a quantum than `main`; written out, 6 %, and the
   render is the same to the bit. Everything is allocated at construction.
   `_writeInput` moved to `plateInput.ts`: `tank.ts` had grown past the
   350-line limit, and the input write is its own concern.
8. **The pre-delay rings hold the full second at any rate.** Each ring is
   `MAX_PRE_DELAY` rounded up to whole quanta, plus one quantum. The old
   ring, a second plus a part quantum, held the longest pre-delay 68 samples
   (1.5 ms) short at 44.1 kHz. 48 and 96 kHz allocate as before.
9. **The reverb golden is re-pinned on purpose.** Every render that reaches
   the tank moved: the two halves now hear different diffusers, and the Build
   sums reach the opposite loops. Of `main`'s twenty-one scenarios, twenty
   moved: `build-moves`, `build-one`, `build-zero`, `decay-long`,
   `decay-short`, `decay-step`, `filters-and-modulation`, `hold`,
   `hold-released`, `impulse`, `low-band`, `low-band-moves`,
   `max-diffusion`, `size-and-decay`, `size-box`, `size-cathedral`,
   `size-glide`, `sleep`, `sleep-and-wake` and `wet-late`. `dry-only`, which
   never reaches the tank, kept its hash. Three scenarios were added:
   `click-left`, `click-right` and `anti-phase`, the last silent before this
   change. `fmProcessorGolden` did not move, and the Retro Reverb's tests
   pass untouched.
10. **No format bump.** No field was added, removed or rescaled.
    `ARRANGEMENT_VERSION` stays 12, and there is no upgrade. A song whose
    plate is fed stereo renders differently, which the greenfield direction
    and the format-versions record allow without a bump.

## Deviations for tacowars

1. **The mirror misses 1 dB at Size 4, Build 0**, by 0.16 dB in the 0–50 ms
   window at 48 kHz and 0.19 dB in the 50–200 ms window at 44.1 kHz. At
   Size 4 the halves' first output taps reach the window at different times
   (line 9's at 36 ms on the left, line 5's at 47 ms on the right), so the
   window splits them unevenly. With both chains at the left's lengths it
   reads 1.96 dB; only one of the 520 sets met 1 dB, and it put the `room`
   space 11 % short. `mixer/reverbStereo.test.ts` holds Size 4 to 1.25 dB.
2. **The mirror misses at Build 1** by up to 8.2 dB in the first window at
   Size 4 (2.9 dB at Size 0.25, 2.6 dB at Size 1). At Build 1 the direct
   path is 0, and the first window holds only the first Build tap of each
   side through the tank's first tap: Build's left and right tap times
   differ by design (`2026-10-12-plate-build-control`). The fed side still
   leads by 4.2 dB or more in that window, at either rate. Retuning Build's
   tables is out of this ticket's scope.
3. **T30 at Decay 2 s, Size 4, a centred click, reads −9.4 % to −10.4 %**
   across Build, against −9.4 % to −9.8 % on `main`. Its 0.6 s lines lose
   18 dB a pass, so few passes span the fit, and the corner sat at the edge
   already. A hard-left click reads −4 %. `mixer/reverbBuild.test.ts` holds
   that one corner to 11 %, every other cell to 10 %.
4. **The lead in the first 50 ms is under 3 dB at the small Sizes** (the
   whole-box sweep, research note). At Size 0.05 the whole tank is 36 ms
   round, so both halves fill inside the window whatever side fed it: the
   least lead is 0.2 to 0.7 dB. At Size 0.25 it misses where an input
   diffusion is at 1, which smears the click past the window, and at Build 1
   where the first arrival lands near the window's end (least 0.1 dB at
   44.1 kHz). From Size 1 every cell that has heard anything leads by more.
5. **A hard-panned source's wet is 2.8 to 3.1 dB louder than on `main`**,
   because it enters at unity where the mono sum halved it. A centred
   source's is within 0.3 dB.

## Consequences

- A plate on a group or the master keeps its parts' sides: in the graph
  test, a hard-left part's wet leads on the left by 3.7 dB in its first
  200 ms, and a hard-right part's on the right by 3.0 dB.
- An anti-phase source rings at the level of a centred one. Its wet mono sum
  is 3 dB under its wet's per-side level, as for any decorrelated pair.
- The plate costs about 6 % more a quantum for the second chain: 42.3
  against 39.9 µs in Node 24 on an Apple M1, and 42.9 against 40.6 µs in
  headless Chrome 155 on the page's main thread (research note, "CPU").
- The plate's sound changes wherever it is fed stereo, and tacowars listens
  on the PR preview before it merges.
