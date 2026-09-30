# Write Windsor's own magnetic Tape core, unwired

- **Date:** 2026-09-30
- **Issue:** [windsor#219](https://github.com/tacowars/windsor/issues/219),
  milestone E, step 1 of [epic #146](https://github.com/tacowars/windsor/issues/146)
- **Follows:** [the integration design](2026-09-30-tape-magnetic-integration-design.md),
  [static conditioning](2026-09-30-tape-static-conditioning.md),
  [filtered reference](2026-09-30-tape-filtered-reference.md),
  [resampler](2026-09-30-tape-resampler.md)

## Context

The design record fixed the product decisions for the magnetic Tape core
and ordered the work: E1 writes the core as original code, tested against
the research ruler and left unwired; E2 wires it into `TapeDsp`; E3 adds the
settings switch and the audition. This record says what E1 built and the
choices it made inside the design record's decisions.

**Nothing audible changed.** No shipping file imports the new modules, the
generated worklet bundles are unchanged, and no existing golden moved.

## What was built

- `packages/engine/src/worklet/tape/tapeMagnetic.ts`:
  - `TapeMagneticCore`, a scalar Jiles–Atherton magnetization integrated by
    classical RK4 at the oversampled rate. The stages run at the step start,
    twice at its midpoint, and at its end.
  - The magnitude-20 state guard, with a reset counter.
  - `configure(rate, factor, controls)`. It maps the three internal controls
    to Ms, a and c. It also recomputes the step, the origin susceptibility
    and the output gain.
  - The field guard `guardField` and the knee `condition`.
- `packages/engine/src/worklet/tape/tapeOversample.ts`: `TapeOversampler`,
  built at a factor of 2 or 4.
  - The Blackman-windowed sinc pair at span 48 and cutoff 0.45 fs.
  - The polyphase interpolator of H and dH, evaluated at every stage time.
  - The symmetric decimator.
  - `process(x)` for one sample, `render` for a block, and an identity flag
    for the tests.
- `packages/engine/src/inserts/tapeMagneticConstants.ts`: every tunable,
  the default row 0.5 / 0.5 / 0.5, and `driveGain`.

Both worklet files compile under `worklet/tape/tsconfig.json`. The tests
import them, so they also compile under the test project's stricter flags.

## Original work

The core is written from the published model: Jiles and Atherton, *Theory
of ferromagnetic hysteresis*, J. Magn. Magn. Mater. 61 (1986); and
Chowdhury, *Real-time physical modelling for analog tape machines*, DAFx
2019. It also follows Windsor's own records. The file headers say so.

- No shipping file imports anything from `docs/research/`. None copies,
  transcribes or paraphrases the GPL-3.0-only research core or any chowdsp
  or JUCE source.
- The equation's structure and the Langevin function's series are physics.
- The tuning is declared in the constants file with a comment. It covers
  `alpha`, `k`, the control mapping, the knee, the asymptote and the guards.
  These values were chosen to match the qualified research domain.
- The equivalence test is the evidence that the tuning matches.

## Decisions made here

1. **H and dH are an exact derivative pair.** The interpolator has two
   polyphase filters on the same host window. One holds the kernel g. The
   other holds its analytic derivative g′, scaled by the host rate so that
   dH is per second. So dH is the time derivative of the H the core sees,
   as the filtered reference used it, not a finite difference. There are
   `2 × factor` phases: each step's midpoint and end, with its start carried
   over from the previous end.
   - The test compares dH against a fine central difference of the same
     kernel sum. The worst error is 8e-12 of its peak.
   - The same test shows H is that sum within 5e-16.
2. **The pair is one FIR used twice.** The decimator's taps are g at the
   oversampled rate, normalised to sum to 1, and exactly symmetric by
   construction: g is evaluated at |t|.
   - The interpolator's integer phases are exactly `factor` times those
     taps.
   - The interpolator reads the `span` host samples before the current one,
     so the fixed delay is exactly `span` samples by construction.
3. **The field guard zeroes dH where it clips.** The guard clips the source
   field to ±4 before the knee. The derivative of a clipped field is zero,
   so the pair stays consistent. A field that is not a number becomes zero.
   Each clipped stage point counts once.
4. **No double crosses a call on the per-sample path.** This follows worklet
   rules 2 and 7.
   - The stage points travel in the oversampler's `Float64Array`. The core's
     `tick(stages, at)`, `condition(stages, at)` and `guardField(stages, at)`
     read and write it in place.
   - The core's result is a field (`out`). The block entry `render` moves
     host samples through fields too.
   - This is how the issue's `tick(h, dh)` and `condition(h, dh)` are
     realised. The values are the same; only the calling form differs.
5. **The width endpoint runs, with its gain capped.** At width 1 the
   reversible coefficient clamps to zero, and so does the origin
   susceptibility.
   - The core still integrates there. The research corners include it, and
     the equivalence test runs them.
   - Its output gain is capped at `1 / susceptibilityFloor`, with the floor
     at 1e-3. Every sampled control point off that endpoint is above the
     floor. The lowest is drive 0, width 0.5, at about 2.3e-3.
   - Excluding such rows from the tape models is E2's (design decision 6).
   - `configure` refuses controls outside [0, 1] and a factor other than 2
     or 4.
6. **Drive is ×4 exactly at its maximum.** The gain is `4 ** (drive / 32)`
   over the existing Drive bounds of ±32. It is exact at 0 and at both
   bounds, so the maximum is +12.04 dB. The curve and `driveGain` live in
   `tapeMagneticConstants.ts`, which the issue owns. The design record named
   `tapeConstants.ts`; E2 may move them when it wires Drive.

## The fixture

`scripts/tape-magnetic-fixtures.mjs` is the only file outside
`docs/research/` that touches the research code. It runs once, at
fixture-generation time. It loads the research core through the research
loader, read-only, and writes `__fixtures__/tapeMagneticReference.json`:

- Four synthetic source-field sequences, oversampled at 48 kHz × 4 over
  8192 steps (43 ms). Each holds H and its exact derivative at every stage
  point. They are the three tones of the research `EXPERIMENT.bins` at
  level 1, and a signed ±4 raised-cosine pulse.
- The research core's trajectory on each sequence, with the research knee
  applied at every stage. There is one per control row: the centre and the
  eight cube corners.
- The research knee on a grid over [−8, 8].
- The SHA-256 of every research source the loader bundled.

The trajectories are stored at every fourth step, the host instants. The
inputs are stored whole, because both cores must see the same values. The
arrays are little-endian Float64 in base64, and the file is 2.2 MB. The
file is formatted with Prettier. `--check` confirms that a run regenerates
it byte for byte.

## Results

All figures below were read on Node 24.21.0 on the Apple M1 that the other
Tape records name. They are accuracy figures, not cost figures.

- **Equivalence.** All 36 cases match the research trajectory within
  1.4e-12, both raw and after the normalisation is undone. There are zero
  resets. Two broken cores fail it:
  - with the midpoint stages reading the step start, every case is at least
    2.9e-6 off;
  - with the knee's chain derivative dropped, every pulse case fails.
- **Knee.** It equals the research values within 1e-15 on the grid.
- **Normalisation.** A -60 dBFS 1 kHz tone at the centre row passes at
  +0.0016 dB at both 2× and 4×.
- **FIR pair.** The passband is within 0.031 dB to 0.40 fs, and the worst
  image is -75.1 dBc, both as #207 measured.
  - The worst alias is -75.1 dBc. It is read as the decimator's gain at
    every in-band image of #207's tones, relative to its gain at the tone.
    That is a stricter reading than #207's -81.1.
  - The impulse delay is exactly 48 samples, and the response is symmetric
    within 1e-15.
- **Decimator.** The symmetric decimator is within 4e-15 × peak of a direct
  dot product.
- **Allocation.** Across 2000 quanta of `render` at each factor, the heap
  grows by 600 bytes: the reading's own result object. No field changes its
  representation.

The golden, `__fixtures__/tapeMagneticGolden.json`, pins a two-second stereo
render at 2× and 4×, bit for bit, with its guard and reset counts. The
program is tones and a signed pulse under a Drive sweep over the full
bounds. At the sweep's top the left channel reaches the field guard: 26
stage points at 2× and 51 at 4×, with no resets.

## What E2 and E3 still do

- **E2:**
  - Wire the core into `TapeDsp` in place of the saturation stage, with both
    factors preallocated.
  - Delay the dry and bypass paths by `latency`.
  - Add the per-model control rows and their floor assertion.
  - Smooth the core's controls and call `configure` per block.
  - Add the `oversampling` parameter.
  - Bump `ARRANGEMENT_VERSION` for the Drive re-scale.
  - Change the Tape goldens deliberately, regenerate the bundle, and run the
    calibration, guard and slew tests from the design record.
- **E3:** add the settings switch and any Drive relabel, then run the
  level-matched audition in the app.
