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
