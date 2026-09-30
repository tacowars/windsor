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

## Reproduce and verify

From this worktree root with Node 24 and its own linked `@windsor` packages:

```sh
node docs/research/2026-09-30-tape-overload-reference/measure.mjs
npx vitest run scripts/lib/tapeOverloadReference.test.mjs scripts/lib/tapeBoundaryReference.test.mjs --no-cache
npm run typecheck
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-overload-reference/*.ts
npm run lint
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-overload-reference/*.{ts,mjs}' scripts/lib/tapeOverloadReference.test.mjs
git diff --check
```

One numerical or test job at a time. #183's matrix is not rerun; its saved
report is read only for the anchor. The decision is
[bounded overload refinement](../../log/2026-09-30-tape-overload-reference-refinement.md).

## Results

**Outcome: both references qualified.** All **8/8 trajectories and 6/6
comparisons** completed in **88.116 seconds**, below the 900-second bound,
with exit code 0, no missing records and no truncated journal. Environment:
Apple M1 arm64, Darwin 25.5.0, Node 24.21.0 / V8 13.6.233.17-node.53,
Float64 source DSP, no browser or audio device. This is numerical
reproduction time, not a real-time or browser cost.

**Anchor held.** Both 1024× trajectories reproduce #183's saved rows
exactly: final M ±1.6944522861437017e-5, state summaries, all 512
raw/full/fixed samples and the complete stage diagnostics. Every one of
the eight trajectories is finite, with zero resets, zero clips, no failure
and no failure-step snapshot. Every record is in
[measurement.json](measurement.json).

The two signs are independently rendered and have identical absolute
errors. The first row is #183's saved result, not rerun here.

| Pair | Raw maximum error | Full maximum error | Fixed-8× (diagnostic) | Raw / full frame |
|---|---:|---:|---:|---|
| 512→1024× (#183) | 6.85460e-7 | 8.98369e-7 | 1.85675e-6 | 143 / 288 |
| 1024→2048× | 2.62047e-7 | 7.47084e-7 | 8.64802e-7 | 273 / 288 |
| 2048→4096× | 7.49728e-8 | 4.47457e-8 | 7.99624e-8 | 143 / 157 |
| 4096→8192× | 3.69236e-8 | 2.35975e-8 | 3.69498e-8 | 143 / 158 |

The finest scheduled triple, 2048/4096/8192×, passes both successive
pairs in raw and in full output, so both signed ±100 pulses qualify at
48 kHz from zero history under the unchanged criterion. The 1024→2048×
pair still misses it (raw 2.6×, full 7.5× over), and is reported only as
trend. The 2048→4096× raw pass has a margin of 1.33×; the finest pair's
margins are 2.7× raw and 4.2× full. No row of this matrix is unqualified.

The error falls by 3.5× raw and 16.7× full from 1024→2048 to 2048→4096,
then by only 2.03× raw and 1.90× full to the finest pair: roughly first
order in step size, far below RK4's smooth-solution rate. This is an
observed trend over three pairs, not a proof of an order or of the
distance to the continuous solution.

### Where the maxima fall

For both finest pairs the raw maximum is at host frame **143**: the state
entering stage 1 of step 585,728 at 4096× and step 1,171,456 at 8192×.
The full-output maxima are at frames 157 (2048→4096×) and 158 (4096→8192×),
whose newest playback states are steps 643,072 at 4096× and 1,294,336 at
8192×. The 1024→2048× maxima instead sit in the return transient, raw at
frame 273 and full at 288 (step 589,824 at 2048×).

Frame 143 is the first host sample after the startup field-zero bracket.
At 8192× that bracket is [142.92047119140625, 142.9205322265625], and the
return bracket is [272.0794677734375, 272.07952880859375]. The largest
returned slope, 5,563,612.742 M units/second, is at stage 2 of step
1,170,806 (time 142.92071533203125), with conditioned H=0.0134953, just
after that zero; its stage increment is 0.0141490. The largest conditioned
derivative is 2,880,344.577 H units/second at time 142.93743896484375.
The source field derivative peaks at 4,888,403.299 host units/second at
frame 143.5. Near frame 143 the sampled raw M alternates in sign with
magnitude about 1.7 from frame to frame as the band-limited pulse rings
through zero.

### Stage behavior at the finest levels

Field-zero, knee and velocity stage-call transition counts are 30, 26 and
252 at every level; series-branch counts rise from 46 at 1024× to 54 at
4096× and 8192×. Irreversible counts are 302/290/292/292 (positive) and
301/289/291/291 (negative) at 1024/2048/4096/8192×. No crossing family is
truncated at any level. The sampled minimum absolute irreversible
denominator increases slightly, 0.004773614 at 1024× to 0.004774805 at
8192×, near time 272.085 in the return; the reversible denominator stays
at least 0.99682672. The peak |M| stage value is 1.8301287 near time
270.466. Final M at 8192× is ±1.694384147775507e-5; DC and remanence are
retained. The two signs' total irreversible stage counts differ widely
(2,710,802 positive and 10,083,603 negative at 8192×) because the
imported equation chooses the positive direction at zero velocity, where
the returned slope is zero; outputs and errors remain sign-symmetric. These
are sampled stage-call transitions, not exact continuous crossings, and
they do not establish a continuous denominator bound.

## Scope and next boundary

This removes one static blocker only: the two zero-history ±100 pulses at
controls 1/0/0, 48 kHz, now have qualified references at 8192×. With #183's
center unit pulses, all four of #178's signed static boundary cases have
references. It qualifies no candidate solver, no rate or history other than
these, no complete input/control domain, and it does not complete
milestone B or authorize dynamic or product work.

**Smallest justified follow-up:** event localization at the measured
maximum. The finest raw error sits at frame 143, immediately after the
startup field-zero crossing bracketed above, and shrinks only about
first-order with step size. A separately declared task could locate that
crossing and the adjacent branch changes within the step and compare
event-aligned against fixed-step error at the same frame, to see whether a
far cheaper reference qualifies. A derivative-consistent conditioning
experiment remains the alternative if localization does not explain it.
Neither is started here. No refinement past 8192× is recommended, and no
bounded-slew field, dH clipping, denominator regularization or modified
equation is implemented.

Still unresolved: RK4/4× at 1/0/1, RK2/8× at 1/0/1 and 1/1/1, dynamic
stability, rapid edits, opposite histories, DC/recovery, and 60-second
44.1/48/96 kHz runs; then resampling and browser cost, delay/bypass
integration and the user's level-matched in-app audition.
