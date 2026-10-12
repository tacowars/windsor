# The plate's tank modulation: four points of smoothed noise, and the render it moves

- **Date:** 2026-10-12
- **Status:** proposed with windsor#764; the deviations below wait for
  tacowars's ruling
- **Links:** issue windsor#764 · the plan
  `docs/research/2026-10-11-plate-reverb-upgrades/README.md` §4 · the
  measurements `docs/research/2026-10-12-plate-modulation/README.md` · items
  1 to 3, `2026-10-12-plate-decay-in-seconds`, `2026-10-12-plate-build-control`
  and `2026-10-12-plate-stereo-input` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy` · the no-step test in
  `2026-08-31-dattorro-reverb-not-plateau` §3

## Context

One sine and one cosine, detuned by 1.0007, moved two of the tank's four
all-passes (lines 4 and 8), each read up to twice `modDepth` shorter. A long
note beat at the modulation's rate (a fed 1 kHz sine's envelope had its
strongest lines at 1, 3 and 5 Hz at the 0.5 Hz default), and a deep setting
read as chorus: at 8 Hz and 4 ms a held tank ran away, 36 dB up in a minute.
The plan's §4 moves all four all-passes, each by less, from a source that does
not repeat audibly.

## Decisions

1. **Four points.** Lines 4, 6, 8 and 10 (`MOD_LINES`) are each read cubic at
   a moving excursion; 6 and 10 were linear reads before. Each point's depth is
   clamped against the shortest its own line reaches in the block,
   `MIN_LENGTH` (8 samples) short of it, and ramped across the block from
   where the last ended, so a depth or Size move steps nothing.
2. **The source is smoothed noise.** Each point glides from one drawn knot to
   the next along `3a² − 2a³`, zero slope at each knot; knots alternate between
   the upper and the lower half of the range, so every knot turns the point
   round; each segment lasts a drawn 0.5 to 1.5 half-periods, and the leftover
   time at a knot carries into the next segment, so the course runs in seconds
   at any sample rate. Against the issue's other candidate, a triangle turning
   at irregular intervals, it reached a lower held beat for the same spread:
   at 1.30 Hz of spread −19.3 dB, where the triangle needed 1.73 Hz for −19.8
   and stayed above −17 dB below 1.5 Hz (research note, "The source"). The
   triangle's pitch is always one of two; smoothed noise passes through every
   pitch between. No `Math` transcendental runs in it, so `Math.cos` and
   `Math.sin` left the sample loop.
3. **The draws.** `plateModulation.ts` draws each point's knots and widths
   once, at load, from `fm/prng.ts`'s generator at a fixed seed per point
   (`MOD_SEEDS`), into one table of 2^15 draws a point (512 KB in all, shared
   by every plate in the scope). A plate reads it through cursors of its own,
   which construction and sleep reset with the sources, so a woken plate
   renders as a fresh one and the same input always renders the same samples.
   At 8 Hz each point's draws last 1 020 to 1 027 s before they come round.
   The generator is imported, not copied, and `fm/` is untouched.
4. **What the knobs mean.** `modRate` is the source's average rate in Hz, and
   `modDepth` each point's peak excursion in ms: the read moves from its
   line's length to `modDepth` shorter, never longer, so it never needs room
   past the line. The ranges, `[0, 8]` Hz and `[0, 4]` ms, and the labels are
   unchanged.
5. **The default is 3 Hz and 0.35 ms**, chosen by measurement. Of the cells measured
   whose held 1 kHz note beats less than at `main`'s default, it and 1 Hz at
   0.5 ms spread least (1.33 and 1.30 Hz); it beats far less on a fed note
   (−21.7 against −13.0 dB) and on a held 500 Hz one, so it ships. A
   steady 1 kHz sine spreads 1.33 Hz RMS within ±250 Hz against `main`'s 2.12
   (a still tank reads 0.85); held under HOLD for 30 s its envelope's strongest
   0.1–10 Hz component is −19.9 dB against −18.5; fed throughout, −21.7 dB
   against −10.9, with no line at the rate. `DEFAULT_SPACE` and the
   processor's descriptors carry it. The other `SPACES` rows keep their
   numbers under the new meaning, each now lighter; item 8 re-voices the bank.
   `hall` sets `modRate: 0.5` explicitly, because it had inherited the
   default's rate and would otherwise have moved to 3 Hz with it.
   tacowars's ear decides on the preview.
6. **The decay table is re-measured.** Lines 6 and 10 read cubic lose less
   on each pass than linearly, so a small tank's long tail ran long against
   the old table: Size 0.05 +17.1 % and Size 0.08 +12.5 % at Decay 60 s, where
   `main` held both within 4.2 %, and `mixer/reverbLowBand.test.ts`'s 60 s band
   at Size 0.05 read 20 % off. At Size 0.25, 1 and 4, the issue's criterion,
   the old table held every cell within ±10 % at the default and the deepest
   depth. `reverbDecayTables.ts` was re-measured with
   `docs/research/2026-10-12-plate-decay-seconds/decayTable.mjs`, unchanged, on
   the new bundle with every factor 1. The factors moved by up to 3 % from
   Size 1 up and up to 7 % from Size 0.3 to 0.7; at the smallest Sizes the
   tank's ceiling rose (Size 0.05 rings at most 92.8 s where it rang 73.9 s),
   so the long columns moved most. The largest factor is 19.2 (Size 0.075 at
   120 s), and every gain point stays under 1 (`mixer/reverbDecay.test.ts`'s
   longest corner). Size 0.05 and 0.08 now measure −0.8 % and +4.4 % at
   Decay 60 s, and the low band's 60 s target is back within its 15 %.
7. **A moving all-pass's gain is cut for the length it is read at.** A point's
   read is up to its depth shorter than its line, half of it on average, so a
   sample spends less time there than the gain point charges for.
   `configureModulation` runs before `configureGains` and leaves each moving
   line's excursion, and the gain is cut for the line's length less it: while
   the sources move, their mean, half the depth (`MOD_MEAN`); at `modRate` 0,
   where each source rests, read once a block. At `modDepth` 0 it is 0, where
   the table was measured. At 8 Hz and 4 ms, Decay 60 s and Size 0.25 the tail
   measured −11.2 % without the cut and −8.3 % with it (`main` read −24.6 %).
   Two versions were tried first. Half the depth whatever the source's place
   left a source at rest at 0 ringing +12.7 % at Size 0.05; each source's
   place at every block's start moved every gain point every block, so the
   tank ramped all eight a sample at a time and the plate cost 5 % more.
   The low band's gains (`plateLowBand.ts`) are cut for the same shortened
   length, once a block, so both gains at a point see one effective length
   (fix round 2 of PR windsor#767). At Size 0.05, Decay 10 s, `lowDecay` 4,
   8 Hz and 4 ms, the 375 Hz band measured 32.7 s of its 40 cut for the full
   length and 34.8 s cut for the shortened one. At Size 0.25, Decay 15 s and
   `lowDecay` 4 it went from 49.3 s to 50.7 s of 60, still 15.5 % short: the
   same share the modulation takes from the broadband tail in that octave at
   Decay 60 s (53.5 s moving against 65.8 s still). Of the golden's rows,
   `low-band` and `low-band-moves` moved.
8. **The reverb golden is re-pinned on purpose.** Lines 6 and 10 read cubic,
   the new default, the new source and the re-measured table move every render
   that reaches the tank. Of `main`'s twenty-four scenarios, twenty-three
   moved: `anti-phase`, `build-moves`, `build-one`, `build-zero`, `click-left`,
   `click-right`, `decay-long`, `decay-short`, `decay-step`,
   `filters-and-modulation`, `hold`, `hold-released`, `impulse`, `low-band`,
   `low-band-moves`, `max-diffusion`, `size-and-decay`, `size-box`,
   `size-cathedral`, `size-glide`, `sleep`, `sleep-and-wake` and `wet-late`.
   `dry-only`, which never reaches the tank, kept its hash. Two scenarios were
   added: `mod-deep-fast` (8 Hz, 4 ms, a noise burst) and `mod-held` (a 220 Hz
   tone held under HOLD for ten seconds at the defaults, its oscillator a
   recursion from written constants so the feed takes no `Math`
   transcendental). `fmProcessorGolden` did not move, and the Retro Reverb's
   tests pass untouched.
9. **`ARRANGEMENT_VERSION` goes from 12 to 13, with no upgrade.** `modRate` and
   `modDepth` changed meaning, and no setting of the new source renders the old
   sine and cosine. A song saved at version 12 or earlier is refused with the
   standard format message. `songMigrations.ts` keeps its steps up to 10.
10. **The hot path.** The source, the knots and the four excursions are
   written out in the tank's sample loop; the loop calls nothing new (the line
   reads it already called, and `Math.abs`, `Math.floor` and `Math.max`), and
   `configureModulation` runs once a block. The plate costs about 2 to 3 %
   more a quantum: 44.56 against 43.76 µs at each plate's default and 44.63
   against 43.46 µs at 8 Hz and 4 ms in Node 24, and 46.13 against 45.27 and
   46.85 against 45.65 µs in headless Chrome 155 on the page's main thread,
   both on an Apple M1 shared with other sessions (research note, "CPU").

## Deviations for tacowars

1. **A held 1 kHz tank drains about 4 dB a minute**, still or moving, where
   the issue asks ±1 dB on a 1 kHz tone. The drain is the four long lines (5,
   7, 9 and 11), read linearly between samples: a gentle lowpass on every
   pass. It predates this change (`main`'s still tank drained 6.8 dB, its
   default 6.1) and the modulation adds nothing to it (still −4.24 dB, the
   default −4.34, the deepest corner −3.63). Read cubic as well, the long lines
   hold a 1 kHz tank within 0.4 dB at all three settings; that changes every
   tail's top and the decay table again, so it is left for a ticket of its
   own. At 40 and 220 Hz the tank holds within ±1 dB at the default.
2. **The deepest corner's 40 Hz tank wanders to −1.4 dB** over a minute
   (8 Hz, 4 ms), against ±1 dB; 0.3 dB of it is HOLD's own decay. `main`'s
   same corner ran away by 36 dB. The test holds that corner to 1.5 dB.
3. **The wet level of a held 220 Hz note at the default wanders by up to
   2 dB** over a minute while the tank's energy holds (−0.96 to +0.59 dB): under
   light modulation the phases between the output taps drift slowly. At the
   deepest corner the wet holds within 0.7 dB.
4. **At the same slow, light knob values a held note beats more than on
   `main`**, because the same `modDepth` now moves a point about half as far
   (0.5 Hz, 0.35 ms: −10.8 against −14.5 dB). The criterion is read at each
   plate's default, where it falls. Songs re-enter their modulation anyway
   (decision 9).
5. **Where the clamp binds, a depth is not the same in milliseconds at every
   rate.** `MIN_LENGTH` is 8 samples, 0.18 ms at 44.1 kHz and 0.08 ms at
   96 kHz, so at Size 0.05 a clamped point's depth differs by that much
   between rates. Unclamped, every depth is `modDepth` within a sample at
   44.1, 48 and 96 kHz.
6. **The draws are a table, not a running generator.** The issue asks for a
   seeded generator held in the processor's state. `fm/prng.ts`'s generator
   is a closure, and restarting it at sleep would allocate on the audio
   thread; so its draws are taken once at load, and the processor's state
   holds each point's cursor into them, which sleep resets. The renders are
   the same as a generator restarted at every sleep.
7. **Size 0.05 at the deepest settings runs short at Decay 60 s**: −10.2 to
   −20.8 % at 48 kHz at 3 and 8 Hz, 4 ms, where `main` held within 1.3 %, and
   down to −34.9 % at 44.1 kHz, where the still tank already reads −22.9 %
   (`main` −22.6 %, the 44.1 kHz corner of `2026-10-12-plate-decay-in-seconds`
   decision 5). Each of the 1 600 passes a minute takes four cubic reads at a
   moving fraction, a loss the table, measured still, does not hold. Size
   0.25 and up holds ±10 % in every cell of the box.
8. **A steady tone into Size 0.05 at the deepest settings can come out louder
   than through a still tank**: a held 220 Hz tone peaked 14.0 against
   `main`'s 3.0, as the tiny tank's sharp modes sweep across it. Broadband
   input keeps its level (white noise: 0.70 RMS moving, 0.69 still).
9. **The live-move test allows 1 % over the still plate's loudest drum step.**
   The `modRate` sweeps read 1.0001 and 1.0002 of it, the same kick at the same
   sample with the moving tail under it.

## Consequences

- Every song saved before version 13 is refused.
- The plate's sound changes wherever the tank runs, and tacowars listens on
  the PR preview before it merges.
- The deepest, fastest corner no longer runs away under HOLD, and a fast move
  of `modDepth` no longer steps (`main` failed the drum-loop test there).
- The `SPACES` rows modulate more lightly than before at their old numbers
  until item 8's bank replaces them.
