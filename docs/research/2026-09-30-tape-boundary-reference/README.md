# Tape signed boundary reference refinement

Windsor [#178](https://github.com/tacowars/windsor/issues/178) isolates four
unqualified static knee-policy pulses from #167/#169. It refines the unchanged
system and observes its actual RK stages. A complete bounded blocker report
is an allowed outcome; neither finite output nor this task's completion
qualifies a complete input/control domain or completes milestone B.

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
