# Tape signed overload reference refinement

Windsor [#188](https://github.com/tacowars/windsor/issues/188) bounds the one
static blocker that [#178](https://github.com/tacowars/windsor/issues/178) /
[PR #183](https://github.com/tacowars/windsor/pull/183) left: the two signed
extreme knee-policy pulses, controls 1/0/0 at levels +100 and -100, 48 kHz.
Their 512→1024× raw/full errors, 6.85460e-7 and 8.98369e-7, miss the 1e-7
precision criterion by roughly 7× and 9×. This task extends the same
unchanged system four factors finer. It is research only, a child of
[epic #146](https://github.com/tacowars/windsor/issues/146), milestone B.

The equation is Jatin Chowdhury's GPL-3.0-only adaptation at revision
`604372e4ffd9690c3e283362e4598cb43edbb475`. The unchanged core,
[AUDIT](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING) remain read-only, as do the
continuous reconstruction, knee chain derivative, RK4 integrator, playback
kernel and magnitude-20 state guard. This is separate from the shipping Tape
effect's CC0 REELS adaptation.

## Declared experiment before reproduction

Only the constants table differs from #178.
[`overloadConstants.ts`](overloadConstants.ts) spreads #183's `BOUNDARY`
and replaces its ladder and cases; every #183 function runs unchanged with
that table passed as its parameter: the instrumented renderer, stage
diagnostics, `trial`/`compare`/`group`/`complete`/`assemble`, the phase-3
loader and report writer, and the journal recovery.
[`evidence.mjs`](evidence.mjs) exists only because #183's `baselineCheck`
is bound to #178's table and #169's baseline and cannot take this one. It
adds the 1024× anchor, the location of each maximum, and the outcome
classification. None of it computes a new residual.

At 48,000 Hz, render the `knee` policy for controls 1/0/0 (drive/width/
saturation) at signed levels +100 and -100 host units. Each independent
trajectory begins at M=0 with zero negative history, has 512 host frames,
carries its level on frames 128–255 and returns to zero at 256. Polarity is
applied once, in the field; the driver's `amplitude` and `sign` are 1. No
state is restarted at the return.

The fixed RK4 ladder is **1024, 2048, 4096, 8192×** steps per host sample,
visited factor first, ascending, both cases at each level: **eight primary
trajectories and six adjacent comparisons**, three per case. There is no
adaptive ladder, early stop, extra rate, case or factor, candidate render
or new conditioning policy. The field and its per-host-sample derivative
are built once per case on the 8192× stage grid; coarser levels select
exact integer subgrids.

Raw M and full playback are compared at all 512 host timestamps, including
startup, DC, remanence and the playback tail, in magnetization units. A
reference **qualifies** only if both successive pairs of the finest
scheduled triple, **2048→4096× and 4096→8192×**, have maximum absolute raw
and full-output difference **<= 1e-7**, all three trajectories are complete,
finite and at zero resets/clips, the run is complete and the anchor holds.
The 1024→2048× pair and any earlier passing pair are reported separately
and cannot qualify. Missing, failed, timed-out or partial trials have null
errors and never pass. There is no gain/DC removal, fitted gain, phase or
time alignment, makeup or reset. If 8192× is insufficient the criterion is
not loosened and 16384× is not added.

The fixed-8× observation selects exact state subgrids before the same
playback operation. Its errors are diagnostic and never replace either gate.
Stage diagnostics are #183's: actual RK stage states including both
midpoints, original/conditioned H and dH/dt, both denominators, branch and
crossing families, extrema, failure snapshots, startup [128,160] and return
[256,288] windows and a 256-record cap per crossing family. Each comparison
also records the host frame of its raw and full maxima, and the integration
step on both grids whose stage-1 input state that frame samples. For full
output that step is the newest state in the playback sum.

**The 1024× anchor.** Both 1024× trajectories must reproduce #183's saved
1024× rows in [its measurement](../2026-09-30-tape-boundary-reference/measurement.json),
read only: final M exactly ±1.6944522861437017e-5, and identical state
summaries, all 512 raw/full/fixed samples and the complete stage
diagnostics. The anchor is checked and journaled as soon as the 1024×
level finishes. A failed anchor invalidates qualification; it is reported,
not adjusted.

**Stop rule.** One sequential numerical child runs under a hard
**900-second wall-clock bound** covering field construction, integration,
diagnostics, comparisons and journal writes; the parent kills it at the
limit. Each trajectory and comparison is journaled on completion. Recovery
keeps partial groups, missing identities and a truncated tail, and the
report is assembled afterwards without numerical work. No retry, factor
extension or overlapping job. #183's ladder took 26.973 s for 28
trajectories; 8192× costs about eight times a 1024× trajectory and its
field is about 8.4 M Float64 (H, dH) pairs per case. Cost is unmeasured and
completion within the bound is not promised; if the run expires, the
incomplete inventory is the result.

**Outcome.** Exactly one of: both references qualified; one qualified; or
neither qualified, with the finest measured errors and the trend from
512→1024× onward. Each case also carries a verdict that separates a
finite precision miss from a state failure, missing work, or a run whose
pairs pass but which cannot qualify. Completion and qualification are
reported separately.
