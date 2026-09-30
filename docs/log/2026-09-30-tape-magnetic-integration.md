# Wire the magnetic core into the Tape insert

- **Date:** 2026-09-30
- **Issue:** [windsor#224](https://github.com/tacowars/windsor/issues/224),
  milestone E, step 2 of [epic #146](https://github.com/tacowars/windsor/issues/146)
- **Follows:** [the integration design](2026-09-30-tape-magnetic-integration-design.md),
  [the magnetic core](2026-09-30-tape-magnetic-core.md),
  [greenfield direction](2026-09-30-tape-greenfield-direction.md)
- **History, unchanged:** [the REELS-inspired insert](2026-09-30-reels-inspired-tape-insert.md)

## What the listener hears

Tape's saturation is now Windsor's magnetic model, a hysteresis core, in
place of REELS's tanh polynomial and its makeup gain. Small signals come out
at the level they went in; as a signal passes the knee of the magnetic curve
it rounds off and thickens, and loud material compresses rather than being
limited, so the output can pass full scale where the old stage held it
under. Drive is now a plain gain of ±12 dB into the core: 0 puts a
full-scale tone exactly at the knee, the top of the knob (+32) is ×4 and the
bottom (−32) is ×¼, so turning it up saturates harder and turning it down
cleans the tape. The Bias and model EQ still come first, so a model or Bias
setting that boosts a band drives that band harder. At the extremes a hard
guard at four times the knee catches the peaks before the core; it is heard,
if at all, as a little extra flattening where the controls have been pushed
on purpose. Every track with Tape now plays 48 samples (1 ms at 48 kHz)
later than one without, whether Tape is enabled or bypassed, and Mix blends
that delayed dry signal with the wet: with Wow and Flutter at zero a partial
Mix adds no comb from the delay, only the phase the EQ and the core add.

## What changed

The signal path per channel, in `worklet/tape/tapeDsp.ts`: Bias and model EQ,
× `driveGain(Drive)`, the magnetic core (field guard, knee, RK4 core,
normalisation, decimation, all in E1's `TapeOversampler`), the DC block, the
transport delay, hiss, dropouts, trim. REELS's polynomial, its `warmth`,
`punch` and `makeup` constants and the dB Drive gain are gone from
`tapeConstants.ts` and `tapeDsp.ts`.

- **`tapeMagneticStage.ts`** holds what `TapeDsp` keeps around the core: one
  oversampler per channel at 2× and one at 4×, built in the constructor; the
  core's three controls, smoothed per block toward the model's row with the
  insert's 10 ms time constant (the magnetization kept); and the dry ring of
  `latency` samples per channel. `TapeDsp.channel` drives the pair through
  its `input`, `advance()` and `output` fields and reads the ring in place,
  so no double crosses a call per sample. E1's numerics and API are
  unchanged.
- **`oversampling`** (2 or 4, default 2) is a song field and a processor
  parameter. A change resets the newly selected pair to zero state before
  use; the pair it leaves starts from zero when it is selected again. It is
  kept out of `TAPE_BOUNDS`, whose keys the app's Tape card test reads as its
  knobs: it lives in `TAPE_DEFAULTS`, `TapeSpec`, `normaliseTape` (a value
  that is not 2 or 4 is corrected to 2), `TAPE_NUMBERS` (the processor's
  parameters) and its own `TAPE_OVERSAMPLING`. The card shows no new control;
  the switch is E3's.
- **Model rows.** Each `TAPE_MODELS` row carries `magnetic: [drive, width,
  saturation]`, all 0.5 for now, so the transition between models is a no-op
  and the live-switch test is E3's. `tapeMagneticRows.ts` refuses, when the
  bundle loads, a row outside [0, 1] or whose origin susceptibility is not
  above `TAPE_MAGNETIC.susceptibilityFloor` (declared in E1's constants). The
  check sits in the worklet because `tapeConstants.ts` importing the core
  would close an import cycle through `tapeMagneticConstants.ts`.
- **Drive's curve** stays in `tapeMagneticConstants.ts`, where E1 put it,
  rather than moving to `tapeConstants.ts` as the design record first named.
- **Dry and bypass** read the ring: with `enabled` off the insert returns the
  input 48 samples late, exactly; the transport's variable delay stays on the
  wet path.
- **A test-only EQ bypass**, `TapeDsp.bypassEq`, routes the input straight to
  Drive for the calibration. It is a method, not a parameter, and no song
  reaches it.
- `TAPE_RANDOM.driveMax` and `drivePower` stay: they weight Randomize's roll
  of Drive (`tapeRandomise.ts`), not the saturation. Randomize still rolls
  Drive between 0 and +32, now up to ×4 into the core.

## Format

`ARRANGEMENT_VERSION` goes from 4 to 5 with no upgrade: Drive's meaning
changed, so a saved Drive would otherwise play differently. A version-4
song is refused with the standard message, never silently rendered, and so
is every older one, since the chain has no step from 4. `oversampling` is
additive, with a default that is the only factor that existed, and bumps
nothing by itself.

## The tests

`inserts/tapeMagneticIntegration.test.ts` (calibration and guards),
`tapeMagneticIntegrationLatency.test.ts` (delays) and
`tapeMagneticIntegrationSwitch.test.ts` (rows and the switch) run the
generated bundle a sample at a time through `__fixtures__/tapeDspProbe.ts`,
which reads the left core's stage points, guard and reset counters. The
field a test reports is the one the guard let through, the knee undone.
Figures below are counts and levels from Node 24 on the M1, not timings.

- **(a) Calibration.** EQ bypassed, a full-scale 1 kHz sine at Drive 0
  reaches source field 0.999999 at 2× and at 4×, within the stated 0.001.
  Through each model at Bias 0 the 1 kHz field is: Studio 1.044 (+0.37 dB),
  Ferric 1.178 (+1.42), Vintage 1.246 (+1.91), 15ips Studio 1.001 (+0.01),
  Chrome 0.973 (−0.24), Metal 0.816 (−1.77), VHS 1.150 (+1.21).
- **(b) EQ bypassed.** Full-scale 100 Hz and 1 kHz tones and impulses at
  Drive −32, −16, 0, 16 and 32, at 2× and 4×: no guard, no reset. At Drive 32
  a tone's field is 4.000 without clipping. Full-scale steps at Drive 32
  overshoot past 4 and the guard catches them (11 422 stage points at 2×,
  19 102 at 4×), with no reset.
- **(c) Every model at Bias −100, 0 and 100**, a full-scale 100 Hz tone at
  Drive 32, 48 kHz, 2×: no reset. The guard clips where the EQ boosts the
  low end: at Bias −100 on every model (23 887 to 30 504 stage points in a
  fifth of a second), at Bias 0 on all but Vintage (53 on Studio, 7 913 to
  19 009 on the rest), and never at Bias 100.
- **(d) Ferric at Bias 100, Drive 0.** The sign-of-impulse-response
  sequence (Σ|h| = 4.81) clips 1 400 stage points, and a 1 kHz tone at
  +6 dB over full scale clips too; the field stays within ±4 and nothing
  resets.
- **(e) Slew smoke**, one second at 48 kHz, 2×, Studio, Drive 0: white noise
  at +12 dB over full scale hard-clipped at ±4 resets the core 898 times;
  alternating ±4 resets it none. A reset here is the known limit of the
  qualified domain (design decision 3), recorded, not a gate. The full
  matrix is E2b's.
- **Delays (decision 4).** An impulse peaks exactly 48 samples late through
  the enabled insert at Mix 1 and 0.5 and through the bypassed one, which
  returns it exactly. At Mix 0 with Wear, Hiss and a seed set, the output is
  the input 48 samples late, bit for bit. At Wear 60 the wet output equals
  the zero-Wear wet output read back by the motion model's delay and scaled
  by its dropout, within 1e-9. The report of wet against delayed dry
  (Studio, Bias 0, Drive 0, 2×) reads, at −40 dBFS: 27.0° and −2.07 dB at
  50 Hz, 20.3° at 100 Hz, 9.0° at 250 Hz, 0.1° at 1 kHz, 6.1° at 4 kHz and
  5.6° at 10 kHz; at full scale 21.8°, 15.1°, 3.9°, −5.1°, 1.0° and 1.4°.
- **Rows (decision 6).** Every model maps to Ms 1.25, a = 1.25 / 3.01 and
  c = √½ − 0.01, susceptibility 0.700214, above the floor; a row at width 1
  (susceptibility 0) or outside [0, 1] is refused.
- **The switch (decision 1).** Both factors render from four pairs built up
  front; switching 2 → 4 → 2 → 4 mid-stream finds the new pair's history,
  stage points, outputs and magnetization all zero. `oversampling` round
  trips through `normaliseTape`, and an absent or foreign value reads as 2.
- **Allocation.** A Node of its own evaluates a bundle of the stage and runs
  it as `TapeDsp` does, switching factor every fourth quantum: the heap grows
  by 600 bytes over 1000 quanta, the reading's own result object, and no
  field changes representation. The rest of `TapeDsp` allocated before this
  change and still does; that is windsor#228's.

Existing assertions that moved are named in the PR: exact dry and bypass
became exact delayed dry, and the musical test's peak ceilings were
re-pinned from the new render.

## What E2b and E3 still do

- **E2b:** the full-matrix guard and slew probe (every rate, factor and
  model, ten seconds), and the shipped bundle's cost in Chrome.
- **E3:** the settings switch for `oversampling`, any Drive relabel, and the
  level-matched audition in the app; the first distinct model rows and
  their live-switch test.
