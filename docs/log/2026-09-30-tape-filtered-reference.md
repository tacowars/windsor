# Qualify a continuous reconstructed and filtered Tape reference

Windsor #150 continues #148's diagnosis without changing shipping audio or
either previous experiment. It follows
[the greenfield direction](2026-09-30-tape-greenfield-direction.md).

## Decisions

1. Use the continuous Blackman-windowed sinc underlying #145's FIR as a
   defined reconstruction kernel. Normalize its continuous integral once,
   independently checking normalization refinement. Host samples before
   time zero are zero. Evaluate both field and its actual derivative from
   this same finite convolution at every RK stage. This removes the
   alpha-transform's inconsistent derivative from the new reference.
2. Define playback as a second continuous convolution with that kernel.
   Refine RK4 integration and output quadrature together at 16×/32×/64×.
   The reconstruction itself has no interpolated grid approximation: kernel
   and derivative evaluations are direct at each requested stage.
   Independently hold output observation at 8× while refining integration,
   and retain raw magnetization refinement as a third diagnostic family.
3. Require two successive passing refinement pairs over all 72 normal
   cases, retaining #148's -70/-60 dB margins, -80 dB settling gate and
   eight/sixteen-period quiet-low-tone observation. No reset or silent
   substitute can qualify. Amplitude-4 and signed discontinuity probes
   remain separate from the normal domain. The bounded run is these three
   levels; any remaining failed case is a blocker, not an implicit request
   to relax a gate or discard that case.
4. Keep RK2/RK4 at 1×/2×/4×/8× and the unchanged alpha path as comparisons.
   The consistent 1× candidate still samples both filters; the old 1× path
   bypasses them. Align only the independently verified 32-host-sample
   fixed pair delay, including that explicit old-1× difference.
5. Keep gain, DC and nonlinear phase in residuals. Separately report
   reconstruction versus analytic input, playback's intended effect,
   output quadrature and the old fixed-alpha integration anchor. These
   waveform differences have different denominators and are not an
   additive error budget or isolated alias measurements.
6. Preserve the GPL-3.0-only CHOW equation's provenance and previous
   independent integral-moment tests. The new kernel/driver are original
   numerical work; no upstream dependency code is imported. This remains
   self-convergence on a declared system, not physical machine calibration.

## Verification boundary

Independent checks cover the continuous kernel versus #145's separately
coded FIR, the derivative versus finite differences, an exactly integrable
cubic trajectory with physical-time scaling, and identity-core impulse
response versus Simpson quadrature. Tests reject a reversed or mismatched
derivative, missing rate scale, coarse integration, faulty alignment,
gain fitting, reset/silent output and incomplete refinement/settling.
Opposite histories, DC and block endpoints remain observable.

Results, reproduction, declared ranges and remaining candidate failures
are in [the research report](../research/2026-09-30-tape-filtered-reference/README.md).
No conditioning policy, product solver, quality mode, CPU claim, audible
approval, schema change or golden update is made by this experiment.

## Outcome

All three new families pass 72/72 normal cases. The full filtered family's
worst two successive residuals are -92.85/-104.03 dB. The old full-alpha
30/72 result is preserved as historical evidence, not upgraded by this
different reference. Consistent RK4 at 2×/4×/8× and RK2 at 8× meet the
declared normal waveform targets; consistent RK2/4× still fails the unit
high/two-tone cases. No product setting is selected from these numbers.

The periodic amplitude-4 references converge, but both solvers fail at
1× on the high-tone overload. Reconstructed ±8/±100 step pulses exceed
the unclipped input domain and abort. The next boundary is explicit
input/control conditioning and stability, followed by resampling response
and realistic browser cost. Qualification here does not erase those tasks.
