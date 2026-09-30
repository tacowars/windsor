# Tape candidate solver domain on the signed static boundary cases

Windsor [#197](https://github.com/tacowars/windsor/issues/197) turns the four
qualified signed static references into the first candidate facts of
milestone B: which cheap fixed-step solvers survive signed overloads on the
unchanged knee system, up to what input level, and how accurate they are
where a qualified ruler exists. It is research only, a child of
[epic #146](https://github.com/tacowars/windsor/issues/146). It selects no
product solver, domain, default, mode or cost, and implements no new system.
A survival map with no accurate candidate is a valid outcome.

The equation is Jatin Chowdhury's GPL-3.0-only adaptation at revision
`604372e4ffd9690c3e283362e4598cb43edbb475`. The unchanged core,
[AUDIT](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING) remain read-only, as do the
continuous reconstruction, knee conditioning and its chain derivative, the
RK2/RK4 stage arithmetic, playback kernel and magnitude-20 state guard. This
is separate from the shipping Tape effect's CC0 REELS adaptation, and none of
it is product code.

## Declared experiment before reproduction

[`candidateConstants.ts`](candidateConstants.ts) is the only new table.
Every trajectory is `renderConditioned` from
[#167's conditioning source](../2026-09-30-tape-conditioning/conditioning.ts),
unchanged, on `pulseField`/`subgrid`, with the phase-3 loader and report
writer and #167's journal recovery. [`evidence.mjs`](evidence.mjs) adds only
an observer, the ruler anchors, the error/frame computation, the gates, the
survival map and the outcome. The observer wraps the core's `slope` method
to record the largest returned slope and accepted |M|; it returns the same
value and changes no arithmetic.

**System.** 48,000 Hz only, `knee` policy only, zero history, the same
512-frame signed pulse as #178/#188: each trajectory starts at M=0, carries
its level on frames 128–255 and returns to zero at 256. Polarity is applied
once, in the field; the driver's `amplitude` and `sign` are 1. No reset,
restart, event alignment, new solver or new conditioning policy.

**Candidates.** Eight fixed-step settings: `rk2` and `rk4` at **1, 2, 4
and 8×** steps per host sample. The field is built once per level on the 8×
stage grid; coarser settings take exact integer subgrids.

**Part 1, accuracy (32 trajectories).** All eight settings on the four
qualified cases, controls 0.5/0.5/0.5 at ±1 and controls 1/0/0 at ±100.
The rulers are read only and identified before any error is computed:

| Cases | Ruler rows | SHA-256 of the file | Final M |
|---|---|---|---|
| 0.5/0.5/0.5 ±1 | 1024× in [boundary measurement](../2026-09-30-tape-boundary-reference/measurement.json) | `36b14170b77f9524c77db4791b503c91a4d564db78904c971554c4e7b0daf253` | ±0.05341405966564157 |
| 1/0/0 ±100 | 8192× in [overload measurement](../2026-09-30-tape-overload-reference/measurement.json) | `df4a56a3bf741dad92dd29156556effbfc0dd9a0181740a1da8541773a3df2e9` | ±1.694384147775507e-5 |

A hash or final-M mismatch, or a missing or invalid ruler row, is a failed
anchor: it is reported and no setting passes that case. The criterion is the
existing **candidate limit 1e-5**: maximum absolute raw and full-output
difference in magnetization units over all 512 host frames, with no makeup
gain, DC removal, fitted gain, phase or time fitting, or reset. The frame of
each maximum is recorded (the first, if tied). A setting **passes** a case
only if its trajectory is finite, with zero resets, zero clips and no
state-guard failure, the anchor holds, the run is complete, and both raw and
full errors are at most 1e-5. A nonfinite, reset, clipped, guard-failed,
missing or duplicated trajectory never passes.

**Part 2, survival (256 trajectories).** Controls 0.5/0.5/0.5 and 1/0/0 at
levels **±1, ±2, ±4, ±8, ±16, ±32, ±64 and ±100**, all eight settings. Each
trajectory records: finite or not, resets, clips, the state-guard failure
index and host time (index ÷ factor), peak accepted |M|, peak returned
|slope| (M units per second, with a count of nonfinite returns), and final
M, which after a failure is the last accepted state. **Survival** means
finite with zero resets, zero clips and no failure, and is reported as
exactly that. No accuracy is claimed at a level without a ruler. Per setting
and control the report gives the largest |level| at which both signs
survive, the contiguous surviving range from ±1, and whether survival is
monotone in level. A non-monotone row is reported, not smoothed.

Resets and clips are structurally zero on this path: `renderConditioned`
never calls the core's `tick`/`reset`, and the imported step aborts on the
state guard instead. They are recorded and gated anyway.

**Ladder and stop rule.** Part 1 first, then part 2 level-major ascending
(level, then control, then sign, then setting): **288 trajectories**. One
sequential numerical child runs under a hard **900-second wall-clock
bound**, killed by the parent at the limit. The ruler anchors are journaled
first, then each trajectory on completion; recovery keeps partial groups,
missing identities and a truncated tail, and the report is assembled
afterwards with no new numerical work. No retry, extension or overlapping
job. Every trajectory is at most 8×, so the matrix is expected to take well
under a minute; completion is still not promised, and an expired run's
inventory is the result.

**Anchors to report.** The 1/0/0 ±100 pulses at RK4/16× aborted in #183 at
substep 4369, host time 273.0625, on the state guard; candidates at 8× and
below are expected to abort too, and the report says whether they do, when,
and with which state. The center ±1 cases at RK4/8× should be finite; their
errors against the 1024× ruler are new numbers, not adjusted expectations.

**Outcome.** For each qualified case, the settings that pass 1e-5. For each
control, the surviving level range per setting. Then one input
recommendation for milestone D, as a fact about these controls and this
unchanged system, not a default or a solver choice.

A pre-run check, not part of the matrix, confirmed that `renderConditioned`
at RK4/1024× on the center +1 case reproduces #183's saved 1024× raw and
full samples and final M exactly, so the candidates and the rulers are the
same system and arithmetic.

## Reproduce and verify

From this worktree root with Node 24 and its own linked `@windsor` packages:

```sh
node docs/research/2026-09-30-tape-candidate-domain/measure.mjs
npx vitest run scripts/lib/tapeCandidateDomain.test.mjs scripts/lib/tapeOverloadReference.test.mjs --no-cache
npm run typecheck
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-candidate-domain/*.ts
npm run lint
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-candidate-domain/*.{ts,mjs}' scripts/lib/tapeCandidateDomain.test.mjs
git diff --check
```

One numerical or test job at a time. No earlier matrix is rerun; the rulers
are read from their saved reports. The decision is
[candidate domain](../../log/2026-09-30-tape-candidate-domain.md).

## Results

**Run.** Complete: 288 of 288 scheduled trajectories in 0.701 seconds,
exit 0, not expired, no truncated tail, nothing missing. Apple M1 arm64,
Darwin 25.5.0, Node v24.21.0, V8 13.6.233.17-node.53, Node Float64 source
DSP, no browser. [`measurement.json`](measurement.json) records the SHA-256
of this folder's sources and of every imported source.

The child was run four times, each under a second. The first run failed
all four anchors, so every part 1 error was null: the anchor check read
ruler validity from the top level of a row, where those rows keep it under
`state`. The second followed that fix, and the third followed a Prettier
pass so that the recorded source hashes match the committed files. A
fourth followed review, once `measure.mjs` hashed the whole import closure
rather than part of it. All four produced bit-identical trajectories, and
the second to fourth identical errors, anchors and outcome. No setting,
level, limit or case changed between them.

**Anchors held.** Both ruler files match their SHA-256, and the final M
values are exactly ±0.05341405966564157 (1024×) and ±1.694384147775507e-5
(8192×). Every saved trajectory is exactly sign-symmetric, and part 2's ±1
center and ±100 extreme trajectories are identical to part 1's.

### Part 1: no setting passes any qualified case

Center cases, 0.5/0.5/0.5 ±1 against the 1024× ruler. Both signs give
identical errors; the host frame of each maximum is in brackets.

| Setting | Raw max error | Full max error | Pass |
|---|---|---|---|
| RK2/1× | 2.95477e-1 [144] | 2.82177e-1 [160] | no |
| RK2/2× | 4.76584e-2 [272] | 3.39931e-2 [288] | no |
| RK2/4× | 6.95616e-3 [272] | 5.53215e-3 [161] | no |
| RK2/8× | 1.38235e-3 [272] | 1.41004e-3 [161] | no |
| RK4/1× | 4.82148e-2 [272] | 5.91247e-2 [288] | no |
| RK4/2× | 2.91839e-3 [273] | 3.21115e-3 [288] | no |
| RK4/4× | 3.06460e-4 [275] | 2.95887e-4 [292] | no |
| RK4/8× | 4.32910e-5 [273] | 3.99037e-5 [289] | no |

All sixteen center trajectories survive. The best, RK4/8×, is 4.3× over
the 1e-5 limit raw and 4.0× full, with its maxima after the return at
frame 256.

Extreme cases, 1/0/0 ±100 against the 8192× ruler. All sixteen
trajectories abort on the magnitude-20 state guard during the startup
transient, before the return, so no error is computed and none passes.
#183's RK4/16× run aborted later, at host time 273.0625, in the return.

| Setting | Guard substep | Host time | Last accepted M (+100) |
|---|---|---|---|
| RK2/1× | 137 | 137 | 5.557 |
| RK2/2× | 281 | 140.5 | −1.839 |
| RK2/4× | 562 | 140.5 | −13.02 |
| RK2/8× | 1142 | 142.75 | −14.03 |
| RK4/1× | 138 | 138 | −15.10 |
| RK4/2× | 278 | 139 | 4.339 |
| RK4/4× | 567 | 141.75 | 1.276 |
| RK4/8× | 1143 | 142.875 | −19.01 |

The −100 trajectories abort at the same substep with the opposite state.
The ruler's raw output never exceeds 1.830 in |M|.

### Part 2: survival map

Largest |level| at which both signs survive. Every row is monotone in
level: each setting survives every level up to its largest and fails every
level above it. No returned slope was ever nonfinite; every failure is a
state-guard abort, and resets and clips are zero throughout.

| Setting | 0.5/0.5/0.5 | 1/0/0 |
|---|---|---|
| RK2/1× | ±16 | ±4 |
| RK2/2× | ±64 | ±16 |
| RK2/4× | ±64 | ±16 |
| RK2/8× | ±64 | ±16 |
| RK4/1× | ±16 | ±4 |
| RK4/2× | ±64 | ±8 |
| RK4/4× | ±100 | ±16 |
| RK4/8× | ±100 | ±32 |

Survival is not accuracy. Surviving trajectories reach a peak |M| of up to
15.94 (RK2/1× at 0.5/0.5/0.5 ±16) against the guard at 20, while the
qualified ±100 ruler never exceeds 1.83. Per-level peak |M|, peak slope,
final M and failure index and time are in `measurement.json` under
`survival`.

### Outcome for milestone D

- **Accuracy.** No candidate passes 1e-5 at any of the four qualified
  cases. At the center the errors fall as the step shrinks, but RK4/8×
  still misses by about 4×. At ±100 no candidate survives long enough to
  be compared.
- **Survival.** With every candidate surviving, the unchanged knee system
  can be given input up to ±16 at 0.5/0.5/0.5 and up to ±4 at 1/0/0, so
  **±4** covers both controls. Nothing survives ±64 or ±100 at 1/0/0, and
  only RK4/8× survives ±32 there.
- **Recommendation.** Since no candidate survives ±100 at 1/0/0, the
  product must either bound the field before the core or use a conditioned
  system. Choosing between those is a milestone D decision and is not made
  here. No default, solver or domain is proposed.

Milestone B remains incomplete. Unresolved: RK4/4× at 1/0/1, RK2/8× at
1/0/1 and 1/1/1 on tones, 44.1 and 96 kHz, opposite histories, dynamic
stability, rapid edits, DC/recovery and 60-second runs.
