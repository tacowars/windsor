# Integrate the magnetic Tape core: the product decisions

- **Date:** 2026-09-30
- **Status:** accepted (tacowars, 2026-09-30)
- **Epic:** [#146](https://github.com/tacowars/windsor/issues/146), milestone D
- **Follows:** [greenfield direction](2026-09-30-tape-greenfield-direction.md),
  [static conditioning](2026-09-30-tape-static-conditioning.md),
  [candidate domain](2026-09-30-tape-candidate-domain.md),
  [dynamic survival](2026-09-30-tape-dynamic-survival.md),
  [resampler](2026-09-30-tape-resampler.md),
  [browser cost](2026-09-30-tape-browser-cost.md)

## Context

Milestones A to C established, on the unchanged knee-conditioned
Jiles–Atherton system: qualified references for the signed static boundary
cases; a candidate domain of source field |H| ≤ 4 that RK4 at 2×, 4× and 8×
and RK2 at 8× survive at 44.1, 48 and 96 kHz across the sampled control
points and a 60-second program; an FIR pair whose spans 48 and 64 meet the
declared passband and -60 dBc figures; and a browser cost on the recorded
M1 and Chrome 154 where only RK4 at 2× keeps four instances under the
1.33 ms mean target (0.85 ms), with RK4 at 4× at 1.48–1.69 ms. Peak cost is
unresolved in that Chrome. Candidate accuracy on tones at the control
corners is measured last, by the child issue that follows this record, and
informs the audition without reopening what is decided here.

tacowars chose the five points below from a pros-and-cons list. The aim is
the fastest honest path to a level-matched audition in the app.

## Decisions

1. **Oversampling: 2× by default, 4× as an audition switch.** The shipping
   core runs RK4 at a factor fixed when the DSP is constructed. Tape's
   settings expose `oversampling` (2 or 4) so tacowars can compare the two
   by ear in the app. The switch exists for that audition only; after it,
   the losing factor and the control are deleted. Both cores and both
   filter states are preallocated at construction, so the hot path stays
   allocation-free; selecting the other factor starts it from zero state,
   and a click at the switch is acceptable for the audition period.
2. **Placement: inside the existing Tape insert.** The magnetic core
   replaces the drive → saturation → makeup stage of the REELS-derived
   chain. Bias EQ, tape-model EQ, the DC block, the variable transport
   delay, hiss, dropouts and trim stay in their order. No second insert.
   The REELS saturation polynomial leaves the chain; its provenance record
   stands as history.
3. **Field bounding: a ceiling on the gain into the core.** A full-scale
   input at Drive 0 and flat EQ reaches the knee (source field 1). The
   bound is on the whole path before the core: Bias EQ and tape-model EQ
   have peak gains above unity, so the Drive mapping is capped so that the
   product of the largest EQ peak gain (over every model and the Bias
   extremes, computed from the filter tables) and the Drive gain never
   exceeds 4 for a full-scale input, at the control's maximum. The engine
   mapping and that EQ peak figure are declared in `tapeConstants.ts`, and
   the integration PR carries a test that drives a full-scale tone at the
   model and Bias of largest boost and maximum Drive through the retained
   EQ and asserts the field at the core input stays within ±4. No limiter,
   clipper or new conditioning precedes the core. Signals above full scale
   can still exceed the domain; the core's state guard and reset counters
   remain, and the integration issue tests the guard path. The Drive
   control's visible range and label are the UI issue's to settle
   (`reviewed`).
4. **Latency: always delayed, dry path matched.** The FIR pair delays by
   `span` host samples (48, one millisecond at 48 kHz). That delay applies
   whether the insert is enabled or bypassed, and the dry path of Mix is
   delayed by the same amount, so toggling Enabled and moving Mix never
   shift timing or phase. A Tape on a track is therefore always 48 samples
   later than a track without one; the insert contract has no latency
   compensation and none is added now.
5. **One more accuracy round before building.** RK4 at 2× and 4× with the
   span-32 and span-48 pairs are measured against the qualified reference
   on tones at all nine sampled control points at 48 kHz on the existing
   gates. Its result informs the audition and closes or bounds milestone
   B's accuracy question; it does not change decisions 1 to 4.

## Consequences for E

- **Original code.** The shipping core, its conditioning, integrator and
  FIR pair are written in Windsor from the published Jiles–Atherton
  equations and from Windsor's own research records, with their own tests
  and goldens. The GPL-3.0-only CHOW-derived research core is used only as
  a ruler in tests through the research folder; it is never imported by,
  transcribed into or bundled with shipping code. Output is normalised so
  small-signal gain is unity (the origin susceptibility), then DC-blocked.
- **Format.** `oversampling` is additive with default 2 and bumps nothing.
  The Drive re-scale and the replaced saturation change what a saved Drive
  value means, so the integration PR bumps `ARRANGEMENT_VERSION`, states
  that no upgrade is provided (greenfield direction), and old songs are
  refused, never destroyed.
- **Goldens.** The Tape goldens change deliberately; the PR names each and
  its replacement assertion. The worklet bundle is regenerated and both
  are committed.
- **Order of work.** E1: the original core module with FIR pair, conditioning,
  drive mapping and tests against the research ruler, unwired. E2: wire it
  into `TapeDsp`, dry delay, bypass delay, `oversampling` parameter,
  version bump, goldens, bundle (`reviewed`, engine-only). E3: the settings
  switch and any Drive relabel in the app (`reviewed`, UI), and the
  level-matched bass/chords/hats/transients audition in the app.
- **Not now.** Playback losses, transport rewrite, tape stop/start and the
  preset-picker cleanup remain later work.
