# An Acid Ladder mode for the voice filter

- **Date:** 2026-10-04
- **Status:** accepted. The engine ticket (windsor#573) shipped decisions
  1–9, with the solver of decision 6 chosen on its measurements and
  decision 8's per-sample call moved to a pass after the sample loop (both
  below). Revised on 2026-10-04 after Codex's review of the research
  (`docs/research/2026-10-04-acid-ladder-filter/codex-review.md`):
  decision 4's high-pass is labelled a calibration, decision 6's solver
  is reopened on a convergence matrix, and the release premise under
  Consequences is corrected.
- **Links:** the modelling and its numbers in
  `docs/research/2026-10-04-acid-ladder-filter/README.md` · the Formant
  mode, the precedent for adding a mode,
  `2026-10-02-formant-filter-mode.md` · the voice drive stage,
  `2026-10-01-voice-drive-stage.md`

## Context

The voice filter is a TPT state-variable section (`worklet/fm/svf.ts`),
one or two in series for Lowpass, Highpass, Bandpass and Notch at 12 or
24 dB, and three in parallel for Formant. Acid basslines want the Roland
TB-303's filter, which is none of these: a four-stage diode ladder whose
stages load one another, whose bottom capacitor is half the others, whose
resonance is feedback around the whole ladder through a ~150 Hz high-pass,
and whose saturation happens inside the ladder and its feedback, not after
it. Its ultimate slope is 24 dB/oct but its poles are spread over five
octaves, so the two octaves above the cutoff fall at about 18 dB/oct, and
the stock unit stops just short of self-oscillation.

The mode is added beside the SVF: the SVF's code, coefficients and modes
are not touched, and every factory preset renders bit for bit as before.

## Decisions

1. **The mode.** A seventh filter mode, `FILT_LADDER = 6` (`modeIds.ts`),
   `FILTER_MODE.LADDER`, named `'Acid'` at the end of `FILTER_MODE_NAMES`
   (the segment's labels are short: `LP`, `HP`, `Formant`; the record and
   the docs call it the Acid Ladder). The normaliser's clamp moves from
   `FILT_FORMANT` to `FILT_LADDER`; a mode past it still plays Off.
   `filterModeShows` (the console) shows Cutoff and Reso and hides Slope and
   Vowel in this mode; `slope24` and `vowel` are not heard in it.
2. **No new patch field.** Cutoff and Reso are the mode's two controls,
   read from the voice's live values (`VT_CUTOFF`, `VT_RESONANCE`), so
   knobs, steps, song lanes and macros reach the ladder with no change to
   the target table or the catalog. The change is additive and no saved
   patch uses mode 6, so `PATCH_FILE_FORMAT` and `ARRANGEMENT_VERSION` do
   not move (`2026-09-28-format-versions-refuse-never-destroy`).
3. **The model is the circuit.** Stinchcombe's TB-303 ladder as four
   coupled capacitor states: each stage integrates the difference of the
   `tanh` currents through the diode pairs to its neighbours, the input
   pair at the bottom, the output pair at the top, the bottom capacitor
   half the others (the schematic's 18 nF against 33 nF, under 0.2 % from
   half in the poles). Linearised, its characteristic polynomial is his
   `s⁴ + 6.727 s³ + 14.142 s² + 9.514 s + 1` exactly, and the direct test
   pins that. Not a cascade of one-poles with spread corners, not a
   three-pole 18 dB filter.
