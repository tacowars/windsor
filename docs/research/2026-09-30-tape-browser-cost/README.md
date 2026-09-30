# Tape browser cost: four instances on a music program against phase 2

Windsor [#211](https://github.com/tacowars/windsor/issues/211) is the
milestone C child of [epic #146](https://github.com/tacowars/windsor/issues/146)
that measures browser cost. The epic's target is **four Tape instances in
under half a 48 kHz quantum, 1.33 ms, edits included**, on the recorded M1
and Chrome. Phase 3's only browser figures are coarse 1 ms duty-cycle
counters on a synthetic probe, and the epic says they cannot certify that
target. This task adds a measurement that states **mean** aggregate cost
exactly, says what it cannot say about **peak** per-quantum cost, and runs
it on a deterministic music program with control edits for every
surviving candidate, against the phase-2 baseline.

It is research only. It chooses no product solver, filter or default and
changes no shipping code. The measured code is the research implementation.
The shipping core and resampler will be original work, measured in their
own right in milestone E.

**Provenance.** The magnetic core is Jatin Chowdhury's GPL-3.0-only CHOW
Tape adaptation at upstream `604372e4ffd9690c3e283362e4598cb43edbb475`
([AUDIT](../2026-09-30-tape-phase-3/AUDIT.md),
[COPYING](../2026-09-30-tape-phase-3/COPYING)). It runs raw, with no
`knee` policy, wrapped in the resampler exactly as phase 3 wraps it. The
FIR pair and the symmetric decimator are original Windsor work from
[#207](../2026-09-30-tape-resampler/README.md). The legacy path is the
phase-2 `TapeDsp` at baseline `c83564f`, bundled from git as phase 3's
`browser.mjs` bundles it. `ResampledHysteresis`,
`SymmetricResampledHysteresis`, the phase-3 loader and report writer and
#167's journal recovery are imported unchanged. Phase 3's `browser.mjs`
runs its experiment when imported, so its harness structure is copied, not
imported.

## Declared experiment before measurement

[`costConstants.ts`](costConstants.ts) holds every value below, and it and
this section were committed before the measurement ran. The code:

- [`program.ts`](program.ts) generates the music program and its hash.
- [`costWorklet.mjs`](costWorklet.mjs) is the processor: one stereo
  instance of one configuration on the program input.
- [`browser.mjs`](browser.mjs) builds the page, launches the isolated
  Chrome, journals each record and enforces the bound.
- [`evidence.mjs`](evidence.mjs) derives every table below from the saved
  raw records.

**Configurations.** Seven, all at 48 kHz and stereo:

| Id | Role | Path |
|---|---|---|
| `legacy` | baseline | phase-2 legacy `TapeDsp` |
| `identity/4x/48s` | filter only | identity core, 4×, span 48, symmetric decimator |
| `rk4/2x/48s` | candidate | RK4, 2×, span 48, symmetric decimator |
| `rk4/4x/32` | candidate | RK4, 4×, span 32, existing decimator (phase-3 comparison) |
| `rk4/4x/48s` | candidate | RK4, 4×, span 48, symmetric decimator |
| `rk2/8x/48s` | candidate | RK2, 8×, span 48, symmetric decimator |
| `rk4/8x/48s` | candidate | RK4, 8×, span 48, symmetric decimator |

Span 48 is the cheapest span that met both #207 figures. Each
configuration runs **steady** and **with edits**, with **one** and **four**
instances: **28 offline cells**. Edits follow phase 3: every 16 quanta the
drive-equivalent control alternates between 0.8 and 0.2, unsmoothed, on
every instance. The magnetic paths call `core.configure(drive, 0.5, 0.5)`
on both channels; the identity core is configured too but never ticked.
Legacy sets its drive parameter to the same value × 12, phase 3's scale,
and is configured every quantum as phase 3 does. Steady cells keep the
research core's default drive 0.5 and legacy's default parameters.

**Program.** A deterministic 20-second stereo music-like program,
960,000 frames at 48 kHz, generated on the page into an `AudioBuffer`
before any timing:

- A two-operator FM bass line: eight one-beat notes at 120 BPM, modulator
  at 2× the carrier, with decaying depth and amplitude.
- A three-note sustained A major chord, each voice detuned by a 0.1 Hz
  sine of 0.3%.
- Hats: 20 ms bursts of high-passed noise from a seeded LCG on every
  eighth note, off-beats accented.
- A 60 Hz decaying sine on every beat.

It is mixed to a peak of **-6 dBFS**, with the same content on both
channels and the right one frame behind the left. The generator uses only
`+ − × ÷`, `floor` and `fround`, including its own polynomial sine, so no
engine's `Math.sin`, `exp` or `pow` can change a bit between Node and
Chrome. Its left-then-right little-endian Float32 bytes hash to SHA-256
`0697150ce822e1f7db1e9ef013add813f5c7393021a2ffb21565d3e23006717a` in
Node; the page recomputes the hash with Web Crypto and reports it.

**Mean cost, offline.** For each cell, a fresh `OfflineAudioContext` at
48 kHz renders the whole program: a buffer source into N processors,
summed at the destination. The worklet module is loaded and the nodes
built before timing. `performance.now()` on the main thread brackets
`startRendering()`. **Duty = render wall time / 20 s**, and
**ms per quantum = duty × 2.6667** (128 / 48000 s). Five repeats per cell,
a fresh context each, reported as median, minimum and maximum. A cell with
fewer than five repeats is **not measured**.

This is an exact mean over the render. It cannot see individual quantum
peaks. It runs on the offline renderer's thread, not the real-time audio
thread, and each repeat includes a fresh worklet scope's JIT warmup,
amortised over 7,500 quanta.

**Real time, bounded.** Each four-instance cell also runs one real-time
`AudioContext` trial, with the program looping. Phase 3's warmup of 188
quanta is followed by 750 measured quanta, two seconds. Each node keeps:

- **Phase 3's boundary counters.** The `Date.now` span of each `process`
  call gives busy time, the peak span and provable deadline misses. As
  phase 3 notes, the load estimate is coarse and the miss count is a lower
  bound. It does not count missed device output or prove that the sum of
  four nodes fits a quantum.
- **A batched counter.** Over each 64 consecutive `process` calls it
  records the elapsed `Date.now` from the first call's start to the 65th's
  start, and the calls' summed boundary counts. The elapsed figure has a
  resolution of ±1 ms / 64 per quantum. It is **wall time**, so it equals
  the quantum period while rendering keeps pace, and a batch above
  2.667 ms plus that resolution proves rendering fell behind real time
  over it. The summed counts, added across the four nodes per batch, are
  the phase-3 estimator at batch granularity. The report gives the mean
  and the maximum over batches of both.
- **`renderCapacity`.** Its `averageLoad`, `peakLoad` and `underrunRatio`
  are reported at a one-second interval if `AudioContext.renderCapacity`
  exists in this Chrome. Otherwise its absence is reported.

**Target rule.** For each configuration, exactly one mean state:

- **mean within target**: the four-instance offline medians, steady and
  edits, are both ≤ 1.33 ms per quantum;
- **mean outside target**: both are measured and either exceeds 1.33 ms;
- **not measured**: either cell has fewer than five repeats.

Peak is **unresolved**, unless `renderCapacity` was available in both
four-instance trials, reported at least one update, an `underrunRatio` of
0 and a `peakLoad` below 0.5. No candidate is called certified.

**Comparison.** Each configuration's four-instance duty is given as a
multiple of legacy's, steady and edits. The filter-only cell is given as a
share of `rk4/4x/48s`, the path that uses the same filter. The report
states whether one magnetic path is within target on mean or whether the
numbers leave room only for an inexpensive/magnetic pair. It chooses
neither.

**Run order and bound.** One `browser.mjs` run, under a hard
**900-second** wall-clock bound from the script's start, Chrome startup
included. The run order puts the cells the assessment needs first:

1. The fourteen real-time trials.
2. The fourteen four-instance offline cells.
3. The fourteen one-instance offline cells.

Within each, configurations run in the table's order, cheapest first, and
steady before edits. An expired bound therefore loses the least-needed and
most expensive cells. Each repeat and trial is journaled as it completes,
and a killed run keeps every finished record and any truncated tail. There
is no retry or overlapping job, and nothing else heavy runs on the
machine. Chrome is headless, with a temporary profile, no extensions and
muted output, as in phase 3.

Before the run, a smoke plan checked the harness: two configurations, one
repeat each, written outside the repository. It is not the measurement,
and none of its numbers appear here.

## Environment

Apple M1 arm64, Darwin 25.5.0, Node 24.21.0, Google Chrome 154.0.8037.58
(`HeadlessChrome/154.0.0.0` user agent), headless with a muted
destination; the output device is unverified. Real-time contexts ran at
48 kHz with `baseLatency` 5.81 ms and `outputLatency` 32 ms. Neither
`AudioContext.renderCapacity` nor the `AudioRenderCapacity` interface
exists in this Chrome, and `performance` is absent in the worklet scope.
Other sessions were active on the machine: the one-minute load average was
3.61 before and 3.17 after. The run is one `browser.mjs` invocation,
recorded in full in [`measurement.json`](measurement.json).

## Result

**Run.** The 900-second bound expired at 900.3 s. The page reported the
program's hash as the recorded `0697150c…3006717a`, with a peak of
-6.0000005 dBFS and 960,000 frames, so Node and Chrome timed the same
input. All **14 real-time trials** and all **14 four-instance offline
cells** completed, the latter with five repeats each. **23 of 28 offline
cells** are measured. Five one-instance cells are **not measured**, the
ones the declared order put last:

- `rk4/4x/48s`, edits: one repeat of five.
- `rk2/8x/48s` and `rk4/8x/48s`, steady and edits: none.

No core reset, clip or non-finite output occurred in any record.

**Offline mean cost.** Median ms per quantum, with the five repeats'
range. Duty is the median render time over 20 s, steady / edits.

| Configuration | Four, steady | Four, edits | Four, duty | One, steady | One, edits |
|---|---:|---:|---:|---:|---:|
| `legacy` | 0.178 (0.171–0.183) | 0.203 (0.200–0.211) | 6.7% / 7.6% | 0.051 | 0.058 |
| `identity/4x/48s` | 0.552 (0.541–0.590) | 0.549 (0.545–0.568) | 20.7% / 20.6% | 0.157 | 0.161 |
| `rk4/2x/48s` | 0.852 (0.826–0.891) | 0.832 (0.830–0.835) | 31.9% / 31.2% | 0.223 | 0.221 |
| `rk4/4x/32` | 1.479 (1.456–1.530) | 1.457 (1.454–1.464) | 55.4% / 54.7% | 0.387 | 0.383 |
| `rk4/4x/48s` | 1.687 (1.660–1.726) | 1.659 (1.657–1.730) | 63.3% / 62.2% | 0.439 | not measured |
| `rk2/8x/48s` | 2.310 (2.276–2.407) | 2.276 (2.254–2.286) | 86.6% / 85.4% | not measured | not measured |
| `rk4/8x/48s` | 3.313 (3.288–3.390) | 3.287 (3.212–3.316) | 124.2% / 123.3% | not measured | not measured |

The one-instance ranges are in the report. `rk4/8x/48s` renders offline
slower than real time.

**Real-time trials, four instances.** Boundary load is phase 3's estimate.
Batched busy is the four nodes' summed boundary counts per 64-quantum
batch, in ms per quantum. Batched wall is the elapsed time per quantum, at
a resolution of 0.016 ms. Each cell gives the mean over batches, then the
maximum. Every trial had a peak span of 1 ms and **zero provable deadline
misses**.

| Configuration | Boundary load, steady / edits | Busy, steady | Busy, edits | Wall, steady | Wall, edits |
|---|---:|---:|---:|---:|---:|
| `legacy` | 5.7% / 6.7% | 0.153 / 0.172 | 0.176 / 0.219 | 2.672 / 2.734 | 2.671 / 2.734 |
| `identity/4x/48s` | 19.4% / 19.4% | 0.517 / 0.578 | 0.516 / 0.594 | 2.671 / 2.734 | 2.671 / 2.734 |
| `rk4/2x/48s` | 26.5% / 26.9% | 0.709 / 0.828 | 0.720 / 0.766 | 2.671 / 2.734 | 2.672 / 2.734 |
| `rk4/4x/32` | 47.5% / 45.3% | 1.277 / 1.359 | 1.210 / 1.281 | 2.671 / 2.750 | 2.672 / 2.750 |
| `rk4/4x/48s` | 51.1% / 49.6% | 1.362 / 1.469 | 1.327 / 1.406 | 2.671 / 2.750 | 2.671 / 2.734 |
| `rk2/8x/48s` | 64.9% / 64.6% | 1.737 / 1.812 | 1.724 / 1.781 | 2.671 / 2.750 | 2.671 / 2.750 |
| `rk4/8x/48s` | 90.9% / 94.8% | 2.433 / 2.516 | 2.545 / 2.719 | 2.671 / 2.766 | 2.693 / 2.766 |

`renderCapacity` was absent in every trial, so no trial has an
`averageLoad`, `peakLoad` or `underrunRatio`.

**A correction to the declared reading of the wall counter.** The
declaration said one batch above 2.667 ms plus the resolution proves that
rendering fell behind. The data refute that reading. Even legacy, at
6.7% load, has batches of 175 ms (2.734 ms per quantum) next to short
ones. Batch boundaries are call starts, and calls start in device-callback
bursts whose timing jitters by a few milliseconds, so one batch's excess
is that jitter, not a lag. Only a trial's mean carries the pacing signal.
The one mean clearly above the period is `rk4/8x/48s` with edits, at
2.693 ms: its 704 batched quanta took about 18 ms longer than real time.

**The two methods disagree in level.** The real-time batched-busy
estimate is 0.73 to 0.94 of the offline median, lowest for the heaviest
paths. The offline render runs on a different thread from the real-time
audio thread, possibly at a different priority or on a different core
class, and the boundary estimator has its own bias
(`packages/engine/src/cost/audioLoad.ts`). This run does not separate
those causes. The target rule uses the offline median, as declared. The
real-time estimate would change no verdict, though it puts `rk4/4x/48s`
near the line (1.362 / 1.327 ms) where the offline median is 1.687 /
1.659 ms.

## Target assessment

The target is four instances at or under 1.33 ms per quantum, steady and
with edits, on the offline median.

| Configuration | Role | Mean | Peak |
|---|---|---|---|
| `legacy` | baseline | mean within target | unresolved: `renderCapacity` absent |
| `identity/4x/48s` | filter only | mean within target | unresolved: `renderCapacity` absent |
| `rk4/2x/48s` | candidate | **mean within target** | unresolved: `renderCapacity` absent |
| `rk4/4x/32` | candidate | mean outside target | unresolved: `renderCapacity` absent |
| `rk4/4x/48s` | candidate | mean outside target | unresolved: `renderCapacity` absent |
| `rk2/8x/48s` | candidate | mean outside target | unresolved: `renderCapacity` absent |
| `rk4/8x/48s` | candidate | mean outside target | unresolved: `renderCapacity` absent |

No candidate is certified. Peak per-quantum cost is unresolved for every
configuration: this Chrome has no `renderCapacity`, and neither `Date.now`
counter can time one quantum.

## Comparison with phase 2

Four-instance duty as a multiple of legacy's:

| Configuration | Steady | Edits |
|---|---:|---:|
| `identity/4x/48s` | 3.11× | 2.71× |
| `rk4/2x/48s` | 4.79× | 4.10× |
| `rk4/4x/32` | 8.31× | 7.18× |
| `rk4/4x/48s` | 9.49× | 8.18× |
| `rk2/8x/48s` | 12.99× | 11.22× |
| `rk4/8x/48s` | 18.63× | 16.20× |

The FIR pair alone, `identity/4x/48s`, is **32.7%** of `rk4/4x/48s`
steady and **33.1%** with edits. #207's Node share for the span-32 pair
was 20–23%; span 48 costs more, and this is a different engine context.

**One path or two.** One magnetic path is within target on mean:
**`rk4/2x/48s`**, at 0.852 ms steady and 0.832 ms with edits, 64% of the
target. Every 4× and 8× candidate is outside it on mean, including the
phase-3 filter at 4×. So the numbers do not force an inexpensive/magnetic
pair, but they allow a single magnetic core for all uses only at 2×
oversampling, with its peak cost unresolved and its accuracy not measured
here. **No product path, solver, factor, filter or default is chosen.**

## Still unresolved

- Candidate accuracy on the corner tones, including whether RK4 at 2× is
  accurate enough.
- Peak per-quantum cost. It needs `renderCapacity` or another clock that
  can time one quantum.
- The gap between the offline mean and the real-time estimate.
- The five one-instance cells this run did not reach.
- Milestone D: the product field-bounding method and the latency and
  bypass design, including the fixed `span`-sample delay.
- Milestone E: the original shipping implementation and its own
  measurement.
- The audition.

## Reproduce

Run from the repo root on Node 24, with nothing else heavy on the machine:

```bash
node docs/research/2026-09-30-tape-browser-cost/browser.mjs
npx vitest run scripts/lib/tapeBrowserCost.test.mjs
```

`TAPE_CHROME` overrides the Chrome path. The tests recompute every table
in the report from its raw records and check the program's hash in Node.
