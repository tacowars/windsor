# Tape knob box at 2×: a raised width minimum

Windsor [#295](https://github.com/tacowars/windsor/issues/295) qualifies a
knob box for the shipped magnetic Tape core at **both** oversampling
factors. The [control-domain record](../2026-10-01-tape-control-domain/README.md)
(#290, PR #294) qualified drive [0, 1], width [0, 0.62], saturation [0, 1]
at 4× only. At 2×, Windsor's default, one trial failed: the 1 s drive sweep
at width 0 and saturation 0 reset twice at every rate. That record explains
the failure by the pole of the irreversible term, whose threshold
k(1 − c)/α rises fast with width. The Advanced panel (#291) must work at
both factors, so this record raises the width minimum and runs the box
again. It also measures the failing region's edge at width 0, to test the
pole explanation. It is **survival, not accuracy**, research only, and
changes nothing under `packages/`.

**Amended by #315.** A second part, [at the end](#windsor315-a-box-that-holds-every-shipped-model-row),
qualifies drive [0.05, 1] × width [0.05, 0.85] × saturation [0, 1] at both
factors on the current core, a box that holds every shipped model row. It
also makes `measure.mjs` exit nonzero on an incomplete or unqualified run.

**Status (2026-10-01, windsor#320): #295's part is historical.** #295's
run (`measurement.json`, `evidence.mjs`, `boxProgram.ts`,
`boxConstants.ts`) measured the shipped core and stage as bundled at
`510c649` (`origin/main` `c15868d` plus this folder's declaration). Its
trials, derivations and declaration stay valid as a record of that code.
They are not re-run and not changed. Three later commits changed files in
its hashed import closure:

- #293 (`634e717`) moved the control glide into the stage, per sample
  (`tapeMagneticStage.ts`, `tapeMagnetic.ts`, `tapeConstants.ts`). Since
  then, the `measure.mjs` path without `--rows`, which renders through
  #290's per-block `runTrial`, no longer moves the controls on today's
  stage.
- #307 (`80b077a`) rescales M when the gain changes
  (`tapeMagnetic.ts`, `tapeMagneticStage.ts`).
- #314 (`6eca799`) added the Advanced controls' plumbing
  (`tapeMagneticRows.ts`, `tapeMagneticStage.ts`, `tapeConstants.ts`).

So `evidence.mjs --check` now **fails, and is expected to**: derived, clean
closure and the exit gate pass; closure fails (those four files' hashes
changed); and none of the three spot re-renders, each a sweep or a walk,
is bit-equal. `evidence.mjs --historical` is the passing check for #295's
part: it re-derives the edge table, each box's gates, the ladder and the
declaration from the saved trials, checks that the saved closure was clean
and that the run names its commit, and runs the exit gate's cases. It
skips the closure re-hash and the spot re-renders.

**Superseded for the shipped box** by #315's part below (the `rows*`
files, merged as `074e599`), which ran on the core after #293 and #307
with every trial checked to have moved as commanded. #314 landed after it
too, so on `6eca799` its `rowsEvidence.mjs --check` also reports a changed
closure, while its three spot re-renders, derivations, motion gate and exit
gate still pass. This note does not change that part.

## What is measured, and what is not imported

The harness is #290's, **unchanged except for the box**. The field program,
the static points, the sweeps, the random walks and the pass criteria are
that record's `CONTROL`, and every trial renders through its `runTrial`.
The core under test is the shipped one, unchanged. See that record's
"What is measured" for the stage, the oversampler and the one research row
the harness writes.

#295 changed one thing in #290's harness: `boxOf` and the two functions
that take a box (`boxTrials`, `runTrial`) now also accept a whole box, so a
width minimum can be passed. A number still means width [0, wMax], so #290's
record is unchanged: its `--check` re-renders its three spot trials
bit-equal after the change, and its `closure` hashes are updated to match.

**No research core.** [`boxProgram.ts`](boxProgram.ts) imports #290's
`program.ts` and nothing else outside this folder. `evidence.mjs` walks
the relative imports from `boxProgram.ts` and records every file it
reaches with its SHA-256. `--check` fails unless every one is under
`packages/engine/src/`, #290's folder or this one. Nothing reaches the GPL
CHOW-derived research core.

## Declared experiment before measurement

[`boxConstants.ts`](boxConstants.ts) holds every new value below. It, the
scripts and this section were committed before the run.

### The box

**drive [0, 1] × width [w_min, 0.62] × saturation [0, 1]**. The width
maximum is #290's, set by its susceptibility rule at drive 0, and is not
re-derived. Raising the minimum only moves the box away from the cap, so
that rule still holds.

### The ladder

The box runs at **w_min = 0.05** first. If any trial fails, it runs again at
**0.1**, then **0.15**, and each is reported. The run stops at the first box
in which every trial survives, and that w_min is declared. The lowest width
a shipped model row uses is 0.13 (Chrome). A box at 0.15 would leave that row
outside the panel's range, and is flagged prominently if it is needed.

Each box is #290's whole part B, per rate and factor (313 trials, **1,878**
per box):

- **277 static points**: the 8 corners, 12 edge midpoints, centre and the
  same 256 R3 interior points (seed 290), mapped into the new box;
- **24 sweeps**: each control end to end and back in 50 ms and in 1 s, the
  other two at each of their four corners;
- **12 random walks**: glide-1s, glide-50ms and jump-50ms at seeds
  2901–2904, uniform in the new box;
- at **2× and 4×**, at **44.1, 48 and 96 kHz**.

### The width-0 edge

Along **width ∈ {0, 0.01, 0.02, 0.05}** at **saturation 0**, at **2×** and
all three rates: the box's static points on that line (drive 0, 0.5 and 1)
and its drive sweeps (50 ms and 1 s) with width and saturation held there.
That is 5 trials per width and rate, **60** in all. Each is the same trial
#290's box would run at that corner, with the width moved.

The pole explanation predicts where this edge falls. The irreversible
term's pull is (1−c)·gap / (δ·k(1−c) − α·gap). Its denominator reaches zero
at |gap| = k(1 − c)/α, with c = √(1 − width) − 0.01:

| Width | c | Pole threshold \|gap\| |
|---|---|---|
| 0 | 0.990 | 2.99 |
| 0.01 | 0.985 | 4.49 |
| 0.02 | 0.980 | 6.00 |
| 0.05 | 0.965 | 10.57 |

At saturation 0, Ms = 2, and |gap| = |Ms L(Q) − M| ≤ Ms + |M|. #290's
survivors kept peak |M| under 3.3, so |gap| stays under about 5. So the
explanation predicts failures at width 0 and none from 0.02 up. Width 0.01
is marginal, between the threshold and that bound. A failure at 0.02 or
0.05 would refute it. `evidence.mjs` computes each threshold from the
shipped constants and reports it beside the bound Ms + peak |M| that each
width's trials reached.

### Pass criteria (every trial)

#290's, unchanged: **zero resets** (the state guard, |M| > 20 or not
finite, is the core's one failure and counts as a reset), **zero
nonfinite** output samples and every input finite, and peak |M| reported
against the guard at 20. The field guard's clips, the output's peak and its
remanent DC are reported, not gated.

### Bound and run

[`measure.mjs`](measure.mjs) runs the edge, then the ladder. Each set runs
in **4 worker processes** (half this machine's 8 cores), one journal each,
dealt round-robin in cost order. A **hard 3,600-second wall-clock bound**
runs from the start over the edge and every box. At the limit every child
is killed, and the report is assembled from the journals alone. There is
no retry. [`evidence.mjs`](evidence.mjs) derives everything below from the
raw trials. Its `--check`:

- re-derives the edge table, each box's gates, where the ladder stops, its
  completeness and the declaration from `measurement.json`;
- re-hashes the import closure and checks it is clean;
- re-renders three spot trials (the width-0 failure at 48 kHz, a 0.05-box
  drive sweep and a 96 kHz 4× jump walk), comparing their records exactly
  (all but wall time).

## Reproduce and verify

From the repository root, Node 24, with the worktree's own `@windsor`
packages linked:

```sh
node docs/research/2026-10-01-tape-control-domain-2x/measure.mjs
node docs/research/2026-10-01-tape-control-domain-2x/evidence.mjs --check
node docs/research/2026-10-01-tape-control-domain/evidence.mjs --check
npx eslint docs/research/2026-10-01-tape-control-domain-2x/ docs/research/2026-10-01-tape-control-domain/
```

#315's part, below, runs and re-checks with:

```sh
node docs/research/2026-10-01-tape-control-domain-2x/measure.mjs --rows
node docs/research/2026-10-01-tape-control-domain-2x/rowsEvidence.mjs --check
```

Since #293, #307 and #314 changed the shipped core and stage, the first two
`--check`s above report a changed closure and moving spot trials that are
no longer bit-equal (see the Status note at the top). Each folder's
`--historical` is the check that passes:

```sh
node docs/research/2026-10-01-tape-control-domain-2x/evidence.mjs --historical
node docs/research/2026-10-01-tape-control-domain/evidence.mjs --historical
```

## Environment and run

Apple M1 arm64 (8 cores), Darwin 25.5.0, Node v24.20.0, V8
13.6.233.17-node.53, Float64 in Node, no browser. The sources were bundled
by esbuild at `510c649`, which is `origin/main` (`c15868d`) plus this
folder's declaration. Another session was running Tape tests at the same
time. The one-minute load average was 4.7 before the run and 7.5 after.

**Run.** Complete, in **590.7 s of the 3,600-second bound**: the edge (60
trials, 10.4 s) and the 0.05 box (1,878 trials, 580.2 s), 1,938 of 1,938
scheduled. The 0.05 box passed, so the ladder stopped there and 0.1 and
0.15 were not run. Every worker exited 0, with no expiry, no truncated tail
and nothing missing. The trials used 2,353 CPU-seconds in all.
`evidence.mjs --check` passes all four of its checks: derived, closure,
clean closure and three spot re-renders, bit-equal (the width-0 failure
included, resets and all). #290's own `--check` also passes after the
harness change.

## Results

### The width-0 edge: only width 0 fails

| Width | Pole threshold \|gap\| | Trials | Survive | Peak \|M\| | Ms + peak \|M\| (survivors) |
|---|---|---|---|---|---|
| 0 | 2.99 | 15 | **12** | 19.97 (failing) / 1.76 | 3.76 |
| 0.01 | 4.49 | 15 | 15 | 3.33 | 5.33 |
| 0.02 | 6.00 | 15 | 15 | 3.31 | 5.31 |
| 0.05 | 10.57 | 15 | 15 | 3.26 | 5.26 |

At width 0, the three failures are #290's: the 1 s drive sweep, 2 resets at
each rate, peak |M| 19.97 just under the guard, and output up to 669 before
each reset. Every other width-0 trial survives with peak |M| at most 1.76,
including the 50 ms drive sweep (1.65). From width 0.01 up, every trial
survives. The 1 s drive sweep, the one that failed, now peaks at |M| 3.33,
3.31 and 3.26, within 3% of each other. Its output peaks near 110, as #290's
survivors did, from the gain rising under a frozen M (reported, not gated).

**What this says about the pole explanation.** It is **consistent, and
not refuted**:

- The failing region's edge lies between width 0 and 0.01, where the
  explanation puts it. The threshold rises from 2.99 to 4.49 there, past
  the |gap| a field moving away from saturation produces at Ms = 2.
- At 0.02 and 0.05, the bound on |gap| that the record allows, Ms + peak
  |M| (5.31 and 5.26), is under the threshold (6.00 and 10.57). There, the
  pole cannot be reached by any state the trials visited, so their survival
  follows from it.
- At 0.01, the bound (5.33) is over the threshold (4.49), so the bound
  alone does not exclude the pole. The trials survive, so the gap they
  reached stayed under 4.49, but this record does not measure the gap.
- Peak |M| is read once per host sample, after the core's steps. The RK
  stages' trial states, between those reads, are not recorded.

So the explanation predicts every outcome seen, and nothing seen
contradicts it. A direct reading of the gap at the pole was not part of
the declared experiment.

### The box at w_min = 0.05: 1,878 of 1,878 survive

drive [0, 1] × width [0.05, 0.62] × saturation [0, 1]:

| Factor | Part | Trials | Survive | Peak \|M\| | Guard margin | Peak out |
|---|---|---|---|---|---|---|
| 2× | static | 831 | 831 | 1.740 | 11.5× | 4.01 |
| 2× | sweep | 72 | 72 | 3.256 | 6.1× | 110.2 |
| 2× | walk | 36 | 36 | 2.359 | 8.5× | 241.1 |
| 4× | static | 831 | 831 | 1.733 | 11.5× | 4.03 |
| 4× | sweep | 72 | 72 | 3.217 | 6.2× | 104.8 |
| 4× | walk | 36 | 36 | 2.293 | 8.7× | 233.0 |

Over all three rates per factor. Per rate and factor, every group's
figures are in `measurement.json` under `derived.boxes[0].groups`. There
are no resets, no nonfinite samples, and no state-guard failure. The
largest gain reached is 494.7 (susceptibility 2.02 × 10⁻³), at drive 0 and
width 0.62, as in #290. The static peak output is 4.03 (drive 0, width 0.62,
saturation 0, 96 kHz, 4×).

**Output excursions** (reported, not gated) match #290's: up to 110 in
sweeps and 241 in jump walks, during the held-level segments (`dc`,
`opposite`), 9.1 in silence, and up to 7.4 in the ramp, tone and spike
segments. Raising the width minimum does not change them. They come from
drive moving under a frozen M. **Field guard**: all 1.87 × 10⁹ engagements
are in the `dc` and `opposite` segments, as in #290.

## Declaration

**Qualified for survival** (zero resets, zero nonfinite samples, zero
state-guard failures, peak |M| ≤ 3.26 against 20) on the shipped core, for
field |H| ≤ 4, statically at 277 points per rate and factor, under 50 ms
and 1 s knob sweeps and under 50 ms and 1 s random walks with the stage's
10 ms smoothing:

- **At 2× and 4×, at 44.1, 48 and 96 kHz: drive [0, 1], width
  [0.05, 0.62], saturation [0, 1].**
- **The width minimum is 0.05**, the first rung of the ladder. It is under
  0.13, the lowest width a shipped model row uses (Chrome), so every
  shipped row's width is inside the box. 0.1 and 0.15 were not run.
- **Width 0.01 and 0.02 also survived**, but only on the edge's 15 trials
  each (2×, saturation 0), not a whole box. A minimum below 0.05 is
  unmeasured as a box, so it is not declared.
- **4× alone** keeps #290's wider box, width [0, 0.62].
- **Not decided here.** No product change, default, factor or panel
  range. The output excursions under drive motion are unchanged and remain
  the panel's design question.
- **Amended by #315: at 2× and 4×, at 44.1, 48 and 96 kHz: drive
  [0.05, 1], width [0.05, 0.85], saturation [0, 1]** is qualified on the
  same criteria, on the shipped core after #307, all 1,878 trials
  surviving (peak |M| 1.74). It holds every shipped model row, Vintage
  and VHS included. See [#315's declaration](#declaration-315) below.

**Accuracy is not qualified**, as in #290: the corner-accuracy record's
tone-gate misses at the drive and saturation ends still apply, and were not
re-measured.

## windsor#315: a box that holds every shipped model row

Windsor [#315](https://github.com/tacowars/windsor/issues/315). The
Advanced panel (#291, PR #314) uses the box declared above, but two shipped
model rows sit above its width maximum of 0.62: **Vintage** (drive 0.742,
width 0.831, saturation 0.528) and **VHS** (0.836, 0.769, 0.972). Touching
any knob on either model would clamp width to 0.62, which is audible.

That maximum is #290's rule (i), susceptibility ≥ 2 × floor, read at
**drive 0 only**, where the origin susceptibility at width 0.62 is
2.02 × 10⁻³ and the gain 494.7. The shipped susceptibility is
c r / (1 − α c r) with r = (0.01 + 6 · drive) / 3 and c = √(1 − width) −
0.01. It does not depend on saturation, rises with drive and falls with
width. Raising drive's minimum therefore relaxes the rule, and from drive
0.05 width 0.85 keeps the susceptibility far above it. This part qualifies
**drive [0.05, 1] × width [0.05, 0.85] × saturation [0, 1]**, which holds
every shipped row (lowest drive 0.159, 30ips Studio; highest width 0.831,
Vintage) and gives up only drive's nearly linear bottom 5%.

### What is measured, and what changed under it

The schedule is #295's: #290's field program, static points, sweeps,
random walks and pass criteria, each trial with its own box. The render is
not #290's `runTrial` (see the next section): every trial renders through
[`rowsTrial.ts`](rowsTrial.ts), which drives the shipped stage exactly as
`TapeDsp` does. [`rowsProgram.ts`](rowsProgram.ts) schedules the candidate
boxes and reads the shipped rows (`TAPE_MODELS`, `TAPE_LABELS`). The two
import `boxProgram.ts`, #290's `controlConstants.ts` (for types), the
shipped `tapeConstants.ts` and the shipped `tapeMagneticStage.ts`, nothing
else. `rowsEvidence.mjs` walks the import closure as `evidence.mjs` walks
#295's, and `--check` fails unless every file is under
`packages/engine/src/`, #290's folder or this one. **No research core** is
reached.

### The first run was void: the controls never moved (fix round on PR #317)

**The bug.** Since #293 (`634e717`), `TapeMagneticStage.configure` only
sets the glide's target. The controls move per sample in `glide`, which
`TapeDsp.step` calls while `gliding`, before the channel's oversampler
advances; each `retune` there rescales M by the old gain over the new
(#307). #290's `runTrial`, which this part first used unchanged, calls
`configure` once per block and never calls `glide`. The stage is built at
the trial's starting point, so in that first run (`7ccaf94`) every sweep
and every random walk stayed exactly where it began. For example, the 1 s
drive sweep at width 0.85 and saturation 0, 44.1 kHz 2×, recorded
`reached` drive [0.05, 0.05]. Its 216 dynamic trials (144 sweeps, 72
walks) tested nothing about control motion, and its "output under control
motion" finding was void. Codex found it on PR #317.

**The fix.** [`rowsTrial.ts`](rowsTrial.ts) makes `TapeDsp`'s calls in
`TapeDsp`'s order: per block, `select(factor)` then `configure(model)`;
per sample, `glide()` while `gliding`, then the left channel's
oversampler (`input`, `advance()`, `output`). The M rescale is the
shipped `retune`'s, so it is included as shipped. Everything else is
#290's: the field program, the research row written with the knob targets
before each block's `configure`, and the counters. `reached`, the
susceptibility and the gain are now read per sample, after the glide.
#290's folder is not edited.

**The motion gate** ([`rowsMotion.mjs`](rowsMotion.mjs)). Each record now
carries the range of the targets written (`commanded`), the range of the
glided controls (`reached`), and for a walk the controls at each hold's
end (`holdEnds`). From the saved records, `derive` checks that:

- a **static** trial held its point exactly;
- a **sweep** held its other two controls exactly, stayed inside the box,
  and reached both ends of its swept range within the glide's tracking
  lag. That lag is the bound for a first-order glide (time constant
  `TAPE_DSP.smoothSeconds`, 10 ms) behind a ramp of the sweep's slope
  a = span / (period / 2), plus the per-sample step and the block's held
  target: a (τ + (block + 1) / rate). It is 2.6% of the span for a 1 s
  sweep at 44.1 kHz and 52% for a 50 ms one. A sweep that never moved
  misses the far end by the whole span;
- a **walk** stayed inside the box, and at every one of its holds' ends
  (10 for the 1 s walks, 200 for the 50 ms ones) each control was at a
  value it took at no other hold's end.

A failure makes `declaration.qualified` false, and the exit gate also
fails on it directly, smoke runs included. `--check` runs the gate on the
first saved sweep and walk, which pass, and on the same records with their
controls frozen at the start, which fail. Applied to the first run's
records, the gate fails all 216 dynamic trials and passes its 1,662
static ones.

**#295's run is not affected.** Its `measurement.json` records commit
`510c649`, which is an ancestor of `634e717` (#293); #297, which merged
it, landed at 14:13 and #293 at 14:27 on 2026-10-01. At `510c649`,
`TapeMagneticStage.configure(model, frames)` itself moved the controls
once per block by the 10 ms time constant over `frames` samples, and
reconfigured the cores when they moved. So #295's dynamic trials
exercised the then-shipped per-block configure: all 168 of its sweeps
moved (for example, a 1 s drive sweep at the edge reached 0.986 of the
span and a 50 ms one 0.754), but on a core without per-sample glide and
without #307's M rescale. #295 is not re-run here. Its own `measure.mjs` path (without
`--rows`) still renders through #290's per-block `runTrial`, so re-run on
today's stage, its sweeps and walks would not move either.

**The shipped core changed after #295's run.** #307 (`80b077a`) rescales
M when the gain changes, so M × gain stays continuous under control motion.
This part measures the core as it ships now. #290's and #295's records are
of the core before #307 and are not changed here; their `--check` now
reports the closure hashes as changed and their moving spot trials as not
bit-equal (#290's static spot trial still is).

### Declared experiment before measurement

[`rowsConstants.ts`](rowsConstants.ts) holds every new value below. It, the
scripts and this section were committed before the run.

**The candidates**, run in order. The run stops at the first box in which
every trial survives, and that box is declared. The first is the issue's
box; the rest are its decision 3's steps (drive's minimum up to 0.1, width's
maximum down to 0.83):

| # | Drive | Width | Saturation |
|---|---|---|---|
| 1 | [0.05, 1] | [0.05, 0.85] | [0, 1] |
| 2 | [0.1, 1] | [0.05, 0.85] | [0, 1] |
| 3 | [0.05, 1] | [0.05, 0.83] | [0, 1] |
| 4 | [0.1, 1] | [0.05, 0.83] | [0, 1] |

Vintage's width is 0.8311, a little above 0.83, so candidates 3 and 4 would
leave its row just outside. `derived.declaration.holdsEveryRow` reports
whether the declared box holds every row, and either of those boxes is
flagged if it is needed.

Each candidate is #290's whole part B, as #295 ran it, per rate and factor
(313 trials, **1,878** per candidate):

- **277 static points**: the 8 corners, 12 edge midpoints, centre and the
  same 256 R3 interior points (seed 290), mapped into the candidate box;
- **24 sweeps**: each control end to end and back in 50 ms and in 1 s, the
  other two at each of their four corners;
- **12 random walks**: glide-1s, glide-50ms and jump-50ms at seeds
  2901–2904, uniform in the candidate box;
- at **2× and 4×**, at **44.1, 48 and 96 kHz**.

**The normalisation table** (from the shipped `configure`, not rendered).
For every candidate, on each of the box's six faces, a 41 × 41 grid; through
its volume, a 21 × 21 × 21 grid. At each point: the origin susceptibility,
the output gain, and the gain over its width-0 value at the same drive and
saturation (#290's rule (ii) ratio). Reported per face and for the volume:
the lowest susceptibility and its ratio to the floor (10⁻³), the highest
gain, the highest ratio, and where each falls; and whether the volume's
extremes lie on the faces. Rule (i)'s margin (2 × floor) is reported per
face. Rule (ii) (ratio ≤ 2) is reported, not gated: the issue gates
survival only, and the shipped rows themselves reach 2.47 (Vintage). From
the formula above, the worst point is the edge where drive is lowest and
width highest, at any saturation.

**The shipped rows table**: each row's susceptibility, gain and ratio, and
which candidate boxes hold it.

### Pass criteria (every trial)

#290's, unchanged: **zero resets** (the state guard, |M| > 20 or not
finite, counts as a reset), **zero nonfinite** output samples and every
input finite, and peak |M| reported against the guard at 20. The field
guard's clips, the output's peak and its remanent DC are reported, not
gated.

### Bound and run

`measure.mjs --rows` runs the candidates. Each runs in **4 worker
processes** (half this machine's 8 cores), one journal each, dealt
round-robin in cost order. A **hard 3,600-second wall-clock bound** runs
from the start over every candidate. At the limit every child is killed
and the report is assembled from the journals alone. There is no retry.

**The exit code** (decision 4, Codex's P2 on PR #297). `measure.mjs`, in
either experiment, now exits nonzero unless the closure is clean, nothing
expired, every worker exited 0, no journal has a truncated tail, every
scheduled trial was recorded and a box qualified; and, in #315's
experiment, unless every trial passed the motion gate. A `--smoke` run is
partial by design, so completeness and qualification do not apply to it,
but the motion gate does. The gate is `exitCode` in `evidence.mjs`, and
both `--check`s run its 14 cases (expiry, a worker that exited nonzero or
was killed, no worker, a truncated journal, missing trials, no box
qualified, an unclean closure, a run that moved, a trial that did not move
in a measurement and in a smoke run, and smoke runs partial and broken).

[`rowsEvidence.mjs`](rowsEvidence.mjs) derives everything below from the
raw trials and the shipped `configure`. Its `--check`:

- re-derives the normalisation and rows tables, each candidate's gates,
  the motion gate, where the candidates stop, completeness and the
  declaration from `rowsMeasurement.json`;
- re-hashes the import closure and checks it is clean;
- re-renders three spot trials of candidate 1 (the worst-gain corner,
  drive 0.05 and width 0.85, static at 48 kHz 2×; the 1 s drive sweep at
  width 0.85 and saturation 0 at 44.1 kHz 2×; a 96 kHz 4× jump walk),
  comparing their records exactly (all but wall time);
- runs the exit gate's cases and the motion gate's four (a saved sweep and
  walk pass; the same records frozen at their start fail).

### Environment and run (#315)

Apple M1 arm64 (8 cores), Darwin 25.5.0, Node v24.20.0, V8
13.6.233.17-node.53, Float64 in Node, no browser. The sources were bundled
by esbuild at `65ab4ac`, which is `origin/main` (`ac0fa91`, after #307)
plus this part's declaration and the fix round's harness (`rowsTrial.ts`
and the motion gate). Other sessions were working on the machine. The
one-minute load average was 3.1 before the run and 6.0 after.

This is the second run. The first (`7ccaf94`, 522.8 s) rendered through
#290's per-block `runTrial`; its sweeps and walks never moved (see "The
first run was void"), and its `rowsMeasurement.json` is replaced, not
kept.

**Run.** Complete, in **577.7 s of the 3,600-second bound**: candidate 1
(1,878 trials), 1,878 of 1,878 scheduled. Candidate 1 passed, so the run
stopped there and candidates 2–4 were not run. Every worker exited 0, with
no expiry, no truncated tail and nothing missing, every trial passed the
motion gate, and `measure.mjs` exited 0. The trials used 2,293
CPU-seconds in all. `rowsEvidence.mjs --check` passes all six of its
checks: derived, closure, clean closure, three spot re-renders bit-equal,
the exit gate's 14 cases and the motion gate's four.

### Results (#315)

#### The normalisation over the box

drive [0.05, 1] × width [0.05, 0.85] × saturation [0, 1], 41 × 41 points
per face and 21³ through the volume, from the shipped `configure`:

| Face | Lowest susceptibility | × floor | Highest gain | At (drive, width, sat.) | Highest gain / width-0 gain |
|---|---|---|---|---|---|
| drive = 0.05 | 3.90 × 10⁻² | 39.0 | **25.65** | 0.05, 0.85, any | 2.62 |
| drive = 1 | 7.57 × 10⁻¹ | 756.8 | 1.32 | 1, 0.85, any | 2.63 |
| width = 0.05 | 9.97 × 10⁻² | 99.7 | 10.03 | 0.05, 0.05, any | 1.03 |
| width = 0.85 | 3.90 × 10⁻² | 39.0 | **25.65** | 0.05, 0.85, any | 2.63 |
| saturation = 0 | 3.90 × 10⁻² | 39.0 | **25.65** | 0.05, 0.85, 0 | 2.63 |
| saturation = 1 | 3.90 × 10⁻² | 39.0 | **25.65** | 0.05, 0.85, 1 | 2.63 |
| volume (21³) | 3.90 × 10⁻² | 39.0 | 25.65 | 0.05, 0.85, 0 | 2.63 |

- **The worst case is the edge drive 0.05, width 0.85**, at every
  saturation, as the formula predicts: susceptibility 3.90 × 10⁻², **39×
  the floor** (rule (i) asks 2×), gain **25.65**. #295's box reached 494.7
  at drive 0, width 0.62, so the largest gain falls about 19-fold. The
  volume's extremes equal the faces' (`extremesOnFaces`).
- **Rule (ii) does not hold, and is reported only.** The gain over its
  width-0 value reaches **2.63** at width 0.85 (drive-independent but for
  the α term; #290's rule (ii) allows 2, which binds at width 0.74). The
  shipped rows themselves exceed it: Vintage 2.47 and VHS 2.11. #290 tied
  this ratio to the hold's excess and the remanent DC, which scale with it.
- The other candidates, computed but not run: drive 0.1 halves the
  largest gain to **13.03**; width 0.83 gives 24.05 at drive 0.05 and 12.22
  at drive 0.1. Every face of every candidate is at least 39× the floor.

#### The shipped rows

| Model | Drive | Width | Sat. | Susceptibility | Gain | / width-0 gain | In the box |
|---|---|---|---|---|---|---|---|
| 30ips Studio | 0.159 | 0.278 | 0.324 | 0.271 | 3.70 | 1.18 | yes |
| Ferric | 0.723 | 0.509 | 0.594 | 1.003 | 1.00 | 1.43 | yes |
| Vintage | 0.742 | **0.831** | 0.528 | 0.597 | 1.67 | 2.47 | yes |
| 15ips Studio | 0.545 | 0.589 | 0.556 | 0.691 | 1.45 | 1.57 | yes |
| Chrome | 0.336 | 0.132 | 0.564 | 0.623 | 1.60 | 1.07 | yes |
| Metal | 0.339 | 0.490 | 0.134 | 0.480 | 2.08 | 1.41 | yes |
| VHS | 0.836 | 0.769 | 0.972 | 0.790 | 1.27 | 2.11 | yes |

Every row is inside candidate 1 (and 2). Vintage's width, 0.8311, is
outside candidates 3 and 4, as declared.

#### The box: 1,878 of 1,878 survive, and every trial moved

| Factor | Part | Trials | Survive | Peak \|M\| | Guard margin | Peak out | Largest gain |
|---|---|---|---|---|---|---|---|
| 2× | static | 831 | 831 | 1.740 | 11.5× | 6.28 | 25.65 |
| 2× | sweep | 72 | 72 | **7.603** | **2.6×** | 6.28 | 25.65 |
| 2× | walk | 36 | 36 | 6.438 | 3.1× | 4.99 | 17.59 |
| 4× | static | 831 | 831 | 1.733 | 11.5× | 6.32 | 25.65 |
| 4× | sweep | 72 | 72 | 7.346 | 2.7× | 6.30 | 25.65 |
| 4× | walk | 36 | 36 | 6.234 | 3.2× | 4.99 | 17.59 |

Over all three rates per factor. Per rate and factor, every group's
figures are in `rowsMeasurement.json` under `derived.boxes[0].groups`;
every one of the 18 groups survives whole. There are no resets, no
nonfinite samples and no state-guard failure.

**The controls moved** (`derived.motion`, all 1,878 checked, no failure).
Every static trial held its point exactly. Every sweep held its other two
controls and reached both ends of its swept range within the glide's
tracking lag: the 1 s sweeps covered at least **98.6%** of the span and
the 50 ms sweeps at least **75.4%** (a 10 ms glide cannot follow a 25 ms
ramp further; the gate allows down to about 48%). For example, the 1 s
drive sweep at width 0.85, saturation 0, 44.1 kHz 2×, which the first run
recorded at drive [0.05, 0.05], now reaches [0.05, 0.987]. Every walk
ended each of its holds at a new point on every axis; the largest distance
from a hold's end to its target was 0.0074 for the jump walks (the glide
settling over 50 ms), 0.0081 for the 1 s glide walks and 0.18 for the
50 ms glide walks (the lag behind a ramp across the box in 50 ms).

**Peak |M| under motion is 7.60, 2.6× under the guard at 20.** It is the
1 s drive sweep at width 0.05 and saturation 0, 96 kHz 2×, in the
`opposite` segment; the same sweep reaches 7.59 at 44.1 and 48 kHz, and
the jump walks reach 6.44 (seed 2901, 48 kHz 2×, `dc` hold). Static
points peak at 1.740 (corner drive 1, width 0.05, saturation 0, 44.1 kHz
2×), as in the first run. This is consistent with #307's rescale: the
shipped `retune` keeps M × gain continuous, so when drive rises the gain
falls and M is scaled up by the same ratio, and the peaks fall in the held
`dc` and `opposite` segments, where the field barely moves M itself. The
first run, whose controls never moved, could not show it. The margin is
reported; the gate is the guard itself.

**Output under control motion.** No sweep or walk produces a larger
output than the static points do. The largest output, 6.32, is the static
worst-gain corner (drive 0.05, width 0.85, saturation 0, 96 kHz 4×) in the
`dc` hold; sweeps peak at 6.30 (the 1 s saturation sweep at that corner's
drive and width, 96 kHz 4×, `dc`), walks at 4.99 (jump-50ms, seed 2902,
96 kHz 2×, `tones`). #295's box, on the per-block stage before #307 and
with drive down to 0, reached 110 in sweeps and 241 in jump walks from
drive moving under a frozen M. This run changes the stage (per-sample
glide, #293), the core (#307) and drive's minimum together, so it does not
separate their shares; it only reports that the excursion is gone here.
**Field guard**: all 1.87 × 10⁹ engagements are in the `dc` and
`opposite` segments, as in #290 and #295.

### Declaration (#315)

**Qualified for survival** (zero resets, zero nonfinite samples, zero
state-guard failures, peak |M| ≤ 1.74 static and ≤ 7.60 under motion,
against 20) on the shipped core and stage as of `ac0fa91` (after #293 and
#307), for field |H| ≤ 4, statically at 277 points per rate and factor,
under 50 ms and 1 s knob sweeps and under 50 ms and 1 s random walks,
driven through the stage's per-sample 10 ms glide as `TapeDsp` drives it,
with every trial checked to have moved as commanded:

- **At 2× and 4×, at 44.1, 48 and 96 kHz: drive [0.05, 1], width
  [0.05, 0.85], saturation [0, 1].** The issue's box, candidate 1; no step
  of decision 3 was needed.
- **It holds every shipped model row**: drive 0.159 (30ips Studio) is
  above 0.05 and width 0.831 (Vintage) below 0.85. A knob touched on
  Vintage or VHS need not clamp width.
- **Normalisation over the box**: susceptibility ≥ 3.90 × 10⁻² (39× the
  floor) and gain ≤ 25.65, both worst on the edge drive 0.05, width 0.85.
  The gain over its width-0 value reaches 2.63, past #290's rule (ii) at 2;
  that rule is reported, not gated, and two shipped rows already exceed it.
- **Drive below 0.05 is outside this box.** #295's box, drive [0, 1] ×
  width [0.05, 0.62], was qualified on the per-block stage before #293 and
  the core before #307, and was not re-run on the current stage here.
- **Not decided here.** No product change, default, factor or panel range.

**Accuracy is not qualified**, as in #290 and #295.
