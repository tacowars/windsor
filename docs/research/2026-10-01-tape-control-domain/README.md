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
npx eslint docs/research/2026-10-01-tape-control-domain/
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck --types node docs/research/2026-10-01-tape-control-domain/*.ts
```
