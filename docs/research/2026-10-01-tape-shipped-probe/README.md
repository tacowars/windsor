# Tape shipped probe: the full guard matrix and the shipped bundle's cost

Windsor [#250](https://github.com/tacowars/windsor/issues/250) is E2b, the
research-only companion to E2
([#224](https://github.com/tacowars/windsor/issues/224), PR #237, merged as
`39bf4ff`) in [epic #146](https://github.com/tacowars/windsor/issues/146).
E2 wired the magnetic core into the Tape insert and kept only subsets of the
design record's tests (c) and (e) in vitest, to stay fast. This task runs
both matrices in full as bounded scripts, and measures the shipped Tape
worklet bundle's four-instance browser cost at 2× and 4×, so the audition
(E3, [#246](https://github.com/tacowars/windsor/issues/246)) and the later
removal of the losing factor rest on numbers from the code that ships.

It changes nothing a user can click or hear, and it chooses no factor:
tacowars's A/B decides that. The measured code is the shipped code at
`fa88494` (main after #249): part 1 imports the `TapeDsp` source from
`packages/engine/src/worklet/tape/`, and part 2 loads the generated
`packages/engine/src/worklet/generated/tape-processor.js` byte for byte.

**Reuse, read-only.** Part 1 drives the DSP through the engine fixture's
`renderTape` (`packages/engine/src/__fixtures__/tapeDspProbe.ts`), which
reads the left core's stage points, guard and reset counters after every
host sample, exactly as E2's tests read them. Part 2 reuses #211's music
program ([`program.ts`](../2026-09-30-tape-browser-cost/program.ts)), its
constants, its run order and its cell, real-time and assessment functions
([`evidence.mjs`](../2026-09-30-tape-browser-cost/evidence.mjs)). Phase 3's
loader and report writer and #167's journal recovery are imported
unchanged. #211's `browser.mjs` runs its experiment when imported and its
`costWorklet.mjs` wraps the research cores, so both are copied and adapted
here, not imported.

## Declared experiment before measurement

[`probeConstants.ts`](probeConstants.ts) holds every value below, and it,
the scripts and this section were committed before either run.

- [`probe.mjs`](probe.mjs) runs part 1 in one child process under the
  parent's bound and journals each cell.
- [`costWorklet.mjs`](costWorklet.mjs) is part 2's processor: the shipped
  bundle's text, evaluated with `registerProcessor` captured as the engine's
  `__fixtures__/tapeHarness.ts` evaluates it in Node, and subclassed only to
  add #211's counters around the shipped `process`.
- [`browser.mjs`](browser.mjs) builds the page, launches the isolated
  Chrome, journals each record and enforces part 2's bound.
- [`evidence.mjs`](evidence.mjs) derives every table below from the saved
  raw records in [`measurement.json`](measurement.json).

### Part 1: the guard probe matrix, Node

Every cell builds a fresh shipped `TapeDsp` at its rate with Tape's defaults
plus the cell's model, Bias, Drive and `oversampling`, feeds the same input
to both channels, and calls `configure` once per 128 samples and `tick` per
sample, as the processor does. The left core is read after every host
sample (the right core sees the same input). Each cell records:

- **guards**: the field guard's clipped stage points over the render;
- **resets**: the core's state-guard resets over the render;
- **field**: the peak source field at the core, the knee undone (so at most
  4 when the guard holds);
- **peakM**: the peak |M|, the core's magnetization after each host sample
  (the state guard is at 20);
- **outputPeak** and **nonfinite**: the left output's peak and its
  non-finite sample count.

**Test (c)**, 2,520 cells of 0.25 s: every model (Studio, Ferric, Vintage,
15ips Studio, Chrome, Metal, VHS) × Bias {−100, 0, +100} × Drive {−32, −16,
0, +16, +32} × rate {44,100, 48,000, 96,000} × factor {2, 4} × signal:

- a full-scale 100 Hz sine and a full-scale 1 kHz sine, from the engine's
  portable `sine`;
- an impulse: +1 at 20 ms and −1 at 100 ms;
- a step: 0 → 1 → 0 → −1 → 0, each held 40 ms.

**The (c) assertion** is the design record's: the reset count is zero in
every (c) cell. Any reset fails it and names the cell as a **blocker for
E**, to be reported to the main session. The guard count is recorded, not
forbidden. A run that records no reset but misses cells leaves the
assertion **incomplete**, not passed.

**Test (e)**, 84 cells of 10 s: every model × rate × factor × signal, at
Bias 0 and Drive 0, at +12 dB over full scale:

- white noise, uniform over ±8 from a mulberry32 stream seeded 250 afresh
  in each cell, hard-clipped at ±4 (E2's smoke signal);
- full-scale alternating-sign input, ±4 on alternate samples.

Each (e) cell also records its resets in each of the ten seconds and the
time of its first reset. **(e) resets are reported as counts and rates with
no gate**: the design record calls them a known limit of the qualified
domain.

**Run order**: every (c) cell first (model, then Bias, Drive, rate, factor,
signal), then every (e) cell (factor, then rate, model, signal).

### Part 2: the shipped bundle's cost, headless Chrome

#211's harness, unchanged in method, on the shipped processor:

- **Configurations**: `shipped/2x` and `shipped/4x`, the shipped processor
  with its `oversampling` parameter at 2 or 4 (set as `parameterData`, so
  the DSP is built at that factor and the parameter holds it). Every other
  parameter is Tape's default: Studio, Bias 0, Drive 0, no motion, hiss off,
  Mix 1.
- **Cells**: each configuration **steady** and **with edits**, with **one**
  and **four** instances: **8 offline cells** and **4 four-instance
  real-time trials**.
- **Edits**: the same 16-quanta alternation as #211, on the real `drive`
  AudioParam as `setValueAtTime` events over the program: #211's research
  control values 0.8 and 0.2 map linearly onto Drive's range [−32, 32] as
  **+19.2 and −19.2**, high first. The parameter steps; the DSP smooths
  Drive per sample, as it always does.
- **Program**: #211's deterministic 20-second stereo program, 960,000
  frames at 48 kHz, peak −6 dBFS, generated on the page. Its SHA-256 must
  be `0697150ce822e1f7db1e9ef013add813f5c7393021a2ffb21565d3e23006717a`;
  the page recomputes it with Web Crypto and reports it.
- **Mean cost, offline**: a fresh `OfflineAudioContext` at 48 kHz per
  repeat renders the whole program through N processors; `performance.now()`
  brackets `startRendering()`. **ms per quantum = render wall time / 20 s ×
  2.6667**. **Five repeats** per cell, reported as median, minimum and
  maximum. A cell with fewer than five repeats is **not measured**.
- **Real time**: one `AudioContext` trial per four-instance cell, the
  program looping, #211's 188-quantum warmup and 750 measured quanta, with
  #211's boundary counters, its batched `Date.now` counter over 64 quanta,
  and `renderCapacity` if this Chrome has it.
- **Checks**: each processor reports the factor its DSP actually selected,
  and its resets and guard count at both factors on both channels; every
  report's factor must match its configuration.

**Target rule**, #211's: each four-instance cell is **within target** when
its offline median is ≤ **1.33 ms** per quantum, else **outside target**;
a configuration is **mean within target** when both its four-instance cells
are. One-instance cells are reported, not assessed. Peak is **unresolved**
unless `renderCapacity` shows no underrun and a `peakLoad` below 0.5 in
both trials.

**Comparison**: each four-instance median over #211's research-adapter
median for the same factor at span 48 (`rk4/2x/48s`: 0.852 ms steady,
0.832 edits; `rk4/4x/48s`: 1.687 ms steady, 1.659 edits), read from
[#211's saved report](../2026-09-30-tape-browser-cost/measurement.json).
The caveat: the shipped path is not the research adapter. It adds the
retained Bias and model EQ, the DC block, the transport delay, hiss and
dropouts, the dry ring and Drive smoothing; and its interpolator
reconstructs the field and, through the kernel-derivative FIR, its slope at
every RK4 stage point (twice per oversampled step, two FIRs each), where the
research adapter interpolates once per step and takes a finite-difference
slope.

**Run order**, #211's: the four real-time trials, then the four
four-instance offline cells, then the four one-instance cells; 2× before
4×, steady before edits.

### Bound

Two sequential bounded jobs, part 1 first, each under a hard
**900-second** wall-clock bound: part 1's parent kills its child at 900 s,
as in #188; part 2's bound runs from the script's start, Chrome startup
included, as in #211. Each journals every cell or record as it completes,
and a killed run keeps every finished record and any truncated tail. There
is no retry or overlapping job, and nothing else heavy runs during part 2.
An expired run's inventory is the result.

Before the runs, each harness ran its smoke plan (part 1: the first two
cells of each matrix; part 2: `shipped/2x`, one repeat), written outside
the repository. They are not the measurement, and none of their numbers
appear here.

### Outcome

Two tables and three plain statements: whether any (c) cell reset; the (e)
reset rates per factor and rate; and whether the shipped 2× and 4× paths
are within the four-instance mean target on this machine. No product
choice.

## Environment

Apple M1 arm64 (8 cores), Darwin 25.5.0. Part 1: Node 24.21.0, V8
13.6.233.17-node.53, Float64 in Node, no browser. Part 2: Google Chrome
154.0.8037.58 (`HeadlessChrome/154.0.0.0` user agent), headless with a
muted destination; the output device is unverified. Real-time contexts ran
at 48 kHz with `baseLatency` 5.81 ms and `outputLatency` 32 ms. Neither
`AudioContext.renderCapacity` nor the `AudioRenderCapacity` interface
exists in this Chrome. The shipped bundle measured has SHA-256
`a5779057286c10c02b0e1b8dd9aca0aff981c8e041dc8138ea2a243c8c815a6f`. Both
runs were at `a11ad37`, which is `fa88494` plus this folder's declaration.
Other sessions were active on the machine, one of them with its own
headless Chrome for a UI look: the one-minute load average was 3.79 before
part 1 and 3.06 after, and 3.06 before part 2 and 2.81 after. Each part is
one invocation, recorded in full in [`measurement.json`](measurement.json).

## Result, part 1: test (c), the guard matrix

**Run.** The child finished in **268.5 s** of the 900-second bound, with
exit 0, no expiry and no truncated tail. It recorded **2,520 of 2,520 (c)
cells** and **84 of 84 (e) cells**. No cell of either test produced a
non-finite output sample.

**No (c) cell reset: the assertion passes, and there is no blocker for
E.** The guard engaged in 518 of the 2,520 cells, all at Drive 0 and
above (26 cells at 0, 158 at +16 and 334 at +32), never at −16 or −32.
Wherever it engaged, the field at the core was held at exactly 4. Per model
and Bias, over its 120 cells (5 Drives × 3 rates × 2 factors × 4 signals):

| Model | Bias | Guarded cells | Guard count | Peak field | Peak \|M\| | Output peak | Resets |
|---|---:|---:|---:|---:|---:|---:|---:|
| Studio | −100 | 24 | 936,088 | 4.000 | 1.024 | 1.774 | 0 |
| Studio | 0 | 24 | 114,481 | 4.000 | 1.380 | 3.295 | 0 |
| Studio | +100 | 32 | 362,725 | 4.000 | 14.782 | 16.766 | 0 |
| Ferric | −100 | 36 | 1,316,027 | 4.000 | 1.021 | 1.850 | 0 |
| Ferric | 0 | 18 | 659,231 | 4.000 | 1.029 | 1.718 | 0 |
| Ferric | +100 | 30 | 496,747 | 4.000 | 1.463 | 3.506 | 0 |
| Vintage | −100 | 24 | 532,919 | 4.000 | 1.021 | 2.201 | 0 |
| Vintage | 0 | 12 | 227,640 | 4.000 | 1.029 | 2.662 | 0 |
| Vintage | +100 | 28 | 548,788 | 4.000 | 1.737 | 3.465 | 0 |
| 15ips Studio | −100 | 30 | 1,170,010 | 4.000 | 1.023 | 2.325 | 0 |
| 15ips Studio | 0 | 18 | 475,116 | 4.000 | 1.147 | 1.972 | 0 |
| 15ips Studio | +100 | 30 | 351,932 | 4.000 | 3.832 | 7.054 | 0 |
| Chrome | −100 | 24 | 987,923 | 4.000 | 1.022 | 1.818 | 0 |
| Chrome | 0 | 12 | 294,203 | 4.000 | 1.212 | 2.107 | 0 |
| Chrome | +100 | 30 | 343,245 | 4.000 | 5.666 | 6.418 | 0 |
| Metal | −100 | 30 | 999,280 | 4.000 | 1.023 | 1.829 | 0 |
| Metal | 0 | 12 | 304,559 | 4.000 | 1.240 | 2.228 | 0 |
| Metal | +100 | 30 | 292,924 | 4.000 | 10.187 | 11.586 | 0 |
| VHS | −100 | 30 | 1,271,819 | 4.000 | 1.022 | 1.844 | 0 |
| VHS | 0 | 18 | 611,225 | 4.000 | 1.023 | 1.703 | 0 |
| VHS | +100 | 26 | 454,704 | 4.000 | 1.297 | 3.188 | 0 |

The report's `probeByRate` gives the same figures per factor, rate and
signal. The (c) cells come closest to the state guard of 20 on the
**impulse at Bias +100 and Drive +32 at 2×**, and the eight largest peaks of
|M| are all of that kind. Studio reaches 14.78 at 96 kHz (output peak
16.77) and 12.8–12.9 at 44.1 and 48 kHz, Metal reaches 8.9–10.2 and Chrome
5.2–5.7. At 4× the same impulses stay under 4.0. All 24 cells with a peak
|M| above 2 are impulses or steps at Bias +100 and Drive +32. None of them
reset, so this is margin, not failure: the largest is 26% below the state
guard.

## Result, part 1: test (e), the slew rates

Resets per factor, rate and signal, summed over the seven models at Bias 0
and Drive 0 with 10 s each. The per-second rate is per model. **These are
reported, not gated.**

| Factor | Rate | Signal | Resets | Mean /s | Max /s | Models resetting | First reset (s) | Peak \|M\| | Output peak |
|---|---:|---|---:|---:|---:|---|---:|---:|---:|
| 2× | 44,100 | noise | 10,372 | 148.2 | 783.7 | 4 of 7 | 0.0007 | 20.00 | 36.85 |
| 2× | 44,100 | alternating | 0 | 0.0 | 0.0 | 0 of 7 | — | 2.63 | 3.08 |
| 2× | 48,000 | noise | 12,191 | 174.2 | 919.9 | 4 of 7 | 0.0009 | 20.00 | 36.02 |
| 2× | 48,000 | alternating | 0 | 0.0 | 0.0 | 0 of 7 | — | 2.68 | 3.14 |
| 2× | 96,000 | noise | 36,064 | 515.2 | 2,821.3 | 3 of 7 | 0.0003 | 20.00 | 37.64 |
| 2× | 96,000 | alternating | 0 | 0.0 | 0.0 | 0 of 7 | — | 3.16 | 3.67 |
| 4× | 44,100 | noise | 0 | 0.0 | 0.0 | 0 of 7 | — | 16.58 | 21.70 |
| 4× | 44,100 | alternating | 0 | 0.0 | 0.0 | 0 of 7 | — | 1.08 | 1.29 |
| 4× | 48,000 | noise | 0 | 0.0 | 0.0 | 0 of 7 | — | 18.51 | 24.23 |
| 4× | 48,000 | alternating | 0 | 0.0 | 0.0 | 0 of 7 | — | 1.08 | 1.26 |
| 4× | 96,000 | noise | 5 | 0.1 | 0.5 | 1 of 7 | 0.5579 | 17.83 | 22.86 |
| 4× | 96,000 | alternating | 0 | 0.0 | 0.0 | 0 of 7 | — | 1.10 | 1.31 |

At 2×, clipped noise resets three models at every rate: Studio (7,837,
9,199 and 28,213 resets at 44.1, 48 and 96 kHz), Metal (1,969, 2,434 and
7,156) and Chrome (550, 552 and 695). It resets 15ips Studio at 44.1 and
48 kHz only (16 and 6). Studio and Metal reset within the first
millisecond. Ferric, Vintage and VHS never reset. At 4×, only Studio at
96 kHz resets, 5 times in 10 s, the first at 0.56 s. Alternating ±4 resets
nothing at either factor. The resets are steady rather than bursty: in the
nine cells with over 100 resets, each one-second count stays within 24% of
that cell's mean (Studio and Metal within 9%).

## Result, part 2: the shipped bundle's cost

**Run.** The page finished in **310.4 s** of the 900-second bound, with no
expiry, no error and no truncated tail. It reported the program's hash as
the recorded `0697150c…3006717a`, with 960,000 frames at −6.0000005 dBFS,
so the input is #211's. All **8 offline cells** have five repeats, and all
**4 real-time trials** completed. Every processor reported the factor its
configuration set. No record had a core reset, a guard engagement or a
non-finite output sample.

**Offline mean cost**, in ms per quantum: the median of five repeats with
their range, and the verdict against the 1.33 ms four-instance target:

| Configuration | Instances | Mode | Median | Range | Duty | Verdict |
|---|---:|---|---:|---:|---:|---|
| `shipped/2x` | 4 | steady | 1.087 | 1.077–1.093 | 40.8% | within target |
| `shipped/2x` | 4 | edits | 1.084 | 1.078–1.137 | 40.6% | within target |
| `shipped/4x` | 4 | steady | 2.075 | 1.991–2.207 | 77.8% | outside target |
| `shipped/4x` | 4 | edits | 2.110 | 2.005–2.257 | 79.1% | outside target |
| `shipped/2x` | 1 | steady | 0.267 | 0.267–0.269 | 10.0% | one instance: not assessed |
| `shipped/2x` | 1 | edits | 0.270 | 0.269–0.270 | 10.1% | one instance: not assessed |
| `shipped/4x` | 1 | steady | 0.497 | 0.496–0.533 | 18.6% | one instance: not assessed |
| `shipped/4x` | 1 | edits | 0.512 | 0.500–0.543 | 19.2% | one instance: not assessed |

**Against #211's research adapter**, with four instances: the shipped
median divided by the research median.

| Shipped | Research cell | Research, steady / edits | Ratio, steady | Ratio, edits |
|---|---|---:|---:|---:|
| `shipped/2x` | `rk4/2x/48s` | 0.852 / 0.832 | 1.28× | 1.30× |
| `shipped/4x` | `rk4/4x/48s` | 1.687 / 1.659 | 1.23× | 1.27× |

The shipped path costs 23–30% more than the research adapter at the same
factor. The caveat declared above applies: it is not the same code. The
shipped path runs the retained EQ, transport, hiss and dropouts around the
core, and its interpolator runs the kernel-derivative FIR at every stage
point. This run does not separate those costs.

**Real-time trials, four instances.** Boundary load is #211's estimate.
Batched busy is the four nodes' summed boundary counts per 64-quantum
batch, in ms per quantum, and batched wall is the elapsed time per
quantum. Each gives the mean over batches, then the maximum. Every trial
had a peak span of 1 ms.

| Configuration | Mode | Boundary load | Busy, mean / max | Wall, mean / max | Provable misses |
|---|---|---:|---:|---:|---:|
| `shipped/2x` | steady | 46.1% | 1.232 / 1.297 | 2.672 / 2.750 | 0 |
| `shipped/2x` | edits | 47.1% | 1.257 / 1.344 | 2.671 / 2.750 | 0 |
| `shipped/4x` | steady | 77.5% | 2.074 / 2.156 | 2.671 / 2.750 | 0 |
| `shipped/4x` | edits | 77.8% | 2.074 / 2.141 | 2.671 / 2.766 | 0 |

`renderCapacity` was absent in every trial. The wall means sit at the
quantum period, so rendering kept pace. At 2× the real-time busy estimate
is 1.13–1.16× the offline median, and at 4× it equals the offline median.
In #211 it was 0.73–0.94× the offline median. As #211 says, the two
methods run on different threads, and this run does not separate the
causes. The target rule uses the offline median, as declared. The
real-time estimate would change no verdict, though at 2× its means (1.232
and 1.257 ms) sit nearer the line.

**Target assessment.**

| Configuration | Mean | Peak |
|---|---|---|
| `shipped/2x` | **mean within target** (1.087 / 1.084 ms, 82% of 1.33) | unresolved: `renderCapacity` absent |
| `shipped/4x` | mean outside target (2.075 / 2.110 ms, 156–159% of 1.33) | unresolved: `renderCapacity` absent |

## The three statements

1. **No (c) cell reset.** All 2,520 cells of test (c) finished with a
   reset count of zero, across every model, Bias, Drive, rate, factor and
   signal. There is no blocker for E.
2. **The (e) reset rates.** Sustained clipped white noise at +12 dB over
   full scale resets the core at 2× on four of the seven models at 44.1
   and 48 kHz, with means of 148 and 174 resets per second per model (up
   to 784 and 920). At 96 kHz it resets three models, with a mean of 515
   per second (up to 2,821). At 4× it resets only Studio at 96 kHz, 5
   times in 10 s (a mean of 0.07 per second across the models).
   Alternating ±4 resets nothing at either factor. These counts are
   recorded, not gated: the design record calls them a known limit of the
   qualified domain.
3. **Cost.** On this M1 with Chrome 154, the shipped **2×** path is
   **within** the four-instance mean target (1.087 ms steady and 1.084 ms
   with edits, against 1.33 ms). The shipped **4×** path is **outside** it
   (2.075 ms and 2.110 ms). Peak cost is unresolved for both.

**No product choice is made here.** Which factor ships is decided by
tacowars's A/B in E3.

## Reproduce

Run from the repo root on Node 24, part 1 first, with nothing else heavy on
the machine:

```bash
node docs/research/2026-10-01-tape-shipped-probe/probe.mjs
node docs/research/2026-10-01-tape-shipped-probe/browser.mjs
npx vitest run scripts/lib/tapeShippedProbe.test.mjs
```

Each script replaces only its own part's keys in `measurement.json`.
`TAPE_CHROME` overrides the Chrome path. The tests recompute every table in
the report from its raw records.
