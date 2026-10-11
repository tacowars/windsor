# What the bloom insert costs (windsor#712)

bloom is Windsor's pad-generator insert: it follows the pitch of its input
in 48 semitone bands (F2 to E6) and answers each note with a band-limited
waveform (record `docs/log/2026-10-11-bloom-insert.md`). This note measures
its cost on Chrome's real-time audio thread: first a comparison of ways to
run the analysis and the partial sum, then the generated bundle through five
builds, then where the current build's time goes and what would still cut
it.

**The current build: four instances at defaults take 31 % of the quantum
in the worst case (every band sounding) and 17 % for a typical chord, at
both 48 and 96 kHz.** That is 0.20 and 0.12 ms a quantum an instance at
48 kHz, 0.10 and 0.06 ms at 96 kHz. The cost was accepted as it stands;
the savings ranked [below](#remaining-savings-future-work) are future work.

## Setup

- **Machine:** Apple M1 (4 performance and 4 efficiency cores, 16 GB),
  macOS 26. Never quiet: other sessions shared it, load average 1.5 to 6.8
  across the day (each run below gives its own).
- **Browser:** headless Chrome 155.0.8059.40, arm64, the project's
  `chrome-devtools-mcp` instance, pages served from `127.0.0.1` by a static
  server.
- **Backend:** a real-time `AudioContext` (`latencyHint: 'playback'`) at
  48 and 96 kHz, 128-frame quanta. The real-time thread was used because
  it is the one the insert plays on; on this machine the offline render
  thread ran the same JavaScript 2 to 4 times slower in an earlier check,
  so offline wall time would overstate the cost.
- **Budget:** one quantum, **2.667 ms at 48 kHz** and **1.333 ms at
  96 kHz**. A share is ms per quantum over that.

### The bundle bench

`bundle.html` with `inputs.js`. Serve the repository root and open
`/docs/research/2026-10-11-bloom-insert/bundle.html?seconds=16&rates=48000,96000`.
For each rate and input it builds a fresh context, loads
`packages/engine/src/worklet/generated/bloom-processor.js`, and runs **four
`bloom` nodes at defaults** on one looping 4 s input. After 3 s unmetered it
turns on each node's load sampler (`packages/engine/src/worklet/loadSampler.ts`,
`reportLoad`, a report a second) and meters 16 s. The figure is the summed
busy ms over the summed quanta, per instance. Results go to `window.__res`.

The inputs, mono into both channels, peak −6 dBFS:

- **`sines48`, the worst case:** one sine at each band centre, so all 48
  bands sound on every quantum.
- **`chord4`, a typical case:** A3, C♯4, E4 and A4. About 7 to 8 bands
  sound on average, the chord's notes and their neighbours.

