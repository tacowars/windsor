# Separate the Tape equation, integration and reconstruction references

Windsor #147, milestone A of #146, adds an isolated experiment in
`docs/research/2026-09-30-tape-reference/`. The shipping phase-2 baseline
(`c83564f`) and merged #145 prototype/evidence (`1c1e52f`) stay unchanged.
No song/patch format, golden, dependency or product control changes.

## Decisions

1. Keep the original equation and default internal control mapping. Check
   evaluation independently with integral moments of `exp(q*u)` rather than
   comparing the same coth/Taylor evaluation at two rates. Test both signs,
   the irreversible branch, zero derivative and the origin's closed-form
   susceptibility. This is numerical validation, not physical calibration.
2. Refine the analytic continuous-input solution at 16×/32×/64×. Separately
   freeze the original 4× alpha-transform endpoints and refine integration
   within each interval at 8/16/32 subdivisions, with and without the
   unchanged FIRs. Independently interpolated field and derivative are a
   diagnostic forcing, not a consistent continuous-input reconstruction.
3. Retain the original full-path 16×/32×/64× convergence and both candidate
   solvers at 1×/2×/4×/8×. A continuous-input reference does not automatically
   qualify the full filtered path. Every family carries its own gate.
4. Keep the -70 dB low/mid and -60 dB high/two-tone reference margins. Normal
   amplitude is 0.01/0.25/1 at default controls; amplitude 4 and abrupt steps
   are overloads. Include both excitation polarities at all three host
   rates. Failed gates remain visible, with no post-reset output accepted
   as an accurate reference.
5. Preserve unfitted residuals, aligning measured fixed FIR delay only.
   Gain/phase projections, spectral other-bin energy and full-versus-raw
   filter-path differences are separate diagnostics, not corrections or
   an additive dB error budget. Two-tone energy includes intended IMD.
6. Check settling independently of step refinement. Most cases compare
   one versus two periods. A pilot caught -77.95 dB change between four and
   eight periods for the quiet low tone, so that case compares eight versus
   sixteen periods instead. Retain its one-period result and require the
   same -80 dB settling gate. This extends observation, not the allowed
   residual or a smaller test domain.
7. Keep this increment small: no candidate conditioning, resampler redesign,
   cost benchmark, browser tooling, smoothing, DC wrapper or shipping mode.
   Future conditioning must qualify before quality selection and integration.

## Verification and limitations

The focused tests include negative controls for equation mutations, coarse
integration, reset/silence qualification, alignment/gain errors, a folded
alias and settling leakage. They exercise tiny/zero/DC behavior, opposite
remanent states and first/last samples of abrupt block transitions. The
single reproduction command, complete per-trial evidence, measured results
and remaining prerequisite failures are in the research README.

The equation implementation and mapping remain shared with #145; integral
quadrature is an independent evaluation check, not independent physical
model evidence. Refinement is empirical, not a rigorous global error bound.
The inspected CHOW code's GPL attribution and licence remain in #145's
research folder and are referenced by the new driver; no additional upstream
or submodule code is imported.

## Outcome

Analytic and both frozen-forcing references pass all 72 normal cases. The
full prototype passes 30/72 under the two-successive-pairs rule; its worst
32×/64× residual remains -57.82 dB. This is a visible prerequisite failure,
not approval of 64× as universal ground truth. The worst normal RK4/4× case
has -74.70 dB integration error under fixed filtered forcing but about
-34.05 dB raw reconstruction error, directing the next research task toward
consistent field/derivative reconstruction rather than a solver upgrade alone.
The full filtered reference must still qualify before certifying product
residuals; neither a quality setting nor an integration task is approved here.
