# Tape candidate survival on the declared |H| ≤ 4 domain

Windsor [#204](https://github.com/tacowars/windsor/issues/204) tests the
candidate domain that [#197](https://github.com/tacowars/windsor/issues/197)
declared, **conditioned-field input |H| ≤ 4**, where a product would actually
use it. It covers the whole control cube, 44.1, 48 and 96 kHz, and a
60-second program of tones, rapid control edits, held DC of both polarities,
opposite histories, transient spikes and silence. It asks whether the domain
holds dynamically, and if not, where it breaks. This is **survival and
stability evidence, not accuracy qualification**. It is research only, a
child of [epic #146](https://github.com/tacowars/windsor/issues/146), and
selects no product solver, default, cost or bounding method.

The equation is Jatin Chowdhury's GPL-3.0-only adaptation at revision
`604372e4ffd9690c3e283362e4598cb43edbb475`. The unchanged core,
[AUDIT](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING) remain read-only. So do the knee
conditioning and its chain derivative (`configured`, `condition`, `stage`),
the RK2/RK4 stage arithmetic (`step`), the playback kernel and the
magnitude-20 state guard. This is separate from the shipping Tape effect's
CC0 REELS adaptation, and none of it is product code.

## Declared experiment before reproduction

[`dynamicConstants.ts`](dynamicConstants.ts) is the only new table. It holds
the domain, settings, rates, control points, segments with their times, the
schedule seed, the edges, the remanence window and the budget.
[`program.ts`](program.ts) holds the closed-form field, the control schedule
and a stepping loop. [`evidence.mjs`](evidence.mjs) holds the records, the
survival map and the declaration, and [`measure.mjs`](measure.mjs) the
bounded runner.

**System.** The `knee` policy, knee at |H| = 1 and asymptote 4, as in #167.
The candidates are four fixed-step settings: **RK4 at 2, 4 and 8×** and
**RK2 at 8×**. Rates are **44,100, 48,000 and 96,000 Hz**. There is no event
alignment, reset, restart, new solver or new conditioning.

**Domain.** Field input |H| ≤ 4 in #197's field units. Controls are anywhere
in the closed cube [0,1]³ (drive, width, saturation). A failure inside the
domain narrows the declaration; no gate is loosened.

**Survival** means finite, with zero resets, zero clips and no state-guard
failure, and nothing else. Resets and clips are structurally zero on this
path, because neither `renderConditioned` nor the stepping loop calls the
core's `tick`/`reset`, and the imported `step` aborts on the guard instead.
They are recorded and gated anyway. A missing trajectory is unqualified,
never surviving.

**Part 1: static control cube (216 trajectories).** Signed ±4 pulses, #178's
512-frame shape (level on host frames 128–255, return at 256), zero history,
at the **eight corners of the cube and its center**, for every setting and
rate. Every trajectory is #197's instrumented `renderConditioned` on
`pulseField`/`subgrid`, unchanged. Each records: finite, resets, clips, the
guard failure index and host time, peak accepted |M|, peak returned |slope|
(M per second, with a count of nonfinite returns), final M, and the field
peak before and after the knee. The pulse is #197's host-sample level. Its
continuous reconstruction overshoots to |H| 4.506 (2.617 after the knee),
exactly as in #197.

**Part 2: 60-second program (12 trajectories).** One per setting and rate.
The field is a **closed-form function of host-sample time u with a
closed-form dH/du**, evaluated directly at every RK stage time
u = (2i + j)/(2 × factor). There is no sampled reconstruction, kernel or
grid. Tone phases are reduced exactly, as (bin × (u mod 8192)) mod 8192.
Segments, in seconds:

| Segment | Time | Field | Controls |
|---|---|---|---|
| ramp | 0–10 | `EXPERIMENT.bins` 17, 173, 1361 at bin × rate / 8192 Hz, equal amplitude, sum / 3, peak ramping linearly 0 → 4 | 0.5/0.5/0.5 |
| edits | 10–20 | the tones at peak 4 | the schedule, a new point every 50 ms |
| corners | 20–30 | the tones at peak 4 | 1/0/1, then 1/1/1 from 25 s |
| dc | 30–40 | +4, then −4 from 35 s, then 0 by 40 s | 0.5/0.5/0.5 |
| opposite | 40–45 | +4 pulse for 1 s, −4 for 1 s from 41 s, then 0 from 42 s | 1/0/0 |
| spikes | 45–55 | a 1 ms raised-cosine bump of ±4 every 250 ms, +4 first, alternating | 0.5/0.5/0.5 |
| silence | 55–60 | 0 | 0.5/0.5/0.5 |

The three tones peak together at 1 (every bin is 1 mod 4), so the tone
segments reach exactly |H| = 4. **Every level change is a 5 ms
raised-cosine edge** starting at its listed time: at 30, 35 and 39.995 s,
and at 40, 41 and 42 s. A jump in a closed-form field carries no
derivative, so the core, whose dM/dt is proportional to dH/dt, would never
see an instantaneous step. The first DC edge crossfades from the tones, so
H is continuous everywhere. The field is C¹ except at the end of the ramp
(10 s), where only dH/du changes.

**Control schedule.** The 200 points of the edits segment come from
`mulberry32` with **seed 204** (the engine's PRNG, read only). There are
twenty blocks, each a seeded shuffle of the nine points (eight corners and
the center) followed by one seeded interior point. So every corner and the
center are visited **twenty** times, above the declared minimum of ten, and
every 50 ms step changes the controls. A change is instantaneous at its
host frame (`configured` builds a fresh core for the new controls and M
carries over). Segment boundaries and schedule steps are exact integer host
frames at all three rates.

**Per segment** the record gives: reached, finite, resets, clips, the guard
failure with its step, time, controls and field sign, peak accepted |M|,
peak returned |slope| and nonfinite slopes, field peak before and after the
knee, and **remanence**: mean host-frame M over the segment's last 0.1 s.

**Diagnostic, no gate.** RK4/8× runs first at each rate. Its host-rate raw
state and full playback output are kept in memory for that rate only. For
the other three settings, each segment records the **maximum absolute raw
and output difference from RK4/8×**, streamed. Playback streams one-second
chunks, each led by the 32 frames the kernel reads, so every output frame
is bit-identical to the whole-array call. No samples are saved.

**Stepping loop.** `renderConditioned` takes a precomputed field and fixed
controls, so `integrate` in `program.ts` repeats its loop around the same
imported `stage` and `step`, with a stage source and control changes. On a
static ±4 center pulse at RK4/4×, 48 kHz, it reproduces `renderConditioned`'s
states, raw samples, full output and final M exactly (tested).

**Bound and stop rule.** Part 1 first, then part 2 rate-major in the order
48,000, 44,100, 96,000, and within a rate RK4/8× first, then RK4/2×, RK4/4×
and RK2/8×: **228 trajectories**. One sequential numerical child runs under
a hard **900-second wall-clock bound**, killed by the parent at the limit.
Each trajectory's summaries are journaled on completion. Recovery keeps
partial groups, missing identities and a truncated tail, and the report is
assembled afterwards with no new numerical work. No retry, extension or
overlapping job. Part 2 is about 250 million RK substeps, so completion was
expected but not promised, and an expired run's inventory would have been
the result.

**Outcome rule.** For each setting and rate: whether it survived every
control point of part 1 at both signs and every segment of part 2. If not,
the narrowest statement the evidence supports (point and sign, segment,
time, controls, polarity). Then the survival declaration: the domain,
controls, rates and settings that survived.

## Reproduce and verify

From this worktree root with Node 24 and its own linked `@windsor` packages:

```sh
node docs/research/2026-09-30-tape-dynamic-survival/measure.mjs
npx vitest run scripts/lib/tapeDynamicSurvival.test.mjs scripts/lib/tapeCandidateDomain.test.mjs --no-cache
npm run typecheck
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-dynamic-survival/*.ts
npm run lint
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-dynamic-survival/*.{ts,mjs}' scripts/lib/tapeDynamicSurvival.test.mjs
git diff --check
```

One numerical or test job at a time. The decision is
[dynamic survival](../../log/2026-09-30-tape-dynamic-survival.md).

## Results

**Run.** Complete: 228 of 228 scheduled trajectories in 266.8 seconds,
exit 0, not expired, no truncated tail, nothing missing. Apple M1 arm64,
Darwin 25.5.0, Node v24.21.0, V8 13.6.233.17-node.53, Node Float64 source
DSP, no browser. [`measurement.json`](measurement.json) records the SHA-256
of every file `measure.mjs` reaches, and the test checks them against the
committed sources. The child was run once.

### Part 1: every control point survives at every rate

All 216 static trajectories survive: finite, no guard failure, zero resets
and clips, no nonfinite slope. Final M and peak |M| are exactly
sign-symmetric in every pair.
The largest peak |M| per setting is at 1/0/0 at both signs, against the
guard at 20:

| Setting | Peak \|M\|, all nine points | Where |
|---|---|---|
| RK4/8× | 1.753 | 1/0/0 ±4 |
| RK4/2× | 2.247 | 1/0/0 ±4 |
| RK4/4× | 1.804 | 1/0/0 ±4 |
| RK2/8× | 1.752 | 1/0/0 ±4 |

These peaks are the same at all three rates. The pulse is defined in host
samples, and the equation is rate-independent (dM/dt is dM/dH × dH/dt), so a
host-sample pulse gives the same trajectory at every rate up to rounding.
In 78 of the 144 cross-rate comparisons, final M and peak |M| are
identical to the last bit. The largest returned slope
is 7.47e5 M/s.

### Part 2: every segment survives for every setting and rate

All 12 programs survive all seven segments. None has a guard failure, a
reset, a clip or a nonfinite slope. The field stays within |H| ≤ 4
(conditioned 2.5) throughout. Peak |M| per segment is similar for every
setting (in the corners segment it is 0.77–0.99); RK4/8× at 48 kHz:

| Segment | Peak \|M\| | Peak \|slope\| (M/s) | Remanence |
|---|---|---|---|
| ramp | 1.028 | 7.08e4 | −0.00186 |
| edits | 2.990 | 3.38e5 | −0.00157 |
| corners | 0.894 | 1.52e5 | −0.00133 |
| dc | 1.037 | 6.28e4 | −1.008 |
| opposite | 1.733 | 5.04e3 | −0.00694 |
| spikes | 1.021 | 6.62e3 | −0.1131 |
| silence | 0.113 | 0 | −0.1131 |

Across all 84 segment records the largest peak |M| is 2.992 (RK2/8× at
48 kHz, edits). The largest returned slope is 6.76e5 M/s, at 96 kHz, where
the tones are twice as fast. The DC remanence is dominated by the −4 hold.
Remanence after the last spike (−4) is −0.1130 to −0.1132 across settings
and rates, and five seconds of silence leave each value unchanged to five
digits: no drift and no self-oscillation. Per-segment records for every trajectory are in
`measurement.json` under `trials`.

**Diagnostic: difference from RK4/8×, no gate.** Largest raw / full-output
difference over any segment:

| Setting | 48 kHz | 44.1 kHz | 96 kHz |
|---|---|---|---|
| RK4/2× | 0.509 / 0.570 | 0.509 / 0.570 | 0.509 / 0.570 |
| RK4/4× | 0.0801 / 0.0907 | 0.0801 / 0.0907 | 0.0801 / 0.0907 |
| RK2/8× | 0.0342 / 0.0378 | 0.0313 / 0.0350 | 0.0313 / 0.0378 |

These maxima fall in the tone segments at controls 1/0/1, the corner where
#167 recorded tone misses. At 48 kHz the RK4/2× maximum in the edits segment
and in the corners segment is the same frame pair: phase 5779 of the
8192-sample tone period, with identical states. The edits segment reaches
that periodic orbit within 403 samples of switching to 1/0/1. The tones are
defined in host samples, so the tone-segment differences repeat across
rates. In the level segments (dc, opposite, spikes, silence) the
differences are at most 0.024. These are differences between candidates,
not errors against a qualified reference.

### Outcome for milestone B

- **The declared domain holds.** Every setting (RK4/2×, RK4/4×, RK4/8×,
  RK2/8×) at every rate (44.1, 48 and 96 kHz) survives part 1 at all nine
  control points and both signs, and every segment of part 2. No narrower
  statement is needed.
- **Survival declaration.** On the unchanged knee system, with field input
  |H| ≤ 4 and controls anywhere in the closed cube [0,1]³, at 44.1, 48 and
  96 kHz, RK4 at 2, 4 and 8× and RK2 at 8× survive tones, 50 ms control
  edits across every corner and the center, held DC of both polarities,
  opposite histories, spikes and silence for 60 seconds. The controls were
  sampled at the corners and center statically, and at those points plus 20
  seeded interior points dynamically.
- **This is survival, not accuracy.** #197 found no candidate within 1e-5
  of the qualified references, and the tone gates from #167 remain the
  accuracy record. The diagnostic differences above, up to 0.57 for RK4/2×,
  show the candidates disagree substantially on the corner tones.
- **Not decided here.** No default, solver or product bounding method is
  proposed. Milestone D chooses how the product keeps the field inside the
  domain.

Milestone B remains incomplete. Still unresolved: candidate accuracy on the
corner tones (RK4/4× at 1/0/1, RK2/8× at 1/0/1 and 1/1/1), resampling and
browser cost (C), latency, bypass and integration (D), and the user's
in-app audition (E).