4. **Resonance is feedback around the ladder.** The output, through a
   one-pole high-pass, is added to the input inside the input pair's
   `tanh`, so input and feedback saturate together. The high-pass stands
   for the hardware's resonance return, two coupling stages (0.1 µF, then
   1 µF) into the 50 kΩ pot and 47 kΩ on the service notes' schematic; its
   corner, `LADDER_FEEDBACK_HP_HZ` at **150 Hz**, is Open303's calibrated
   one-pole image of that return (as TapTools attributes it), not a
   component value, and tacowars sets it by ear. A circuit reduction of
   the return is later work, not assumed. The feedback gain k is
   `LADDER_FEEDBACK_MAX × p`, with p the Reso knob's position on its log
   scale (`log₂(reso / 0.5) / log₂(24)`, 0 at 0.5 and 1 at 12; the default
   0.707 is p = 0.109). `LADDER_FEEDBACK_MAX` starts at **16.5**: the
   linear threshold is 17.0 without the high-pass, and with the one-pole
   model's 17.6 at a 5 kHz cutoff rising to 23.7 at 500 Hz, so the stock
   top of the knob is very close to oscillation at high cutoffs and thins
   as the cutoff falls, and oscillates nowhere. Those thresholds are the
   one-pole model's, not a hardware measurement. tacowars sets the value
   by ear.
   An extended-resonance option (past 17, the Devil Fish's self-resonance)
   is a later ticket and is not exposed now.
5. **Cutoff is ω_c.** The Cutoff knob is Stinchcombe's normalising
   frequency, where the resonant peak stands (1.04–1.19 ω_c at k 12–17).
   At zero resonance the ladder's −3 dB point is three octaves below it
   (0.126 ω_c): the Acid mode is much darker than Lowpass at the same
   Cutoff value, which is the instrument's behaviour, and the docs say so.
   The knob keeps the voice's full range (30 Hz–18 kHz); the stock pot's
   302–2394 Hz is not imposed. The modulation (envelope, wheel, both LFOs,
   key track, lanes) moves the cutoff as it does for the serial modes.
6. **The solver.** Trapezoidal (TPT) discretisation of the four states and
   the high-pass in integrator-memory form (`s = x + h·f`, `s ← 2x⁺ − s`,
   the SVF's own form, so the previous endpoint's derivative is carried in
   the state and the input is read once at the new endpoint), the cutoff
   prewarped with `portableTangent.ts`'s `tanInPlace`, solved each sample
   by a fixed `LADDER_NEWTON_STEPS` with the 4 × 4 Jacobian solve written
   out, starting from `s`. The count and the oversampling come from the
   research's matrix, not from one reading: two steps hold −80 dBr only up
   to a 5 kHz cutoff at 1×, and at 18 kHz with a hot input Newton does not
   converge at all. Two candidates meet the whole knob range, and the
   engine ticket implements both behind constants, benches them and
   measures their aliasing across the range, then ships one and says which
   in the PR: **2× with three steps** (−94 dBr at the worst cell; the
   ladder's own up- and down-sampling, the decimator as short as the
   aliasing reading allows), or **1× with four steps and the ladder's ω_c
   capped at 10 kHz** (−148 dBr within the cap; the Acid mode's Cutoff
   then stops opening at 10 kHz, which the docs state). The count stays
   fixed, so every sample costs the same and the goldens are deterministic.
   The diode law is a rational `tanh` in `+ − × ÷` (order chosen by
   measured accuracy against `Math.tanh` and cost), its Jacobian the
   rational's own derivative, never `Math.tanh` or `Math.exp`, so the
   goldens hash the same on arm64 and x64 (`v8-math-platform-drift`).
   Whatever the solver, its output is finite and bounded for any input in
   range, Drive's 64× included, and a test holds it there.
   **Shipped (windsor#573): 1× with four Newton steps and the ladder's
   ω_c held to 10 kHz** (`LADDER_OVERSAMPLE` 1, `LADDER_NEWTON_STEPS` 4,
   `LADDER_CUTOFF_MAX_HZ` 10000), the diode law the [7/6] truncation of
   Lambert's continued fraction for tanh, held at ±1 from |x| = 4.97
   (within 9.7e-5 of `Math.tanh`, its slope within 2e-4; [5/4] is 1.4e-3
   out, [9/8] costs twice as much). On the readings in
   `docs/research/2026-10-04-acid-ladder-filter/` (Apple M1, Node 24.21):
   it costs 243–245 ns a voice-sample against the 2× candidate's 369–370;
   it meets the analog response at the bilinear image exactly (under
   0.01 dB and 0.1°), where the 2× candidate's interpolation and
   decimator put it 0.3 dB and 15° off at a 2 kHz cutoff and far more
   above; it converges to −148 dBr of a 24-step solve at the worst cell
   (−117 at 44.1 kHz), against the 2× candidate's −95 at 18 kHz. The 2×
   candidate aliases less, by 6–19 dB with a full-scale sine across
   500 Hz–10 kHz (−37 against −56 dBr at 10 kHz); from 500 Hz to 2 kHz,
   the stock unit's range, both stay at or under −60 dBr. The Acid mode's Cutoff therefore stops
   opening at 10 kHz, where the ladder's zero-resonance −3 dB point is
   1.3 kHz. The 2× candidate stays selectable through the constants
   (with the cap raised), for a later listen to weigh its aliasing
   against its cost.
7. **Level.** The carrier sum enters the ladder times `LADDER_INPUT_SCALE`
   (the model's 2V_T unit; the research gives H3 at −67 dB for 1 and
   −55 dB for 2 at full scale, k 12) and leaves divided by it, with the
   ladder's inversion undone so the mode has the Lowpass mode's polarity.
   The passband falls with resonance as the circuit's does, 1 / (1 + k)
   at high cutoffs and less at low ones where the high-pass returns the
   bass; no makeup. Both values are tacowars's to set by ear; the voice's
   Drive stage before the filter is how a patch pushes the ladder harder,
   and no new knob is added.
8. **Where it lives.** `worklet/fm/ladder.ts`: `Ladder`, the states, the
   per-block coefficients, `process()` over a `point` field (the sample in
   and out, so no double crosses the call, rule 2), `reset()` and
   `static quiet()` (every state under `DORMANT_FILTER_STATE`);
   `worklet/fm/voiceLadder.ts`: `updateVoiceLadder`, the control-rate half
   (cutoff → prewarped step, Reso → k, the high-pass coefficient), as
   `voiceFormant.ts` is the Formant's; the tunables in `fmConstants.ts`
   and the saturator's coefficients in a table file. The voice holds one
   `ladder`, allocated in the constructor and reset in `start`. Both render
   loops gain the same four lines in the filter's branch, after Formant's:
   `point = sig; process(); sig = point` on `FILT_LADDER`, one call, as
   `VoiceDrive.curve` is called, so the kernel's inlining budget is not
   spent on it (the Formant lesson), and both loops are bit-identical by
   construction. `voiceQuiet.ts` asks `Ladder.quiet` in this mode.
   **Shipped (windsor#573), measured:** the ladder is not inlined, but a
   call left in the sample loop cost every other mode about 1.5 ns a
   voice-sample once an Acid voice had played (V8 spills the loop's
   doubles around a call it does not inline). So the loops leave each
   sample in the ladder's `chunk` (`sig` 0 in its place, the fade running
   on as before) and `renderVoiceLadder` (`voiceLadder.ts`) runs
   `point = sig; process(); sig = point` over the chunk after the loop,
   then the steal fade and the pan: one call a chunk from each loop, the
   same lines in both, so they stay bit-identical by construction. The
   serial modes are tested first, so they compare the mode as often as
   before. With an Acid voice in the run the other modes cost 0.1–1.1 ns
   more a voice-sample (LP 24 the most, 3.5 %), and nothing without one.
9. **What pins it.** `ladder.test.ts` (direct): the linearised chain's
   polynomial against Stinchcombe's; the small-signal magnitude and phase
   against the analog expression at the bilinear image, at 500 Hz, 2 kHz,
   10 kHz and the top of the range, k 0, 8 and 16; the chosen Newton count
   against a converged run on the matrix's worst cells (the top cutoff,
   k 16.5, band-limited saw and square at peak 8) through the shipped
   saturator; finite and bounded output on a full-scale noise burst at the
   ceiling; k just under and just over the threshold decays and grows; the
   high-pass lowers the peak at a 500 Hz cutoff against a 5 kHz one; odd
   harmonics appear with level; quiet after a release; `reset` clears
   every state. `synth/fmProcessorFilterLadder.test.ts`
   (the shipped bundle): white noise through the voice against the analog
   response as the Formant test does, the envelope and key track moving
   the peak, Slope and Vowel unheard, a voice ending after its release.
   `fmProcessorKernel.test.ts` gains an Acid scenario; the allocation
   scenario an Acid patch; `fmGolden.json` does not change. The cost bench
   and the aliasing reading go in the research folder.

## Consequences

- One more branch in both render loops and one more class per voice; the
  SVF path is untouched, and the goldens prove it. The ladder's own cost is
  a measurement, not an estimate, and the acceptance includes that every
  other mode costs what it did with an Acid voice in the bundle.
- The Acid mode at zero resonance is three octaves darker than Lowpass at
  the same Cutoff value, and loses bass as resonance rises above a ~1 kHz
  cutoff. Both are the instrument's; a patch compensates with the knob.
- Factory acid patches add rows to the golden, which the sound-design
  ticket refreshes and says so.
- The one-pole 150 Hz high-pass is a calibration of the hardware's
  return, so the resonance thinning at low cutoffs is the model's claim,
  to be confirmed by ear and, if wanted, by a circuit reduction later.
- Deferred: an extended-resonance option; a Reso readout in pot percent
  for this mode; a circuit reduction of the resonance return.

### The tickets

1. **Engine: the Acid Ladder mode** (windsor#573, `worker`, `reviewed`). Owns
   `packages/engine/src/worklet/fm/`, `worklet/generated/`,
   `patch/patch.ts` (the name), `synth/*Ladder*`, the kernel and
   allocation scenarios, `docs/research/2026-10-04-acid-ladder-filter/`
   (the bench, the aliasing and convergence readings), the worklet
   `CLAUDE.md` rows, the skill table, and the console's `filterModeShows`
   in `packages/app/src/patchPanels.ts` with its test (one line each, so
   the mode arrives whole: the mode segment lists `'Acid'` from the
   engine's names the moment the name exists, as Codex's finding 4 noted,
   and tacowars is fine with the mode being selectable early). Decisions
   1–9. Verify: the direct tests, the two filter tests,
   `fmProcessorKernel`, `fmProcessorGolden`, `fmProcessorAllocation`,
   `patchPanels.test.ts`, `node scripts/build-worklets.mjs`, typecheck and
   lint.
2. **Sound design: acid patches and an audition** (`worker`, `reviewed`,
   waits for tacowars's listen): two or three `patches/acid-*.json` (saw
   and square carriers, mono, glide, a snappy filter envelope, Drive to
   taste), a song with a Grid line using accent, slide and tie, the
   golden rows added, and tacowars's values for `LADDER_FEEDBACK_MAX`,
   `LADDER_FEEDBACK_HP_HZ` and `LADDER_INPUT_SCALE` confirmed or changed
   by ear.
3. Later: extended resonance; a circuit reduction of the resonance return.

Ticket 1 makes the mode selectable in the console on every patch, with
no factory patch using it; it may merge on its measurements, and ticket 2
is the listen.