Every run below is two passes. Peaks were 1 ms (the sampler's resolution),
with 0 underruns, and every context stayed `running`.

### The Node bench

`node-bench.mjs`, run from the repository root:
`node docs/research/2026-10-11-bloom-insert/node-bench.mjs --rate 48000 --input chord4`.
It loads the same bundle into a stand-in `AudioWorkletGlobalScope` and calls
`process` directly on the same inputs, `--instances` processors interleaved
quantum by quantum. The first pass is warm-up; the figure is the best of the
rest. It also prints a checksum (FNV-1a over instance 0's output), so a
change meant to be bit-exact can prove it, and the mean bands at work.
`--bundle` times a candidate build against the same checksum. Node 24.21.0,
main thread.

## Kernel comparison

Before the bundle existed: plain-JS kernels of the per-sample work, to pick
the analysis rate and the partial-sum method (`bloom-kernels.js`,
`bench-worklet.js`, `index.html`; serve this folder and open `index.html`).
A cell is one quantum of a simplified bloom on a three-sine input: the 48
bands (two-pole complex Butterworth band-passes, half-bandwidth
0.0192 f + 0.93 Hz) with their selection test, the shared detector
(Blackman FIR at 1.7 kHz, peak hold, attack and release, ratio 1.8), and N
**forced** sounding bands, each with its ceiling, amplitude ramp, 16
band-limited partials and pan. No allocation in `quantum()`, and no `Math`
transcendental on a per-sample path except `Math.sqrt` (and the `mathsin`
reference).

Each cell runs as one `AudioWorkletNode` in a fresh real-time context: 300
warm-up calls, a 20 ms chunk to size K quanta a call to about half a
quantum, then 2.5 s of calls, the cost being the sum of each call's
`Date.now()` crossings (the load sampler's estimator of the mean), with a
final 50 ms timed chunk as a cross-check. `performance.now` does not exist in
the worklet scope in Chrome 155.

- **Analysis.** `full` runs the bands and the detector FIR (32 taps at
  48 kHz, 64 at 96 kHz) at the sample rate. `dec4` and `dec8` run the FIR
  every D-th sample as a polyphase decimator that is also the detector's
  low-pass, and the bands at fs/D, 12 kHz.
- **Phasor between analysis steps.** The recursions rotate by the step's
  D-th root, taken by half-angles (`sqrt` only); the table takes a
  polynomial `atan2` a step and ramps the unwrapped phase. A linear lerp of
  the phasor would bend the phase by 0.1 rad at partial 16.
- **Synthesis, per sounding band per sample:** `pow` (u^k, 16 complex
  multiplies), `cheb` (Chebyshev recurrence), `clen` (Clenshaw summation),
  `table` (a 2048-point table with linear interpolation, 16 cumulative
  band-limit levels), and two references, `blep` (a PolyBLEP saw, which
  can't take arbitrary weights) and `mathsin` (16 `Math.sin` a sample).
  `rebuild` regenerates all 16 table levels, the cost of a Shape or Bright
  move.

Under Node (1 s, N = 48), `pow`, `cheb` and `clen` match `mathsin` to
−111 dB and `table` to −91 dB, so the methods compute the same signal.

ms per quantum, **one instance**, median of three passes (min–max); share
is the median over the quantum.

**Analysis only** (N = 0)

| Cell | 48 kHz ms/q | 48 kHz share | 96 kHz ms/q | 96 kHz share |
|---|---:|---:|---:|---:|
| harness only (`empty`) | 0.001 | 0.0 % | 0.001 | 0.1 % |
| `full` (48 bands at fs, FIR every sample) | 0.044 (0.043–0.070) | 1.7 % | 0.066 (0.048–0.071) | 4.9 % |
| `dec4` | 0.013 (0.012–0.014) | 0.5 % | 0.016 (0.013–0.019) | 1.2 % |
| `dec8` | 0.008 (0.008–0.010) | 0.3 % | 0.011 (0.008–0.012) | 0.8 % |
| table rebuild, 16 levels (`rebuild`) | 0.032 (0.032–0.047) | 1.2 % | 0.040 (0.033–0.049) | 3.0 % |

**Analysis and synthesis of N sounding bands**, totals, 48 kHz (decimated
rows use `dec4`)

| Method | N = 1 | N = 4 | N = 12 | N = 48 | N = 48 share |
|---|---:|---:|---:|---:|---:|
| `full` + `clen` | 0.047 (0.046–0.052) | 0.064 (0.056–0.076) | 0.120 (0.077–0.128) | 0.276 (0.176–0.303) | 10.3 % |
| `full` + `pow` | 0.049 (0.047–0.078) | 0.085 (0.059–0.087) | 0.098 (0.086–0.136) | 0.331 (0.212–0.432) | 12.4 % |
| `dec4` + `pow` | 0.016 (0.015–0.026) | 0.040 (0.024–0.044) | 0.051 (0.050–0.073) | 0.180 (0.176–0.230) | 6.8 % |
| `dec4` + `cheb` | 0.020 (0.018–0.026) | 0.029 (0.024–0.030) | 0.064 (0.039–0.068) | 0.116 (0.111–0.189) | 4.3 % |
| `dec4` + `clen` | 0.015 (0.015–0.022) | 0.024 (0.022–0.037) | 0.046 (0.040–0.055) | 0.151 (0.122–0.220) | 5.7 % |
| **`dec4` + `table`** | 0.020 (0.013–0.023) | **0.019** (0.016–0.029) | 0.023 (0.023–0.038) | **0.058** (0.054–0.070) | **2.2 %** |
| `dec4` + `blep` (reference) | 0.019 (0.014–0.020) | 0.019 (0.016–0.022) | 0.023 (0.022–0.034) | 0.057 (0.047–0.065) | 2.1 % |
| `dec4` + `mathsin` (reference) | 0.046 (0.033–0.056) | 0.102 (0.086–0.135) | 0.227 (0.224–0.424) | 1.002 (0.916–1.002) | 37.6 % |

96 kHz (decimated rows use `dec8`)

| Method | N = 1 | N = 4 | N = 12 | N = 48 | N = 48 share |
|---|---:|---:|---:|---:|---:|
| `full` + `clen` | 0.060 (0.052–0.063) | 0.062 (0.061–0.084) | 0.099 (0.084–0.100) | 0.345 (0.180–0.371) | 25.9 % |
| `full` + `pow` | 0.070 (0.050–0.075) | 0.066 (0.062–0.089) | 0.149 (0.089–0.151) | 0.259 (0.215–0.381) | 19.4 % |
| `dec8` + `pow` | 0.013 (0.010–0.019) | 0.019 (0.019–0.033) | 0.041 (0.041–0.069) | 0.144 (0.142–0.210) | 10.8 % |
| `dec8` + `cheb` | 0.011 (0.010–0.016) | 0.021 (0.016–0.027) | 0.037 (0.032–0.052) | 0.116 (0.107–0.210) | 8.7 % |
| `dec8` + `clen` | 0.013 (0.010–0.016) | 0.024 (0.019–0.026) | 0.053 (0.045–0.056) | 0.194 (0.159–0.211) | 14.6 % |
| **`dec8` + `table`** | 0.012 (0.008–0.015) | **0.015** (0.011–0.017) | 0.019 (0.019–0.027) | **0.059** (0.058–0.063) | **4.4 %** |
| `dec8` + `blep` (reference) | 0.013 (0.011–0.013) | 0.014 (0.014–0.016) | 0.020 (0.017–0.025) | 0.041 (0.036–0.048) | 3.1 % |
| `dec8` + `mathsin` (reference) | 0.034 (0.024–0.035) | 0.093 (0.074–0.108) | 0.244 (0.220–0.253) | 0.885 (0.873–0.888) | 66.4 % |

- **Decimate the analysis.** The bands and detector at 12 kHz cost
  0.013 ms (48 kHz) and 0.011 ms (96 kHz), against 0.044 and 0.066 ms at
  the full rate. The bands sit below 1.41 kHz, so fs/4 at 44.1 and 48 kHz
  and fs/8 at 88.2 and 96 kHz leave room for the decimator.
- **The three recursions cost about the same** at N = 48 (0.12 to
  0.18 ms medians, within the noise): their cost is the 16-partial inner
  loop.
- **The wavetable is 2 to 3 times cheaper at 48 bands** (0.058 ms), about a
  PolyBLEP saw's cost, and hardly depends on Shape, Bright or the partial
  count. It takes a fractional ratio (Octave +7, +19) for free.
- **`Math.sin` additive is out:** 1 ms at 48 bands, 38 % of the 48 kHz
  quantum for one instance.
- **Small cells are noise.** At N ≤ 4 the ranges overlap across methods;
  only the N = 48 medians separate. The burst cross-check agreed with the
  crossing estimate within a few percent on the quieter passes.

These led the builds: analysis decimated to about 12 kHz with the
decimator doubling as the detector's low-pass, and wavetable synthesis.

## The bundle, build by build

Four instances at defaults, % of the quantum, from the bundle bench. Each
build was measured after it was made, so each row is a different run and
load; within a row, the two passes agreed within the noted spread.

| Build | What changed | 48 kHz worst | 48 kHz typical | 96 kHz worst | 96 kHz typical |
|---|---|---:|---:|---:|---:|
| 1st | Full-rate analysis with a 255-tap detector FIR; recursive partial sum | 40 % | 24 % | 81 % | 48 % |
| 2nd | Analysis decimated to about 12 kHz, feeding a host-rate synthesis | 35 % | 18 % | 47 % | 23 % |
| 3rd | Wavetable synthesis carrying each shape's full series to the band limit (up to about 270 partials a band), a one-pole darkening filter a band, a fixed FIR on the summed layer | 40 % | 24 % | 44 % | 26 % |
| 4th | Synthesis in segments of about 1/6000 s (8 / 16 host samples), halving the per-band setup | 40 % | 26 % | 43 % | 27 % |
| **5th, current** | A band's darkening recomputed only when its corner has moved more than 0.5 % | **31 %** | **17 %** | **31 %** | **17 %** |

The current build, per instance, pass 1 / pass 2, against the Node bench
on the same bundle (one instance, best of passes 2 to 4, run before each
Chrome pass, the same checksum both times):

| Rate | Input | Chrome ms/q | One instance | Node ms/q | Chrome ÷ Node |
|---|---|---:|---:|---:|---:|
| 48 kHz | `sines48` | 0.211 / 0.196 | 7.6 % | 0.147 / 0.148 | 1.38 |
| 48 kHz | `chord4` | 0.127 / 0.105 | 4.3 % | 0.050 / 0.050 | 2.3 |
| 96 kHz | `sines48` | 0.102 / 0.105 | 7.8 % | 0.087 / 0.087 | 1.19 |
| 96 kHz | `chord4` | 0.061 / 0.054 | 4.3 % | 0.031 / 0.031 | 1.9 |

Load during the current build's run: 2.0 and 2.05 before the passes, 1.5
at the end, no other process over about 22 % of a core. The passes agreed
within 7 % (`sines48`, 48 kHz), 3 % (`sines48`, 96 kHz) and 11 to 19 %
(`chord4`).

- **The kernels' saving did not carry over whole.** Decimating the analysis
  (2nd) halved the 96 kHz cost but took only 13 to 25 % at 48 kHz. The
  full-series wavetable (3rd) cost more than the 2nd build at 48 kHz: its
  per-band darkening and summed-layer FIR are per-sample work the kernels
  did not have, and its tables are deeper than the kernel's 2048 points.
- **The segment change (4th) bought nothing in Chrome**, all four cells
  within the noise, though Node read it about 35 % cheaper. Most likely
  Chrome's V8 had already made that setup cheap; not verified.
- **The darkening tolerance (5th) did show in Chrome:** −23 % and −32 % at
  48 kHz, −28 % and −37 % at 96 kHz, against the 4th. It is the lowest of
  the five builds in every cell. Part of the typical case's drop may be
  noise; pass 1 alone gives −26 % and −34 %.
- **48 kHz costs about twice the ms of 96 kHz.** The analysis and the
  segments are counted per second, so a 96 kHz quantum, half as long, does
  half of them. As a share of its own quantum the two rates now match.
- **Chrome reads the typical case 1.9 to 2.3 times Node's**, the worst case
  only 1.2 to 1.4 times. A fixed per-call overhead would add the same to
  both, and the kernels' harness floor was 0.001 ms, so it is not that. A
  light-load real-time thread clocked down or moved to an efficiency core
  more often than a saturated Node loop would inflate small costs more;
  not verified.
- **Four interleaved instances cost the same per instance as one** in Node,
  so the larger footprint does not raise the cost.

## Where the time goes

The 4th build under the Node bench, before the darkening tolerance, ms per
quantum per instance. Three methods, because none alone is reliable here:
**isolation** (each stage's method called alone in a loop on a
steady-state processor's own objects, the analysis input replayed),
**knockouts** (scratch copies of the bundle with one piece removed, the
saving being that piece's marginal cost) for the synthesis's parts, and a
V8 CPU profile as a check. The profile hides the darkening: its dependent
chain of divides and square roots stalls the instructions that wait on it,
so it reads 16 % of the worst case, while removing it saves 45 %. Analysis
runs 32 steps a quantum at 48 kHz and 16 at 96 kHz; synthesis 16 and 8
segments.

| Stage | 48 kHz worst | 48 kHz typical | 96 kHz worst | 96 kHz typical | Source |
|---|---:|---:|---:|---:|---|
| Decimator (host rate) | 0.0007 | 0.0008 | 0.0008 | 0.0008 | isolation |
| Filter bank + selection (all 48 bands) | 0.018 | 0.017 | 0.009 | 0.0085 | isolation |
| Detector FIR + compressor law | 0.0047 | 0.0046 | 0.0023 | 0.0023 | isolation |
| Ceiling (per active band) | 0.0053 | 0.0009 | 0.0027 | 0.0004 | isolation |
| Envelope (`follow`) | 0.0044 | 0.0009 | 0.0022 | 0.0004 | isolation |
| Pitch / phase tracking | 0.0057 | 0.0009 | 0.0028 | 0.0004 | isolation |
| **Synthesis, whole** (`render`) | **0.174** | **0.026** | **0.097** | **0.014** | isolation |
| · darkening coefficients (`darken`) | 0.099 | 0.016 | 0.048 | 0.008 | knockout |
| · phase aim (`aim`) | 0.012 | 0.002 | 0.006 | 0.001 | knockout |
| · other per-band setup, list bookkeeping | 0.036 | 0.004 | 0.023 | 0.002 | remainder |
| · sample loop: table reads | 0.011 | 0.0007 | 0.0046 | 0.0004 | knockout |
| · sample loop: darkening one-pole | 0.006 | 0.0002 | 0.0022 | 0.0003 | knockout |
| · sample loop: phase, ramp, sum | 0.011 | 0.003 | 0.013 | 0.003 | knockout |
| Tone FIR (summed layer) | 0.0016 | 0.0016 | 0.0025 | 0.0025 | isolation |
| Output mix (`output.tick`) | 0.0009 | 0.0009 | 0.0009 | 0.0009 | isolation |
| Per-sample route, process loop, configure | 0.005 | 0.0095 | 0.004 | 0.007 | remainder |
| **Total (bench)** | **0.221** | **0.063** | **0.124** | **0.038** | |

- **The synthesis setup dominated the worst case, not the sample loop.**
  Each band cost about 226 ns a segment to set up, 130 ns of it the
  darkening, a latency-bound chain of about 400 cycles (an `exp2`
  polynomial, five divides, five square roots, then an `atan` series for
  the lag). Its corner moves only 0.1 % a segment at the median, which is
  why the 5th build's tolerance took about 0.07 ms off the 48 kHz worst
  case. The sample loop over 6144 band-samples costs about 4.4 ns a
  band-sample.
- **The typical case is the fixed costs:** the filter bank (0.017 ms),
  which runs every enabled band every step, silent or not (about 40 silent
  bands in `chord4`, 22 % of the typical case at 48 kHz), then the
  darkening and the per-sample route.
- **Engaged levers cost more.** With Sustain, Swell or Freeze on, the
  envelope runs all 48 bands every step. 48 kHz, worst / typical ms/q:
  defaults 0.221 / 0.063; Sustain 2 s 0.271 / 0.117; Octave +12
  0.224 / 0.065; Octave +7 0.276 / 0.074; Spread 1 0.228 / 0.065; Shape
  square 0.237 / 0.068.
- **Not expensive:** the decimator (6 ns a host sample), the tone FIR (13
  taps at 48 kHz, 25 at 96 kHz, 0.002 ms), table selection, the wavetable
  reads (5 % of the worst case) and the one-pole (3 %); neither is
  cache-bound despite the tables' size. Allocation after warm-up is zero,
  and no double is boxed.

## Remaining savings (future work)

Ranked by measured saving, from candidate bundles (string edits on scratch
copies of the generated file) timed with `node-bench.mjs --bundle`, against
the 4th build. "Bit-exact" is the checksum unchanged in all four cells;
"est." is not measured. The darkening tolerance, the 5th build, was the
first of this list.

| # | Change | 48 kHz worst | 48 kHz typical | 96 kHz worst | 96 kHz typical | Output |
|---|---|---:|---:|---:|---:|---|
| 1 | Synthesis segments of 1/3000 s (16 / 32 host samples) | −35 % | −21 % | −30 % | −17 % | +0.17 ms latency, coarser level and pitch interpolation; needs a response check and listening |
| 2 | Filter bank: coefficients and first-section state in one strided `Float64Array` (12 doubles a band) | −2 % | −7 % | −1 % | −7 % | bit-exact |
| 3 | Sustain and Freeze: skip `mode` and `envelope` for a band with no input, level or charge, and locked | noise | −7 % (Sustain 2 s) | noise | −10 % (Sustain 2 s) | bit-exact |
| 4 | Per-sample route by segment: mix, peaks and decimator push as loops over arrays | est. −2 % | est. −5 to −8 % | est. −2 % | est. −5 to −8 % | bit-exact |
| 5 | Cheaper darkening math: Estrin for Horner, a 7-term `exp2`, the short `atan` series for a small lag | est. −30 to −40 % of the darkening left | | | | about 1e-9 relative |
| 6 | Filter bank: skip the selection for bands under a power floor | est. −2 % | est. −8 % | est. −2 % | est. −7 % | onsets change slightly |
| 7 | Sustain and Freeze: `hold` as one loop with its arrays in locals | est. up to −20 % of the Sustain typical case | | | | bit-exact |
| 8 | Darkening as a pre-pass over the sounding bands | was −15 / −8 / −13 / −8 % | | | | bit-exact; overlaps the tolerance, little left |
| 9 | `presence.factors()` only when Focus moves | noise | | | | bit-exact |

Measured together on the 4th build, Node ms/q: the bit-exact set (8 + 2 +
3) gave 0.186 / 0.054 / 0.110 / 0.034, and with the tolerance and 1 added,
0.114 / 0.040 / 0.075 / 0.028. Against the current build's 0.147 / 0.050 /
0.087 / 0.031, the measured changes left (1, 2, 3) are worth about −22 %,
−20 %, −14 % and −10 %; an estimate, since the two were not one run.
Getting to the kernel's 0.06 ms a worst-case instance needs a structural
choice: fewer, longer segments, a darkening on a slow clock, or a cap on
the bands rendered at once.

## Caveats

- **One machine and one browser,** an M1 and Chrome 155, under other
  sessions' load. Absolute figures move by tens of percent between runs;
  compare within a run. Not checked with `powermetrics`.
- **Means, not peaks.** The sampler's peaks are whole milliseconds, all
  1 ms here.
- **Construction is not in the figures.** The wavetables (about 0.5 MB) are
  built when the first instance is constructed, before the 3 s settle.
- **Defaults only in Chrome.** Engaged levers were timed in Node only, on
  the 4th build.
- **The per-stage profile is the 4th build's,** under Node 24's V8, not
  Chrome 155's. The tolerance changed the darkening row; the rest stands.
- **The kernels approximate bloom:** no Swell, Sustain, Freeze, Scale,
  darkening, dry path or slot, and N is forced, not selected.
- **Two Clenshaw loops' locals** were renamed when the kernels were copied
  here; the code is otherwise the one that was timed.
