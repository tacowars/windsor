# Tape core control domain: the knob ranges an Advanced panel may offer

Windsor [#290](https://github.com/tacowars/windsor/issues/290) qualifies,
or bounds, the continuous domain of the shipped magnetic Tape core's three
internal controls (drive, width, saturation). tacowars wants an Advanced
panel on the Tape card that exposes them as knobs. The design record
([magnetic integration design](../../log/2026-09-30-tape-magnetic-integration-design.md),
decision 6) limits model rows to the control points the dynamic-survival
record sampled "until a wider domain is qualified". A knob is continuous and
is turned live, so this record tests the continuous box, statically and
under knob motion, and ends in a declaration of the ranges the panel may
offer. It is **survival, not accuracy**. It is research only and changes
nothing under `packages/`.

**Status (2026-10-01, windsor#320): historical.** This record measured the
shipped core and stage as bundled at `3a21cde` (`origin/main` `ce20d2e`
plus this folder's declaration). Its trials, derivations and declaration
stay valid as a record of that code. They are not re-run and not changed.
Three later commits changed files in its hashed import closure:

- #293 (`634e717`) moved the control glide into the stage, per sample
  (`tapeMagneticStage.ts`, `tapeMagnetic.ts`, `tapeConstants.ts`). Since
  then, this harness's per-block `configure` no longer moves the controls
  on today's stage, so its sweeps and walks would hold their start point.
- #307 (`80b077a`) rescales M when the gain changes
  (`tapeMagnetic.ts`, `tapeMagneticStage.ts`).
- #314 (`6eca799`) added the Advanced controls' plumbing
  (`tapeMagneticRows.ts`, `tapeMagneticStage.ts`, `tapeConstants.ts`).

So `evidence.mjs --check` now **fails, and is expected to**: grid,
derived and clean closure pass; closure fails (those four files' hashes
changed); and of the three spot re-renders only the static one
(`static/centre/48000/2`) is still bit-equal, while the sweep and the walk
are not. `evidence.mjs --historical` is the passing check for this folder:
it re-derives the width rule, completeness, the gates and the declaration
from the saved trials and the saved grid, and checks that the saved closure
was clean and that the run names its commit. It skips the closure re-hash,
the grid recomputation and the spot re-renders.

**Superseded for the shipped box** by windsor#315, the `rows*` files in
[the 2× folder](../2026-10-01-tape-control-domain-2x/README.md#windsor315-a-box-that-holds-every-shipped-model-row)
(merged as `074e599`), which ran on the core after #293 and #307 with every
trial checked to have moved as commanded.

## What is measured, and what is not imported

The core under test is the **shipped** one, unchanged:

- `packages/engine/src/worklet/tape/tapeMagnetic.ts` (the core, its guards
  and `originSusceptibility`),
- `tapeOversample.ts` (the span-48 interpolator, the field guard and knee,
  the decimator),
- `tapeMagneticStage.ts` (both oversampler pairs, the 10 ms control
  smoothing and the per-block reconfiguration),
- `inserts/tapeMagneticConstants.ts`, `inserts/tapeConstants.ts` and the
  portable math they use.

[`program.ts`](program.ts) drives `TapeMagneticStage` exactly as `TapeDsp`
does: `configure` once per 128-frame block, then the active left
oversampler per host sample through its `input`, `advance()` and `output`
fields. The harness touches the shipped code in one place. It appends one
research row to the bundle's in-memory `TAPE_MODELS`, and before each
block's `configure` it writes the knob targets into that row's `magnetic`
triple, as a model change would. So the stage's own 10 ms smoothing turns
the knob targets into the controls the core sees.

**No research core.** Nothing here imports the GPL CHOW-derived research
core, directly or through another research folder. The dynamic-survival
record's `program.ts` imports that core, so its program is **rebuilt** here,
not imported. `evidence.mjs` walks `program.ts`'s relative imports and
records every file it reaches with its SHA-256. `--check` fails unless every
one is under `packages/engine/src/` or this folder. The closure is the three
TypeScript files here plus nine shipped engine sources, listed in
[`measurement.json`](measurement.json) under `closure`.

## Declared experiment before measurement

[`controlConstants.ts`](controlConstants.ts) holds every value below. It,
the scripts and this section were committed before the run.

### The field program (10 s, rebuilt from the dynamic-survival record)

The source field is a closed-form function of time, sampled at the host
rate and fed to the oversampler, which reconstructs H and dH/dt at every
RK4 stage point as the product does. Its peak is the declared domain,
**|H| ≤ 4**.

| Segment | Time (s) | Field |
|---|---|---|
| ramp | 0–1 | three tones, peak ramping linearly 0 → 4 |
| tones | 1–2 | the tones at peak 4 |
| dc | 2–5 | +4 from 2 (crossfading from the tones), −4 from 3.5, 0 from 4.995 |
| opposite | 5–7 | +4 from 5, −4 from 5.5, 0 from 6 |
| spikes | 7–9 | a 1 ms raised-cosine bump of ±4 every 250 ms, + first (8 bumps) |
| silence | 9–10 | 0 |

The tones are the dynamic-survival record's bins 17, 173 and 1361 of an
8192-sample period at 48 kHz: **99.6, 1013.7 and 7974.6 Hz at every rate**,
equal amplitude, sum / 3. They peak together at exactly 4. Every level
change is a **5 ms raised-cosine edge**. Phases are reduced exactly in
integers, and the tones and edges use the engine's portable `sine` and
`cosine`, so the field is the same bits on every platform.

**Differences from the dynamic-survival program.** That program was 60 s
long, defined in host samples, and evaluated in closed form at each RK
stage time. This one is:

- 10 s long, with shorter holds;
- defined in seconds, so the rates differ in the tones' position against
  Nyquist, not only in rounding;
- sampled at the host rate and reconstructed by the shipped interpolator.
  That is the shipped path, so its overshoot reaches the shipped field
  guard;
- free of the separate "edits" and "corners" segments. Control motion is
  the sweeps' and walks' job here, over the whole program.

### Part A: the width axis, then the box

Width's endpoint 1 is invalid: the reversible coefficient clamps to zero
there, the origin susceptibility is zero, and the output normalisation
`1 / susceptibility` is capped at `1 / TAPE_MAGNETIC.susceptibilityFloor`
(1000). The susceptibility depends on drive and width only. Ms / a reduces
to `driveFloor + driveScale × drive`, so saturation cancels. It is smallest
at drive 0.

- **Configure-only grid.** At each drive/saturation extreme (0/0, 0/1, 1/0,
  1/1) and every width in steps of 0.01, the record keeps the shipped
  `originSusceptibility` and the gain a shipped core computes in
  `configure`.
- **Rendered axis.** At the same extremes, widths 0, 0.05 … 0.95, 0.99
  and 1, under the program at 48 kHz at 2× and 4×: 176 trials. Each records
  the peak output against the conditioned field, the output's remanent DC
  after the ±4 holds (`dc`) and after the spikes, and the survival gates
  below.

**The width rule, declared.** w_max is the largest grid width such that,
at every grid width up to it and at every extreme:

1. **susceptibility ≥ 2 × floor** (2 × 10⁻³). The floor is where unity
   normalisation stops: below it the gain is capped and the output level
   no longer tracks the knob. A factor of 2 keeps every knob position's
   gain at least 6 dB under that cap (gain ≤ 500).
2. **gain ≤ 2 × its width-0 value** at the same drive and saturation.
   Width's own share of the normalisation multiplies what the irreversible
   term adds: the remanent magnetization left by a held field, and the
   hysteretic part of every large swing. The output's DC offset after a
   hold, and its excess peak, scale with that share. The rendered axis
   measures both. A bound of 6 dB over width 0 caps that amplification at
   twice the core's most reversible setting.
3. **every rendered part-A trial at or below it survives**.

Drive and saturation are expected to span [0, 1]; the box is drive [0, 1]
× width [0, w_max] × saturation [0, 1].

### Part B: the box, at 2× and 4×, at 44.1, 48 and 96 kHz

Per rate and factor (313 trials, **1,878** in all):

- **Static, 277 points.** The 8 corners, the 12 edge midpoints, the centre,
  and **256 interior points**. The interior points come from Roberts' R3
  additive recurrence, x_n = frac(shift + n / gᵏ) for k = 1, 2, 3, n = 1 …
  256, g⁴ = g + 1, with a Cranley–Patterson shift of three draws of the
  engine's `mulberry32` at **seed 290**, mapped into the box. Each runs the
  whole program at fixed controls.
- **Sweeps, 24.** Each control is swept end to end and back as a triangle
  from its low end, with a period of **50 ms** and of **1 s**. The other
  two sit at each of their four corners. Each sweep runs over the whole
  program, so it crosses tones, holds, spikes and silence. The knob target
  is read once per block, and the stage's 10 ms smoothing follows it, so at
  50 ms the core never quite reaches the ends. The record keeps the
  smoothed range actually reached.
- **Random walks, 12.** All three controls move at once. **glide-1s** and
  **glide-50ms** glide linearly to a new uniform point in the box every 1 s
  or 50 ms. **jump-50ms** sets a new target every 50 ms, which the
  smoothing turns into a 10 ms glide. Each kind runs at **seeds 2901–2904**
  (`mulberry32`).

### Pass criteria (every trial)

- **Zero resets.** The shipped core's one failure guard is the state
  guard: a magnetization past |M| = 20, or not finite, resets to zero and
  counts. So a **guard failure** and a reset are one event, counted by
  `core.resets`.
- **Zero nonfinite** output samples, and every input sample finite.
- **Peak |M| reported against the state guard** (20), with its margin.

The field guard is a clip, not a failure. As in
[the shipped probe](../2026-10-01-tape-shipped-probe/README.md), its
engagements are recorded (per segment) and not gated. The output's peak and
remanent DC are reported, not gated.

### Bound and run

[`measure.mjs`](measure.mjs) runs part A, applies the width rule, then runs
part B in the box it implies. Each part runs in **4 worker processes**
(half this machine's 8 cores), one journal each, dealt round-robin in cost
order. A **hard 1,800-second wall-clock bound** runs from the start: at the
limit every child is killed, and the report is assembled from the journals
alone. There is no retry. [`evidence.mjs`](evidence.mjs) derives
everything below from the raw trials. Its `--check`:

- re-derives the grid, the width rule, completeness, the gates and the
  declaration from `measurement.json`;
- re-hashes the import closure and checks it is clean;
- re-renders three spot trials, comparing their records exactly (all but
  wall time).

## Reproduce and verify

From the repository root, Node 24, with the worktree's own `@windsor`
packages linked:

```sh
node docs/research/2026-10-01-tape-control-domain/measure.mjs
node docs/research/2026-10-01-tape-control-domain/evidence.mjs --check
node docs/research/2026-10-01-tape-control-domain/evidence.mjs --historical
npx eslint docs/research/2026-10-01-tape-control-domain/
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck --types node docs/research/2026-10-01-tape-control-domain/*.ts
```

## Environment and run

Apple M1 arm64 (8 cores), Darwin 25.5.0, Node v24.20.0, V8
13.6.233.17-node.53, Float64 in Node, no browser. The shipped sources were
bundled by esbuild at `3a21cde`, which is `origin/main` (`ce20d2e`) plus this
folder's declaration. Another session was running heavy Tape tests at the
same time. The one-minute load average was 3.4 before the run and 9.4 after.

**Run.** Complete, in **653.6 s of the 1,800-second bound**: 2,054 of 2,054
scheduled trials (176 in part A, 1,878 in part B), every worker exited 0,
no expiry, no truncated tail, nothing missing. The trials used 2,610
CPU-seconds in all. `evidence.mjs --check` passes all five of its checks:
grid, derived, closure, clean closure and three spot re-renders, bit-equal.

**Changed after the run, by #295.** `boxOf`, `boxTrials` and `runTrial`
also accept a whole box, so
[the 2× record](../2026-10-01-tape-control-domain-2x/README.md) can run a
raised width minimum through this harness. A number still means width
[0, wMax], and the three spot trials re-render bit-equal after the change.
`measurement.json`'s `closure` carries the new hashes of `controlPaths.ts`
and `program.ts`, and its `derived` gained `factorAgreement`; the trials
are the run's, untouched.

## Results

### Part A: the width maximum is 0.62, set by drive 0

The susceptibility is independent of saturation, and it is smallest at
drive 0. There the width-0 gain is already 303, 3.3× under the cap. The
binding extreme is drive 0, at either saturation:

| Width | Susceptibility at drive 0 | Gain at drive 0 | Gain at drive 1 | Gain / width-0 gain |
|---|---|---|---|---|
| 0 | 3.300e-3 | 303.0 | 0.503 | 1 |
| 0.60 | 2.075e-3 | 482.0 | 0.800 | 1.59 |
| **0.62** | **2.022e-3** | **494.7** | **0.822** | **1.63** |
| 0.63 | 1.994e-3 | 501.4 | 0.833 | 1.65 |
| 0.74 | 1.666e-3 | 600.1 | 0.997 | 1.98 |
| 0.75 | 1.633e-3 | 612.2 | 1.017 | 2.02 |
| 0.90 | 1.021e-3 | 979.7 | 1.628 | 3.23 |
| 0.91 | 9.667e-4 | 1000 (capped) | 1.720 | 3.30 |

- **Rule (i)**, susceptibility ≥ 2 × 10⁻³, holds up to **0.62**. 0.63 is
  the first width below it.
- **Rule (ii)**, gain ≤ 2 × width 0, holds up to **0.74** at every extreme.
  The ratio is drive-independent (it is c(0) / c(w)).
- **Rule (iii)**: every rendered part-A trial survives at both factors,
  **width 1 included**. No reset, no nonfinite sample.

So **w_max = 0.62**, bound by rule (i) at drive 0.

**What the gain amplifies.** The rendered axis, at 2×. 4× is within
**1.91%** of 2× on every row shown. The largest differences are the peak
out at 1/0/0 (1.91%) and the holds at 0/1/0 (1.72%) and 0/0.99/0 (1.54%);
every remanence agrees within 0.06%. `evidence.mjs` computes these from the
trials as `derived.factorAgreement` (corrected in #295; this sentence first
said "within 1%"). The conditioned field peaks at 2.5 in every trial (the guard's 4
through the knee). "Hold" is the mean output over the last 0.1 s of the
`dc` segment, still inside the −4 hold, where the core's output should
equal the conditioned field, −2.5. "Remanence" is the mean output over
the last 0.1 s of the `spikes` segment, after the last (−4) spike, with the
field at zero:

| Drive / sat. | Width | Peak out | Hold | Remanence |
|---|---|---|---|---|
| 0 / 0 | 0 | 2.52 | −2.49 | −0.005 |
| 0 / 0 | 0.6 | 3.91 | −3.69 | −0.285 |
| 0 / 0 | 0.8 | 5.49 | −5.06 | −0.606 |
| 0 / 0 | 0.99 | 7.80 | −6.85 | −1.43 |
| 0 / 0 | 1 | 7.75 | −6.71 | −1.57 |
| 1 / 0 | 0 | 0.89 | −0.87 | −0.004 |
| 1 / 0 | 0.6 | 1.38 | −1.35 | −0.209 |
| 1 / 0 | 0.8 | 1.96 | −1.91 | −0.444 |
| 1 / 0 | 0.99 | 9.51 | −9.09 | −3.49 |
| 1 / 0 | 1 | 1713 | −1630 | −691 |
| 1 / 1 | 1 | 502 | −472 | −325 |

At drive 0 the core is almost linear (peak |M| 0.008), so the large gain
multiplies a small M, and width 0 gives unity, as designed. Remanence and
the hold's excess over the field both grow with width, at every drive, in
step with the gain ratio of rule (ii). The cap is visible past 0.9 at drive
0, where the output stops tracking the knob. At drive 1 the gain is
uncapped up to width 0.99 (5.54), and **at width 1 it is capped at 1000 on a
large M**: the output reaches 1713 for a 2.5 field. Survival holds there.
The output does not.

### Part B: 1,875 of 1,878 survive; the three failures are one 2× case

**Every static point survives** at both factors and all three rates:
corners, edge midpoints, centre and all 256 interior points (widths 0.004
to 0.617). There are no resets and no nonfinite samples. Peak |M| is at
most **1.763** against the guard at 20 (margin 11.3×). The peak output is
4.03, at drive 0 and width 0.62.

| Factor | Part | Trials | Survive | Peak \|M\| (survivors) | Peak out (survivors) |
|---|---|---|---|---|---|
| 2× | static | 831 | 831 | 1.763 | 4.01 |
| 2× | sweep | 72 | **69** | 2.890 | 108.7 |
| 2× | walk | 36 | 36 | 2.410 | 241.6 |
| 4× | static | 831 | 831 | 1.734 | 4.03 |
| 4× | sweep | 72 | 72 | 3.285 | 103.0 |
| 4× | walk | 36 | 36 | 2.343 | 233.4 |

Over all three rates per factor. Per rate and factor, every group's
figures are in `measurement.json` under `derived.groups`.

**The failures.** `sweep/drive/-:0:0/1/<rate>/2`: drive swept 0 → 1 → 0
in 1 s with width 0 and saturation 0, **at 2× only, at all three rates**,
2 resets each. The state guard caught both. There was no nonfinite sample,
and peak |M| reached 19.97 just before each reset. The same sweep at 4×
survives with peak |M| 3.28. A diagnostic re-render of the 48 kHz trial
(not part of the measurement) puts both resets on the **rising edge back
to zero after a −4 hold**: at 4.99916 s (end of `dc`) and 6.00416 s (end
of `opposite`). There, dH/dt > 0, the reversible coefficient c = 0.99 and
Ms = 2, and M runs away negative, against the field.

That is consistent with the irreversible term's pole. The pull is
(1−c)·gap / (δ·k(1−c) − α·gap), whose denominator crosses zero when
α·|gap| reaches k(1−c). At width 0 that threshold is |gap| ≈ 2.99, which
a field moving away from saturation at Ms = 2 can reach. Moving drive
during the hold puts Man far from the frozen M. Past the pole, the
increment has the wrong sign and grows with the gap. The 2× step leaves
it; the 4× step did not here. The threshold scales with 1 − c, so it rises
fast with width: about 6.0 at width 0.02 and 10.6 at width 0.05, against
|gap| ≤ Ms + |M| ≈ 4. This is an explanation, **not a measurement of the
failing region**. Only width 0 and saturation 0 were seen to fail, and no
narrower box was run.

### Output excursions under drive motion (reported, not gated)

The core's output is M × gain. During a held field (dH/dt = 0) or in
silence after remanence, M is frozen, because dM/dt is proportional to
dH/dt. So when drive moves down, the gain rises under a frozen M. Survivors
reached:

- up to **109** in sweeps and up to **242** in jump walks, during the
  held-level segments (`dc`, `opposite`);
- **9.1** in silence (a remanent M under a rising gain);
- up to **7.4** in the ramp, tone and spike segments.

The conditioned field never exceeds 2.5. Static points stay under 4.03.
This is an output-level hazard for a live drive knob: a jump of
+40 to +48 dB over the field, which the DC block after the core turns into a decaying
transient. It is not a survival failure, and nothing here changes it.

### Field guard

All 1.87 × 10⁹ field-guard engagements in part B are in the `dc` and
`opposite` segments: none in the ramp, the tones, the spikes or the
silence. A held ±4 reconstructs to within rounding of 4, and the guard
counts the stage points just above it. The tones' 4-peak never clipped.

## Declaration

**Qualified for survival** (zero resets, zero nonfinite samples, zero
state-guard failures, peak |M| ≤ 3.3 against 20) on the shipped core, for
field |H| ≤ 4, statically at 277 points per rate and factor, under 50 ms
and 1 s knob sweeps and under 50 ms and 1 s random walks with the stage's
10 ms smoothing:

- **At 4×, at 44.1, 48 and 96 kHz: drive [0, 1], width [0, 0.62],
  saturation [0, 1].**
- **At 2×, at 44.1, 48 and 96 kHz: the same box is *not* qualified.** Every
  static point, every walk, and every sweep except one survives. The
  failure is the 1 s drive sweep at width 0 and saturation 0, which resets
  twice at every rate.
- **Amended by #295: at both 2× and 4×, at 44.1, 48 and 96 kHz: drive
  [0, 1], width [0.05, 0.62], saturation [0, 1]** is qualified on the same
  criteria, all 1,878 trials surviving
  ([the 2× record](../2026-10-01-tape-control-domain-2x/README.md)). Its
  width-0 edge measurement fails only at width 0; widths 0.01, 0.02 and 0.05
  survive, consistent with the pole explanation above. 0.05 is under 0.13,
  the lowest width a shipped row uses.
- **Width's maximum is 0.62**, set by the susceptibility margin at drive 0
  (2.02 × 10⁻³ ≥ 2 × 10⁻³; gain 494.7 ≤ 500). The relative-gain bound
  alone would allow 0.74. Raising drive's lower end would relax rule (i),
  but no such box was run.
- **Drive and saturation span [0, 1]** for static and slow use. Drive's
  low end is where the gain is largest. Turning drive down under a held or
  remanent field produced output peaks up to about 100× (sweeps) and 240×
  (jump walks) the conditioned field. That is reported for the panel's
  design, not gated.
- **Not decided here.** No product change, default, factor or panel
  range. The main session and tacowars choose between a 4×-only panel, a
  narrower 2× box with its own run, and a fix to the core.

**Accuracy is not qualified.** The corner-accuracy record
([README](../2026-09-30-tape-corner-accuracy/README.md)) found both
shipped settings failing its tone gates at several control points. The
worst is 1/0/1 on the high tone at level 1: −14.78 dB at 2× and −30.62 dB
at 4×, against −50. Other misses fall in 0/1/x, 1/1/x and 1/0/0. Its cube
is the research one, width [0, 1]. The box here includes those corners'
drive and saturation ends, so accuracy there is known to be weak. It was
not re-measured.
