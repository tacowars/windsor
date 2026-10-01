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
