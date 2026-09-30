# Tape signed boundary reference refinement

Windsor [#178](https://github.com/tacowars/windsor/issues/178) isolates four
unqualified static knee-policy pulses from #167/#169. The fixed refinement
qualifies both center unit pulses at 48 kHz, while both extreme pulses still
miss the unchanged precision target. The complete report preserves their
coarse failures. No complete input/control domain is qualified, and milestone
B remains incomplete.

The equation is Jatin Chowdhury's GPL-3.0-only adaptation at revision
`604372e4ffd9690c3e283362e4598cb43edbb475`. The unchanged core,
[AUDIT](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING) remain read-only. This is
separate from the shipping Tape effect's CC0 REELS adaptation.

## Declared experiment before reproduction

At 48,000 Hz, render the existing `knee` policy for center controls
0.5/0.5/0.5 at signed levels +1 and -1, and controls 1/0/0 at +100 and -100.
Each independent trajectory begins at M=0 with zero negative host history,
contains 512 host frames, applies its signed host level on frames 128–255,
and returns to zero at 256. Signed input carries polarity once; amplitude
and sign in the shared driver are unity. No state is restarted at the return.

The fixed RK4 ladder is 16/32/64/128/256/512/1024×, visited factor first and
then all four signed cases. There are exactly **28 primary trajectories**
and **24 adjacent comparisons**, with no early-success stop, adaptive
extension, candidate render or additional rate/policy. Field values and
per-host-sample derivatives are evaluated directly using the existing
continuous reconstruction on the finest stage grid; coarser grids select
exact integer subgrids. The imported knee chain derivative is applied at
every stage after converting the derivative to per-second units.

Raw M and full playback are compared at every one of the 512 host timestamps,
retaining startup, DC, remanence and playback tail. Both successive pairs
of the **finest scheduled triple, 256/512/1024×**, must each have maximum
absolute raw and full-output error <=1e-7 in magnetization units. All three
complete trajectories must be valid with zero resets/clips and the run must
be complete. Earlier passing triples are diagnostic and do not replace the
finest triple. Invalid or missing comparisons are null and never pass.
There is no gain/DC removal, fitted phase/time alignment or makeup. The
precision criterion is unchanged, conservative and not an audibility limit.

The imported playback kernel and normalization stay fixed. Full output
refines its convolution quadrature with the integration grid. Separate
fixed-8× observations select exact state subgrids before that same playback
operation, isolating integration changes under a fixed observation. Their
errors are diagnostic and cannot substitute for the raw/full gates.

The numerical child has a hard **900-second wall-clock bound**, including
field construction, integration, diagnostics, comparisons and journal writes.
The parent kills it at the limit. Every completed trajectory and comparison
is journaled immediately. Recovery preserves missing identities, partial
case groups and a truncated final journal record. Final report assembly uses
saved residuals only and does no additional numerical work. There is no
automatic retry or refinement beyond 1024×. Report completion and numerical
qualification are separate. Reproduction runtime is not a real-time CPU result.

## Stage diagnostics and verification

The original core supplies every returned slope, and the original `step`
supplies every RK update and abort. An observer receives the actual four
stage magnetizations, including distinct second/third midpoint trial states.
A read-only equation diagnostic reports Q, Langevin difference, direction,
irreversible activation and both denominators. It does not drive integration.
Original/conditioned field and derivative, returned/predicted slope, stage M
and stage increment carry the step, stage and host time.

Whole-trajectory extrema and branch counts are retained. Field-zero,
|H|=1 knee, velocity-direction, irreversible and |Q|=0.01 series-branch
transitions receive bounded details in startup [128,160] and return
[256,288]. Each family retains at most 256 records per trajectory, with
total, window-total and truncated counts. Actual failure-step stages are
retained independently of those caps. These are **stage-call transitions**:
same-time midpoint trial-state changes are explicitly labeled and are not
physical crossing times. Brackets carry an integration-step uncertainty;
no sampled bracket establishes an exact continuous event.

The 12 shared 16/32/64× trials and eight adjacent raw/full comparisons must
match #169's saved summaries, errors and failure indices exactly. Both unit
signs previously showed raw errors 2.790632682927313e-5 then
3.489296650505125e-6, and full errors 2.577993996159475e-5 then
3.537831867905794e-6. Both extreme signs failed 16× at step 4369, host time
273.0625; the surviving 32→64× differences were 1.0601180004735764 raw and
1.165456745942079 full. No extra baseline trajectories are rendered inside
the primary experiment.

Focused verification uses eight short synthetic 64-frame trajectories for
exact equivalence (four original, four instrumented), derivative-negative
controls, a deliberately failing stage fixture, independent equation terms,
independent known-state Blackman-sinc convolution, capped diagnostics and
interrupted-journal/qualification fixtures. These are software verification,
not an additional input-domain reference qualification or cost benchmark.
The saved-report test independently recomputes every residual and gate.

## Reproduce and verify

From this worktree root with Node 24 and its own linked `@windsor` packages:

```sh
node docs/research/2026-09-30-tape-boundary-reference/measure.mjs
npx vitest run scripts/lib/tapeBoundaryReference.test.mjs scripts/lib/tapeConditioning.test.mjs scripts/lib/tapeFilteredReference.test.mjs --no-cache
npm run typecheck
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-boundary-reference/*.ts
npm run lint
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-boundary-reference/*.{ts,mjs}' scripts/lib/tapeBoundaryReference.test.mjs
git diff --check
```

Use one numerical/test job at a time. CI runs full verify; the local checks
above are the issue's focused slice. The decision is
[bounded boundary refinement](../../log/2026-09-30-tape-boundary-reference-refinement.md).
A new slew-bounded model, event-aligned integration, denominator regularization
or equation change requires a separately declared experiment. This task
introduces none of them. Dynamic smoothing, rapid edits, DC/long-duration
stability and signed recovery remain later work, as do resampling/browser
cost, delay/bypass integration and the user's level-matched in-app audition.

The earlier qualified static tone rows remain historical anchors. In
particular, RK4/4× misses high-bin corners at 1/0/1, and RK2/8× at 1/0/1
and 1/1/1. Boundary-reference refinement cannot resolve these candidate
accuracy misses or choose a product solver/control domain.

## Results and remaining work

All **28/28 primary trajectories and 24/24 comparisons** completed in
**26.973 seconds**, below the 900-second limit, with no missing records or
truncated journal. Environment: Apple M1 arm64, Darwin 25.5.0, Node 24.20.0 /
V8 13.6.233.17-node.53, Float64 source DSP, no browser or audio device.
The 12 shared trial summaries and eight raw/full comparison records match
#169 exactly. Recorded source hashes match the measured code. Runtime is
numerical reproduction time, not real-time browser cost.

The following absolute errors apply equally to both independently rendered
signs. Every earlier residual, state and bounded diagnostic is retained in
[measurement.json](measurement.json).

| Case | Pair | Raw maximum error | Full maximum error | Fixed observation error |
|---|---|---:|---:|---:|
| Center ±1 | 256→512× | 7.02444e-8 | 7.01021e-8 | 7.00301e-8 |
| Center ±1 | 512→1024× | 2.95669e-8 | 2.06347e-8 | 2.06450e-8 |
| Controls 1/0/0, ±100 | 256→512× | 7.17042e-5 | 8.96802e-5 | 2.79700e-5 |
| Controls 1/0/0, ±100 | 512→1024× | 6.85460e-7 | 8.98369e-7 | 1.85675e-6 |

The center unit pulses qualify only on the finest 256/512/1024× triple.
The preceding 128→256× pair still misses the criterion (raw 1.40415e-7,
full 1.42339e-7). Their final magnetizations at 1024× are
±0.05341405966564157; DC/remanence was retained. These are finite pulses
that needed finer precision references, not demonstrated unstable inputs.
Qualification here covers these two zero-history cases at this rate only.

Both ±100 pulses still have **no passing reference triple**. Their 16×
trajectories fail at index 4369 (host time 273.0625), matching the earlier
return-transient failure. The remaining 26 trajectories are finite, and all
28 report zero resets/clips. At 1024× the extreme-pulse final magnetizations
are ±1.6944522861437017e-5. Neither finite finer states nor this small final
value replaces full-trajectory qualification: the largest finest raw error
occurs at host frame 143, and full-output error at frame 288. The preserved
16× failures are distinct from the finite finer precision shortfalls.

### Observed stage behavior

For the positive extreme pulse at 16×, the largest conditioned stage
increment has magnitude **13.607657** at host time 272.09375, in the return
transient, with conditioned H=-0.809676. The failure step retains all four
actual stage states, including distinct midpoint M=-19.177135 and
M=-19.972338. All four returned slopes in that step are finite; the
weighted RK4 update exceeds the imported magnitude-20 state guard. The
reported final M=-16.937607 is the last accepted state, not a reset or the
rejected next state. The minimum sampled absolute irreversible denominator
at 16× is 0.000539442, above the imported 1e-9 denominator floor; the
reversible denominator stays at least 0.99682672 for these controls.
These observations do not establish a continuous denominator bound.

At 1024×, the positive extreme pulse's largest conditioned derivative is
**2,877,711.977 H units/second** at time 142.93701171875, with H=0.973388,
inside the knee's identity region. A nearby stage at time 142.9208984375
has H=0.0240898 and a returned slope of 5,562,189.854 M units/second,
for a stage increment of 0.113163. The sampled field-zero brackets are
[142.92041015625,142.9208984375] at startup and
[272.0791015625,272.07958984375] on return. The negative pulse mirrors
these magnitudes and state polarities. Amplitude conditioning therefore
leaves substantial slew near zero in these measured trajectories; this
is evidence to investigate temporal resolution, not proof of the sole
cause, a new slew limit, or a control-smoothing solution.

The extreme-pulse sampled minimum absolute irreversible denominator
increases to 0.004773614 at 1024×. Irreversible stage-call transition counts
fall from 600 at 32× to 302 at 1024×, while field-zero and knee counts are
30 and 26 at both grids. This does not establish exact physical crossing
counts: the record explicitly distinguishes same-time trial-stage changes.
For the positive extreme pulse, the irreversible detail cap truncates
153/95/27 window records at 32/64/128×; for the negative pulse those counts
are 152/94/26. Their total irreversible transition counts differ by one
(positive 600→302, negative 599→301 at 32→1024×): the imported equation
chooses positive direction at zero velocity, where the returned slope
is zero. Numerical output and error magnitudes retain signed symmetry;
branch diagnostics need not have identical counts. Every total/window
count and complete failure-step snapshot is retained. All other families
and remaining factors fit within their caps.

### Bounded next recommendation

The extreme-pulse raw/full discrepancies decrease from 1.06012/1.16546
at 32→64× to 6.85460e-7/8.98369e-7 at 512→1024×, without finer state
failures. This supports **one separately declared finer-reference task**
for controls 1/0/0 at ±100, 48 kHz, keeping the system and gates unchanged:
1024/2048/4096/8192×, eight primary trajectories, with the same hard
900-second bound and two passing finest successive raw/full comparisons.
Its higher cost is unmeasured; completion within the bound is not promised.
If it remains blocked, retain that result and refine an event-localization
or conditioning experiment from its measured error rather than extending
an automatic refinement loop. No such follow-up has been run here.

A bounded-slew model is not justified as an implementation change by this
report alone. If proposed later, it is a new system with its own consistent
derivative and independent reference qualification. The remaining input/
control/history/rate domain, dynamic stability and earlier corner candidate
misses are unresolved; no product domain, solver or cost choice follows.

Verification passed: **33/33 focused tests**, repository typecheck and lint,
standalone strict research typecheck, explicit source Prettier check,
whitespace and owned-file checks. Negative controls retain raw-only/full-only
failures, a final-frame spike, missing/nonconsecutive finest pairs,
nonfinite/reset/clip evidence, null samples, duplicate/missing identities,
wrong chain derivative, distinct midpoint states, capped details and
interrupted journal tails. The saved report's numerical errors are
recomputed with an independent absolute-difference expression.
