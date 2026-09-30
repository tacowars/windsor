# Tape field-event alignment against the 8192× overload ruler

Windsor [#192](https://github.com/tacowars/windsor/issues/192) asks whether
the remaining error of the two qualified signed ±100 overload references
comes from RK4 steps straddling the input field's events, and whether
aligning steps to those events lets a far cheaper factor qualify.
[#188](https://github.com/tacowars/windsor/issues/188) /
[PR #190](https://github.com/tacowars/windsor/pull/190) qualified both
references at 8192× but saw the error shrink only about first order, with
its raw maximum at host frame 143, just after the startup field-zero
crossing. This is research only, a child of
[epic #146](https://github.com/tacowars/windsor/issues/146), milestone B.
It selects no product solver, domain or cost.

The equation is Jatin Chowdhury's GPL-3.0-only adaptation at revision
`604372e4ffd9690c3e283362e4598cb43edbb475`. The unchanged core,
[AUDIT](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING) remain read-only, as do the
continuous reconstruction, the knee conditioning and its chain derivative,
the RK4 stage arithmetic (`step`), the playback kernel, fixed-8×
observation and the magnitude-20 state guard. This is separate from the
shipping Tape effect's CC0 REELS adaptation.

## Declared experiment before reproduction

[`eventConstants.ts`](eventConstants.ts) spreads #188's `OVERLOAD` table
and adds only the ladder, the two methods, the event rules and the gate.

**Cases.** #188's two zero-history cases: `knee` policy, 48,000 Hz,
controls 1/0/0, levels +100 and -100, 512 host frames, level on frames
128–255, return at 256, polarity applied once in the field. Each trajectory
starts at M=0 and is never restarted.

**Ruler.** The saved 8192× row of each case in
[#188's measurement](../2026-09-30-tape-overload-reference/measurement.json),
read only: all 512 raw, output and fixed samples. It is accepted only if
the file's SHA-256 is
`df4a56a3bf741dad92dd29156556effbfc0dd9a0181740a1da8541773a3df2e9` and each
row's recorded final M is ±1.694384147775507e-5. 8192× is not rerun.

**Events,** located on the continuous source field only, with the same
classes #190's stage diagnostics used: the sign of H (field zero), whether
|H| exceeds the knee at 1 (knee edge), and whether dH/dt ≥ 0 (velocity
direction). Each class change is bracketed between adjacent points of the
factor's uniform stage grid (spacing 1/(2F) host frames, the grid the
fixed method samples), then bisected on the direct continuous kernel
evaluation until the bracket is at most 2^-40 host frames wide, stops
narrowing, or 128 bisections are spent. Every event records its kind,
time (bracket midpoint), bracket, width, bisection count and the classes on
each side. The irreversible-branch and series-branch switches depend on
the state and are **not** aligned; for every RK step the actual stage calls
record whether either branch changed inside the step (stages 2–4 against
stage 1) and at which stage, and separately how often stage 1 differs
from the previous step's stage 4 (a change at a node).

**Methods.** `fixed` is #188's uniform RK4 on factor F. `aligned` is the
same uniform grid with every located event inserted as an extra node,
splitting the step that contains it into consecutive RK4 steps. Uniform
nodes are never moved or removed, so the state exists at every uniform
node and playback and fixed-8× observation run unchanged. Unsplit steps
read the cached field exactly as #188 does; split steps evaluate H and
dH/dt directly from the continuous kernel at each substep's start,
midpoint and end, apply the imported knee chain derivative and call the
imported `step` with the substep's own dt. Events closer than 2^-30 host
frames merge into one node, and an event within 2^-30 of a uniform node is
already aligned there and inserts nothing; both are counted.

**Ladder.** Factors **64, 128, 256, 512, 1024×**, both methods, both
cases: **20 primary trajectories**, factor-major and ascending, events
located once per case and factor. The fixed 1024× rows must reproduce
#188's saved 1024× rows exactly (all 512 raw, output and fixed samples and
final M ±1.6944522861437017e-5); a mismatch is a failed anchor, reported
and not adjusted. No adaptive ladder, early stop, extra rate or case,
candidate solver or new conditioning policy.

**Errors and gate.** Every trajectory records, against its case's ruler
row over all 512 host frames, the maximum absolute raw, full-output and
fixed-8× difference, the first frame of each maximum and the error at
frame 143. Criterion unchanged: **1e-7** in magnetization units, with no
makeup gain, DC removal, fitted gain, phase or time fitting, or reset. A
factor F qualifies as a **cheaper reference** for a method only if F and
2F both pass raw and full output for both cases, every such trajectory is
finite with zero resets, clips and failures, the run is complete, and the
anchor and ruler hold. 1024× has no 2F row in this ladder and cannot
qualify. Fixed-8× is never a gate. The observed order per method is
log2(e_F / e_2F) over consecutive factors, per case and observation.

**Attribution.** For every trajectory's raw and full maxima at frame n,
the report counts unaligned inside-step switches in #188's step n·F (the
step whose stage 1 the sample enters) and in the host frame before the
sample, steps [(n-1)F, nF). This is evidence, not a proof of cause.

**Outcome, exactly one,** computed by `interpret` in
[`evidence.mjs`](evidence.mjs):

- **(a)** the aligned method has a qualifying factor cheaper than any the
  fixed method has, and its mean observed order (all consecutive pairs,
  both cases, raw and full) exceeds the fixed method's;
- **(b)** otherwise, if alignment helps materially, the fixed method's
  worst 1024× raw/full error at least **2×** the aligned one, and the raw
  and full maxima of both aligned 1024× trajectories sit at an unaligned
  state switch as defined above;
- **(c)** otherwise: alignment does not change the error materially, or
  does not leave it at the unaligned switches.

**Stop rule.** One sequential numerical child runs under a hard
**900-second wall-clock bound** covering field evaluation, event location,
both methods, switch diagnostics, comparisons and journal writes; the
parent kills it at the limit. Each event set and trajectory is journaled on
completion. Recovery keeps partial groups, missing identities and a
truncated tail, and the report is assembled afterwards without numerical
work. No retry, extension or overlapping job. #188's 1024× trajectory cost
about 6 s; completion is expected but not promised, and if the run expires
the incomplete inventory is the result.

## Reproduce and verify

From this worktree root with Node 24 and its own linked `@windsor` packages:

```sh
node docs/research/2026-09-30-tape-event-alignment/measure.mjs
npx vitest run scripts/lib/tapeEventAlignment.test.mjs scripts/lib/tapeOverloadReference.test.mjs --no-cache
npm run typecheck
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-event-alignment/*.ts
npm run lint
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-event-alignment/*.{ts,mjs}' scripts/lib/tapeEventAlignment.test.mjs
git diff --check
```

One numerical or test job at a time. The tests prove that direct kernel
evaluation equals the cached grid at uniform nodes, that each located
event is a true class change of the continuous field, that insertion never
moves or drops a uniform node and counts merges, that aligned RK4 with no
inserted node equals #183's fixed renderer bit for bit, and that splitting
every 64× step at its midpoint reproduces 128× bit for bit while a wrong
chain derivative or a wrong midpoint stage does not. The decision is
[field-event alignment](../../log/2026-09-30-tape-event-alignment.md).

## Results

**Outcome (b): alignment helps, and the residual sits among unaligned
state switches; no cheaper reference qualifies.** All **20/20
trajectories** completed in **10.265 seconds**, below the 900-second
bound, with exit code 0, no missing identity and no truncated journal.
Environment: Apple M1 arm64, Darwin 25.5.0, Node 24.21.0 /
V8 13.6.233.17-node.53, Float64 source DSP, no browser or audio device.
This is numerical reproduction time, not a real-time or browser cost.
Every record is in [measurement.json](measurement.json).

**Ruler and anchor held.** The ruler file's SHA-256 matches the pinned
`df4a56a3…3df2e9`, and both 8192× rows carry final M
±1.694384147775507e-5. Both fixed 1024× trajectories reproduce #188's
saved 1024× rows exactly: all 512 raw, output and fixed samples and final
M ±1.6944522861437017e-5. All 20 trajectories are finite with zero
resets, clips and failures. The two signs have identical absolute errors,
so one table serves both.

### Errors against the 8192× ruler

Maximum absolute difference over all 512 host frames, magnetization
units; frame of the maximum in brackets; "@143" is the error at frame 143.

| Factor | Method | Raw max | Raw @143 | Full max | Full @143 | Fixed-8× (diag.) |
|---:|---|---:|---:|---:|---:|---:|
| 64 | fixed | 1.348e-1 [143] | 1.348e-1 | 1.465e-1 [160] | 5.516e-7 | 1.465e-1 |
| 64 | aligned | 1.241e-1 [143] | 1.241e-1 | 1.346e-1 [160] | 4.974e-7 | 1.346e-1 |
| 128 | fixed | 1.833e-2 [143] | 1.833e-2 | 1.865e-2 [160] | 1.529e-8 | 1.864e-2 |
| 128 | aligned | 1.555e-2 [143] | 1.555e-2 | 1.562e-2 [160] | 1.190e-8 | 1.561e-2 |
| 256 | fixed | 7.076e-5 [143] | 7.076e-5 | 8.950e-5 [288] | 1.730e-10 | 2.697e-5 |
| 256 | aligned | 6.985e-5 [143] | 6.985e-5 | 8.967e-5 [288] | 2.811e-10 | 2.723e-5 |
| 512 | fixed | 9.459e-7 [143] | 9.459e-7 | 3.933e-7 [159] | 3.151e-10 | 9.967e-7 |
| 512 | aligned | 3.786e-7 [143] | 3.786e-7 | 7.132e-7 [288] | 2.778e-11 | 1.115e-7 |
| 1024 | fixed | 2.604e-7 [143] | 2.604e-7 | 7.158e-7 [288] | 1.341e-10 | 8.600e-7 |
| 1024 | aligned | **2.579e-8** [143] | 2.579e-8 | **3.391e-9** [159] | 6.484e-12 | 6.800e-9 |

**Gate.** No row of the fixed method passes 1e-7. The only passing rows
are aligned 1024×, raw and full, for both cases. That qualifies nothing:
1024× has no 2048× row in this ladder, and aligned 512× misses (raw 3.8×,
full 7.1× over). **Neither method has a cheaper qualifying factor.** The
fixed-8× column is diagnostic only.

**Effect of alignment.** The worst raw/full error falls by a factor of
1.09, 1.19, 1.00, 1.33 and **27.8** at 64, 128, 256, 512 and 1024×. At
1024× the raw error at frame 143 falls 10.1× and the full maximum 211×;
at 512× the raw maximum falls 2.5× but the full maximum rises 1.8×, at
frame 288. Below 512× the error is dominated by the ringing startup: near
frame 143 the raw M swings by about ±1.7 per frame, so a small timing
error is a large sample error, and aligning the field events there changes
it by a factor of at most 1.19.

**Observed order** log2(e_F / e_2F), raw / full, identical for both signs:

| Pair | Fixed | Aligned |
|---|---|---|
| 64→128 | 2.88 / 2.97 | 3.00 / 3.11 |
| 128→256 | 8.02 / 7.70 | 7.80 / 7.45 |
| 256→512 | 6.23 / 7.83 | 7.53 / 6.97 |
| 512→1024 | 1.86 / -0.86 | 3.88 / 7.72 |

Means over all eight entries: fixed 4.58, aligned 5.93. Orders above four
are not RK4 truncation rates; they are the error collapsing as the step
starts to resolve the startup ringing, so the ladder is pre-asymptotic.
The last pair is the telling one: fixed stalls (raw about first order,
full worse), aligned does not.

### Events

Every factor and both signs locate exactly **30 field-zero, 26 knee and
252 velocity** class changes, #190's stage-transition counts at every
level. They agree because the bracket grid is the same stage grid and no
two class changes share a half-step bracket even at 64×, with one benign
exception below. Every event was bisected to a 2^-40-frame (9.09e-13)
bracket: 33 bisections at 64×, falling by one per doubling to 29 at
1024×. Per case and factor, **111 nodes are inserted**, the genuine events
between frames 128.30 and 286.70: 29 field-zero sign changes, 26 knee
crossings and 56 velocity reversals.

The rest lie on uniform nodes and insert nothing. **195 of the 252
velocity changes** sit at integer and half-integer frames from 159.5 to
256.0, where the flat pulse top leaves dH/dt as a roundoff residue of
about 1e-15 per host sample whose sign flips with the reconstruction
phase. That, not field motion, is why #190 counted 252 velocity
transitions. The field-zero onset at frame 128 (and, at +100, one more
roundoff velocity flip at 287) also sits on a node. +100 has one merge,
the roundoff pair straddling frame 256; -100 has two, that pair and the
coincident field-zero and velocity onsets at 128. The last field-zero
sign change, at 286.99999995, shares its bracket with the field's return
to exact zero at 287, which is therefore not recorded separately.

### Unaligned state switches

Inside-step irreversible-branch switches, fixed / aligned at +100: 385 /
384, 356 / 353, 318 / 317, 292 / 291 and 284 / 284 at 64–1024× (-100 has
one fewer, from the equation's positive choice at zero velocity).
Series-branch switches rise 26, 32, 36, 40, 44 for fixed; aligned has
**54 at every factor**, the count #190 reached only at 4096 and 8192×.
Changes between one step's stage 4 and the next step's stage 1, at a
node, are 9, 6, 1, 0, 0 (fixed) and 11, 7, 1, 0, 0 (aligned)
irreversible, and none series. In
the aligned trajectories 30–31 irreversible and 4–15 series switches are
first seen at stage 4 of a substep ending on an inserted node, that is at
an aligned field event; the others (254 irreversible and 50 series at
1024×) are genuinely inside a step.

**Where the aligned 1024× residual sits.** Its raw maximum is at frame 143
and its full maximum at frame 159, for both signs. Neither #188 step
143·1024 nor 159·1024 holds a switch, but the host frame before each does:
two irreversible and two series switches in [142, 143) (one series switch
at the inserted field-zero node 142.92048, the others inside steps), and
one irreversible switch in [158, 159). That satisfies the declared
attribution test, so the outcome is (b).

### Limits of this evidence

- **The attribution cannot discriminate.** Read from the saved records
  after the run: every host frame from 129 to 287 holds at least one
  inside-step switch in every 512× and 1024× trajectory, of either method
  (156 frames). A maximum anywhere in the active pulse would have passed
  the same test. It shows that the residual is not at an aligned field
  event; it does not show that the switches cause it.
- **The aligned 1024× residual is at the ruler's resolution.** Its raw
  error, 2.58e-8 at frame 143, is below #188's own 4096→8192× raw
  difference at that frame, 3.69e-8, and #188 found the fixed method
  converging only about first order there. The remaining difference may
  be as much the 8192× ruler's error as aligned 1024×'s.
- **Alignment is not monotone.** At 512× it raises the full-output error
  at frame 288, the return transient.

## Scope and next boundary

Field-event alignment removes most of #188's frame-143 error at 1024×,
27.8× in the worst raw/full error, where the fixed method stalls, but it
does not change the error materially below 1024× and qualifies no cheaper
reference. Outcome **(b)**: the residual lies among the unaligned
irreversible- and series-branch switches, which this task did not align.
**Smallest justified follow-up:** a state-event localization task that
locates those switches inside a step and splits there, measured against a
ruler finer than the current one, since #188's 8192× rows cannot resolve
the 2.6e-8 that remains. It is not started here.

This qualifies no candidate solver, rate, history or control domain.
**Milestone B remains incomplete, and no dynamic or product work is
authorized.** No bounded-slew field, dH clipping, denominator
regularization, modified equation or new mapping is implemented. Still
unresolved: RK4/4× at 1/0/1, RK2/8× at 1/0/1 and 1/1/1, dynamic
stability, rapid edits, opposite histories, DC/recovery, and 60-second
44.1/48/96 kHz runs; then resampling and browser cost, delay/bypass
integration and the user's level-matched in-app audition.
