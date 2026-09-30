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
