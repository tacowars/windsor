# The Acid Ladder ships its 2× solver and a Reso ceiling of 17.2

- **Date:** 2026-10-04
- **Status:** accepted (the decisions of windsor#593)
- **Revises:** decision 6 of `2026-10-04-acid-ladder-filter-mode`, which
  shipped the 1× solver with four Newton steps, and the Reso knob's top of
  its decision 4. That record stands as history.
- **Links:** windsor#593 · the research and its readings in
  `docs/research/2026-10-04-acid-ladder-filter/README.md` (readings 2 and
  3, and "The 2× solver at the Reso ceiling of 17.2")

## Context

The Acid Ladder shipped the research's 1× candidate, four Newton steps a
sample with the cutoff held to 10 kHz, because both candidates met the
convergence target and 1× cost less. In tacowars's listen on 2026-10-04,
with the Reso high and the cutoff open, the 1× solver aliased into an
audible high whine. Switching the dev server to the research's 2×
candidate, three Newton steps on two sub-steps a sample, removed it, and
the sweep was clean through that range. In the same session tacowars set
the Reso knob's top, `LADDER_FEEDBACK_MAX`, from 16.5 to 17.2: the chirpy
end of the stock TD-3 units tacowars has owned, short of the
self-oscillation of a Devilfish-modded TD-3-MO.

## Decisions

1. **The solver.** `LADDER_OVERSAMPLE` 2 and `LADDER_NEWTON_STEPS` 3, the
   research's measured 2× candidate, chosen by ear: the whine at open
   cutoff and high Reso went away. The research's aliasing table (reading
   3, full scale, k 16.5) puts the loudest folded product at a 10 kHz
   cutoff at −37 dBr on 1× and −56 dBr on 2×, and at or under −60 dBr
   from 500 Hz to 5 kHz on 2×. The cost (reading 2, Apple M1 under
   Node 24) rises from about 270 to about 395 ns a voice-sample. Decision
   5 below adds a reading in Chrome.
2. **The Reso ceiling.** `LADDER_FEEDBACK_MAX` 17.2, set by ear. The
   makeup at the knob's top becomes √18.2, +12.6 dB. The knob's mapping,
   the makeup's power, the output mix and the feedback high-pass stay as
   they are. The ladder's own linear threshold is k = 17; the feedback
   high-pass raises it as the cutoff falls. On the 2× solver an impulse
   grows from k 17.29 at the 10 kHz cap, 17.38 at 8 kHz, 17.61 at 5 kHz
   and 60.7 at 100 Hz, at 44.1 and 48 kHz alike, so a tail at 17.2 decays
   at every cutoff. The margin is narrowest at the cap, 0.09.
   `ladderLimits.test.ts` holds the decay at both rates.
3. **The cap.** `LADDER_CUTOFF_MAX_HZ` stays at 10 kHz. With the 2× solver
   the cap is a product choice, no longer an aliasing guard: tacowars
   finds the Acid filter not useful above about 6 kHz.
4. **Nothing else moves.** No other ladder constant changes; tacowars
   checked the low end by ear and it is good as it is. The acid patches
   keep their values.
5. **The cost in a browser.** The Acid voice on 1×4 and on 2×3, and every
   other mode in the same bench, measured in the project's headless
   Chrome on this machine (research README, "The 2× solver in Chrome"):
   eight held `pad-drift` voices through the FM worklet in an
   `OfflineAudioContext` at 48 kHz, on two bundles that differ only in the
   two constants, on an Apple M1 (macOS 26.7.1) in headless Chrome
   154.0.8037.93. An Acid voice costs 278.8 ns a voice-sample on 1×4 and
   403.5 on 2×3, 1.45 times as much; every other mode is within 0.6 ns of
   its cost on the 1×4 bundle, inside the rounds' spread.
6. **The tests follow the solver.** The 2× solver is the bilinear image of
   the analog loop at twice the sample rate, seen through its linear
   interpolation and three-tap decimator, so its response droops and
   lags the 1× image above a few hundred hertz (research reading 1). The
   ladder and voice tests now hold the shipped chain to that model,
   `oversampledLadderResponse` in `__fixtures__/ladderAnalog.ts`, the two
   images the resampling folds together summed: within 0.01 dB and 0.1°
   on the ladder, 0.5 dB and 5° through the voice with white noise. The
   solver's single step is still checked against Stinchcombe's polynomial
   at 1×.
7. **No format bump.** This changes how the Acid mode sounds, not the
   patch or song format: old songs load the same fields with the same
   meaning. The three acid rows of `fmGolden.json` and
   `fmGoldenFineInterval.json` are regenerated, and no other row moves.

## Consequences

- The Acid voice costs about half as much again as on 1×4, a mono acid
  line still well within a part's budget.
- With the cutoff open the 2× solver's resampling pair takes the top
  octave down further than the 1× image did: at a 10 kHz cutoff, 0.5 dB at
  the cutoff itself and up to 7.5 dB by twice the cutoff (research reading
  1). That is the range where the 1× solver's aliasing was heard.
- The margin to self-oscillation at the cap is 0.09 of k. A later change
  that moves the feedback high-pass, the cap or the solver re-reads
  `ladderLimits.test.ts`'s tail before it moves the ceiling.
