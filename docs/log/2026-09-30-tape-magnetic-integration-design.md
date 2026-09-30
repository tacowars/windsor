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

tacowars chose the first five points below from a pros-and-cons list;
the sixth fixes what E1 needs and was added on review. The aim is
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
3. **Field bounding: the guard is the guarantee, the ceiling is the
   calibration.** A full-scale sine at Drive 0 and flat EQ reaches the knee
   (source field 1). Bias EQ and tape-model EQ run before Drive with gains
   above unity, and a bounded adversarial signal (the sign of a filter's
   impulse response) can reach the cascade's L1 norm, about 7.8 at 96 kHz
   for Studio with full Bias, which no musically useful Drive range can
   cap without giving up saturation at Drive 0. So the two duties are
   split. The **domain is guaranteed by construction** by a hard guard clip
   at source field ±4 at the core input, with a counter: every input, of
   any level, meets that clip before the core. The clip bounds the field's
   amplitude, not its slew and not the integrator's state: the static
   conditioning record keeps that distinction, and the survival evidence
   covers reconstructed pulses and a smooth closed-form program, not
   sustained clipped broadband input. The core's magnitude-20 state guard
   and reset counter therefore stay, remain reachable by high-slew
   over-level input, and are reported, never hidden. The **Drive ceiling is a
   calibration** for musical signals: the Drive mapping is capped so that
   the largest steady-state peak frequency gain of the retained EQ (over
   every model, the Bias extremes and the three rates, computed from the
   filter tables and declared in `tapeConstants.ts`) times the Drive gain
   never exceeds 4 for a full-scale sine at the control's maximum. Within
   that range the guard does not engage for tones, impulses or steps; it
   does engage for an adversarial sign sequence or an input above full
   scale, and that is a clip at four times the knee level on a signal the
   knee already compresses toward its asymptote, not a fault. The guard is
   not a tone-shaping limiter and does not precede the EQ. The integration
   PR carries tests that push full-scale tones, impulses and steps through
   the retained EQ at every model, both Bias extremes and all three rates,
   during a model crossfade and a Bias sweep, at maximum Drive, and assert
   the guard counter stays at zero and the core's reset counter stays at
   zero; tests that push the sign-of-impulse-response sequence and an
   input above full scale, and assert the guard engages and the field at
   the core stays within ±4; and a **slew test** that runs ten seconds of
   sustained clipped white noise and of full-scale alternating-sign input
   at +12 dB over full scale through the span-48 pair at 44.1, 48 and
   96 kHz, at 2× and 4×, at every model row, reporting the reset count per
   case. A reset there is a known limit of the qualified domain, recorded
   in the PR and the audition notes, not a merge blocker; a reset on any
   full-scale tone, impulse or step inside the calibrated range is a
   blocker. The Drive
   control's visible range and label are the UI issue's to settle
   (`reviewed`).
4. **Latency: the fixed delay always applies, the dry path is matched, and
   transport delay stays part of the effect.** The FIR pair delays by
   `span` host samples (48, one millisecond at 48 kHz). That delay applies
   whether the insert is enabled or bypassed, and the dry path of Mix is
   delayed by the same 48 samples, so with Wear, Wow and Flutter at zero,
   toggling Enabled and moving Mix never shift timing or phase. The
   retained transport stage adds its own variable delay, up to 25 ms, to
   the wet path only, after the core, as it does today; that delay is the
   wow and flutter effect, and a partial Mix with motion combs on purpose,
   as the REELS record already states. So at nonzero motion the wet path is
   later than the dry path by the current transport delay, and Enabled
   toggles between a dry path 48 samples late and a wet path 48 samples
   plus the transport delay late. This is the declared exception, not a
   defect. A Tape on a track is always at least 48 samples later than a
   track without one; the insert contract has no latency compensation and
   none is added now. The integration PR tests an impulse through the
   enabled and bypassed insert at zero motion, asserting equal delay, and
   at fixed nonzero Wear, asserting the wet path's extra delay equals the
   transport delay reported by the motion model.
5. **One more accuracy round before building.** RK4 at 2× and 4× with the
   span-32 and span-48 pairs are measured against the qualified reference
   on tones at all nine sampled control points at 48 kHz on the existing
   gates. Its result informs the audition and closes or bounds milestone
   B's accuracy question; it does not change decisions 1 to 4.

6. **The core's three internal controls are fixed per tape model.** The
   researched core has three internal controls (drive, width, saturation,
   each in [0,1], mapped to its `a`, `c` and `Ms`), and the research
   records say their 0.5 values are not product defaults. Windsor's Drive
   is the source-field gain of decision 3, not the core's drive control,
   and no new knob is added. Each tape model row in `tapeConstants.ts`
   carries its three fixed core control values. Every model starts at the
   research centre 0.5 / 0.5 / 0.5, a sampled point of the survival domain,
   so identical Tape settings always give identical hysteresis, and a test
   pins the mapping at every model. Giving models different values is sound
   design for the audition PR (`reviewed`), constrained to the sampled
   control points of the dynamic-survival record until a wider domain is
   qualified. **Model transitions:** the core's three controls are
   smoothed with the same 10 ms time constant the insert already uses for
   its continuous controls, and the magnetization state is retained; the
   core is reconfigured from the smoothed values each block, as the
   research core's `configure` is, with its normalisation recomputed there
   and never on the per-sample path. While every model shares one row the
   transition is a no-op. The PR that first assigns distinct rows adds a
   live-switch test under a steady full-scale tone between every pair of
   models, at 2× and 4× and all three rates, asserting zero resets and no
   output sample outside the envelope of the two steady states; the
   interpolation passes through control points the survival record did
   not sample, and that test is the evidence for them.

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
