# Codex review of the Acid Ladder plan

Date: 2026-10-04. Reviewer: Codex. Recipient: the implementing agent and
tacowars. Scope: the proposed decision record, this folder's README and
prototype, the relevant Windsor integration sources, and the cited circuit
analysis. This is a review of the plan and research, not a shipped engine PR.
Line references below identify the files as reviewed on this date.

The coupled-ladder model is a sound direction, but two numerical issues
need fixing before calling the model verified or freezing the solver.
The continuous-time core checks out: the neighbour coupling, bottom-capacitor
approximation, normalised polynomial, pole spread, and ideal feedback
threshold of 17 agree with
[Stinchcombe's analysis](https://www.timstinchcombe.co.uk/synth/Moog_ladder_tf.pdf).
Keeping the ladder beside the SVF and using the existing cutoff and resonance
controls also fits Windsor's architecture. This agreement establishes the
idealised core, not the accuracy of the complete hardware emulation.

1. **P1: The prototype does not implement the stated trapezoidal discretisation.**
   Location: `model.mjs:226`, the `u0` and `f0` calculations.

   The code recomputes the previous endpoint's derivative using the current
   input and the current high-pass state representation. The `x` array holds
   the previous solved capacitor voltages, not TPT integrator memory. True
   trapezoidal integration needs the previous endpoint's derivative, or
   equivalent TPT integrator memory. Evaluating `hpOf(x[3])` with the advanced
   `hpS` also does not recover the previous endpoint's high-pass output.

   Concrete result: at 48 kHz, cutoff 18 kHz, resonance zero, and a small
   18 kHz sine, the prototype produces **-13.57 dB**, versus **-21.91 dB** for
   the correctly prewarped response: an **8.34 dB error**. This would make
   high-frequency attenuation wrong within the proposed knob range.

   Refutation checks: increasing Newton iterations leaves the error;
   correcting the integration history removes it. At the prewarp frequency,
   the analog and bilinear responses should agree exactly, so ordinary
   bilinear warping cannot explain this discrepancy. With k = 0, the extra
   input factor is `2 / (1 + z^-1)`, whose magnitude is
   `1 / cos(pi * f / sampleRate)`; it predicts the observed 8.34 dB excess.

   Missing test: small-signal magnitude and phase against an independently
   derived discrete transfer function, including high cutoffs and nonzero
   feedback. Fix the integration history and recompute the research tables.

2. **P1: Two Newton steps are inadequate within the advertised range.**
   Locations: `docs/log/2026-10-04-acid-ladder-filter-mode.md:74` and
   `model.mjs:340`.

   The two-step choice rests on one gentle sine test. A 110 Hz band-limited
   saw, harmonics 1 through 127, normalised to peak amplitude 2, with cutoff
   18 kHz, k = 16.5 and sample rate 48 kHz produces a **-15.2 dB peak-relative
   error** between two Newton steps and the converged reference. Its RMS
   error relative to the reference RMS is **-24.9 dB**. The intended acid
   patches explicitly use saw and square carriers; this is a substantial
   waveform error under the proposed range, not a floating-point detail.

   Refutation checks: the input is band-limited (highest partial 13,970 Hz),
   rather than a discontinuous naive saw. Twelve and 24 iterations agree to
   approximately -297 dB by the same peak-relative metric. Correcting the
   integration history still leaves a large two-step error (-13.8 dB
   peak-relative for this saw), so this is separate from finding 1. These
   are prototype measurements, not measurements of the shipped engine.

   Missing test: convergence across cutoff, resonance, level, sample rate,
   band-limited saw and square inputs, and parameter changes. Choose the
   iteration count and any damping or oversampling from that matrix,
   including the final rational saturator and a consistent derivative.
   Merely raising k and amplitude in the existing 1 kHz cutoff sine test
   does not cover this failure.

3. **P2: The schematic justification for the 150 Hz high-pass is incorrect.**
   Location: `README.md:28`.

   The README identifies a 10 nF capacitor and 100 kohm resistor in the
   resonance path. Page 5 of
   [Roland's service notes](https://www.synfo.nl/servicemanuals/Roland/ROLAND_TB-303_SERVICE_NOTES.pdf)
   instead shows multiple coupling stages: C25/C27 are 100 nF, while
   C14/C15/C23 are 1 uF. The 10 nF capacitors shown around the VCA do not
   establish the claimed resonance network. The schematic does confirm C18
   at 18 nF and C19/C24/C26 at 33 nF.

   Refutation check: **150 Hz may still be a useful approximation**.
   [TapTools explicitly attributes it to Open303 calibration](https://timothy.place/TapTools/machine/diode.html).
   This finding does not establish a replacement cutoff or show that 150 Hz
   sounds wrong. It establishes that the claimed component-level derivation
   is not supported by the primary source.

   Concrete consequence: at a 500 Hz filter cutoff, the calculated
   oscillation threshold of 23.7 and the resonance thinning are results of
   the assumed one-pole network. They cannot be used as independent proof
   that the complete hardware feedback path behaves that way. Label 150 Hz
   as a calibrated/lumped approximation unless a circuit reduction supports
   it. The missing validation is a circuit-response or measured-hardware
   comparison, especially at low cutoffs and multiple resonance settings.

4. **P2: The engine-only release is immediately selectable and audible.**
   Location: `docs/log/2026-10-04-acid-ladder-filter-mode.md:154`.

   The claim that nothing clickable or audible changes until a patch is set
   through JSON conflicts with `packages/app/src/patchPanels.ts:313`.
   `buildFilter` passes `FILTER_MODE_NAMES` straight to `indexSeg`, and its
   callback writes the selected index into `filter().mode`. Adding Acid to
   those names immediately exposes mode 6 on existing patches. No factory
   acid preset or manual JSON edit is needed.

   Refutation check: `filterModeShows` only controls which knobs are visible;
   it does not gate the selector. An integration check of the generated
   selector would catch this. Correct the release premise and schedule the
   listen accordingly, or defer exposing the name.

   Note from tacowars: I dont care if it gets exposed early. nobody but me will see it. 

Keep the circuit-core approach, correct the prototype, and reopen the solver
decision. Keep feedback ceiling 16.5 and input scale 2 provisional for
listening. Broaden the planned 2 kHz aliasing check to the full usable cutoff
range before deciding that oversampling can wait. That last point is a
validation recommendation, not a claim that audible aliasing was measured.

The original `node model.mjs` tables were reproduced. Additional numerical
checks are in [review-check.mjs](review-check.mjs), runnable from the repository
root with:

```sh
node docs/research/2026-10-04-acid-ladder-filter/review-check.mjs
```

The check identifies the reviewed `model.mjs` by SHA-256 and refuses a changed
source rather than silently attributing different results to this review:
`fcbb2b6f7b90fe93c5cc79d12c7c617fab0a461564920c932d719c8aea399340`.
It was run with Node v24.21.0. These are numerical accuracy calculations;
no CPU cost or listening verdict is claimed. The history-corrected variant
inside the check is a fixed-parameter diagnostic, not a proposed production
implementation or validation of cutoff modulation. No shipping source,
decision record, original prototype, or golden was changed for this review.
