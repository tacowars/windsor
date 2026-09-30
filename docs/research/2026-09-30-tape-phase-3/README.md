# Tape phase 3: magnetic core experiment

The first increment is a research harness, not a shipping mode. It establishes
a reproducible phase-2 baseline, a scalar magnetic prototype and measurements.
The shipped Tape source, defaults, documents, presets and generated bundles
are unchanged. The user's local phase-3 handoff is left untouched.

Read [the source audit and attribution](AUDIT.md) and
[the decision and next acceptance targets](../../log/2026-09-30-tape-magnetic-prototype.md).
The result supports investigating RK2/4× further; it does not yet support
selecting a production solver, quality setting or calibrated machine model.

## Reproduce

From the repo root on Node 24, with the existing dependencies installed:

```sh
npx vitest run scripts/lib/tapePrototype.test.mjs --no-cache
node docs/research/2026-09-30-tape-phase-3/measure.mjs
node docs/research/2026-09-30-tape-phase-3/characterize.mjs
node docs/research/2026-09-30-tape-phase-3/browser.mjs
```

Run benchmarks sequentially without other heavy jobs. `browser.mjs` uses
installed macOS Chrome (override `TAPE_CHROME` on other systems), serves an
ephemeral localhost page, launches an isolated muted profile, closes each
AudioContext and removes its own profile. It never opens the Windsor app or
the user's browser data. It times out after 90 seconds if reports do not arrive.

The two baseline consumers bundle TypeScript from Git commit
`c83564f47ac3e0e78f60a2c3f00d616f12bf3938`, not phase 1 and not generated
worklets. `measurement.json` records current app/engine source differences
against that commit (empty here). Research tests sit in `scripts/lib/` so
the normal CI test discovery includes them; no package/config change is needed.

## Method and numerical results

`experimentConstants.ts` holds the core mappings and principal experiment
settings. Controls are internal CHOW-style Drive, Width and Saturation,
all 0–1; these are not a proposed Windsor UI. Saturation and width stay at
0.5 for spectra. No makeup or loudness normalization disguises the differences.

`measurement.json` contains 288 single-tone trials: 44.1/48/96 kHz,
bins 17/173/1361 of an 8192-sample record, amplitudes 0.01/0.25/1/4,
RK2/RK4, and 1×/2×/4×/8×. An equal-length prefix is discarded. At 48 kHz
the frequencies are 99.61, 1013.67 and 7974.61 Hz; other rates retain the
same normalized frequencies. Every candidate uses the same host samples.

FFT power distinguishes the carrier and its *in-band* integer harmonics
from other bins. `nonHarmonicDbc` is a useful alias indicator here, but
also includes residual settling/leakage. Aliases that land on retained
harmonic bins are not counted separately. A cubic-wave test with a known
folded third harmonic checks the method. Two-tone residuals include
intermodulation, gain, phase and integration error, not just aliasing.

Time-domain residuals use a 32× RK4 reference with the same FIR design;
the undelayed 1× record is shifted by 32 samples using its coherent period.
There is no gain fitting or nonlinear phase fitting. A 64× refinement
differs from 32× by as much as -57.82 dB, so even the reference needs more
work before certifying the proposed high-frequency target with 10 dB margin.
This is numerical self-convergence, not independent physical validation.

At 48 kHz, amplitude 1, 7974.61 Hz:

| Core | Other-bin power relative to carrier | Residual vs 32× RK4 |
|---|---:|---:|
| RK2, 1× | -17.99 dBc | -9.56 dB |
| RK2, 2× | -48.97 dBc | -28.79 dB |
| RK2, 4× | -63.65 dBc | -52.76 dB |
| RK2, 8× | -77.61 dBc | -53.99 dB |
| RK4, 1× | -30.57 dBc | -18.98 dB |
| RK4, 2× | -58.20 dBc | -36.94 dB |
| RK4, 4× | -72.46 dBc | -40.34 dB |
| RK4, 8× | -84.86 dBc | -46.64 dB |

RK4 improves this spectral indicator but is not uniformly closer in waveform
error. Across amplitudes ≤1, the worst 4× residual is -35.69 dB for RK2
and -35.27 dB for RK4. The input derivative/conditioning and filter response
need analysis before interpreting solver names as quality levels.

All 192 unit-amplitude, 1 kHz-normalized corner trials (eight combinations
of Drive/Width/Saturation, two solvers, four factors, three rates) have zero
resets. Conversely, **all 192 raw-core abrupt overload sequences reset**;
those deliberately bypass FIR conditioning and include ±8 and ±100 steps.
Six single-tone trials also reset: both solvers at 1×, amplitude 4, high
frequency, at each rate. Recovery keeps output finite but is not a pass for
production stability. Counters remain in the raw data, not hidden by clipping.

`characterization.json` adds two-tone comparisons and 13-second runs with
10 seconds of 1 kHz input, one second DC and two seconds silence, at each
rate/factor using RK4. These twelve runs have zero resets/clips. A separately
measured 10 Hz one-pole DC blocker decays below 4e-28 peak in the final
second even though raw magnetization remains. This is not a 60-second drift
proof or a final wrapper/filter choice.

## Baseline and latency

The pinned legacy Studio default is characterized at the same three bins
and four amplitudes. Its small impulse starts and peaks at sample zero with
Wear off. A seeded Wear 0/50 comparison records the ±100 Hz skirt around a
coherent quiet carrier (65536 samples, equally long settling prefix). At
48 kHz it changes from -172.05 dBc to +13.10 dBc. This captures the existing
random transport's spread relative to its weakened carrier; it is not a
periodic wow frequency or a universal wear measurement.

Identity-core tests measure unity DC and a 32-host-sample peak delay for
the prototype FIR pair at 2×/4×/8×/32×: 0.726/0.667/0.333 ms at
44.1/48/96 kHz. The nonlinear core adds frequency/level-dependent phase;
these numbers must not be presented as total nonlinear latency. Fixed dry
alignment, bypass/mode transitions and parallel paths remain separate
integration work, as the decision record explains.

## Cost on the measured machine

Apple M1 arm64, Darwin 25.5.0, Node 24.21.0 / V8 13.6.233.17-node.53.
Node backend: source-bundled Float64 DSP, precomputed deterministic input,
48 kHz, stereo, one-second warmup, five one-second rounds alternating
candidate order. No browser/audio device during this measurement.

| Solver | 1× | 2× | 4× | 8× |
|---|---:|---:|---:|---:|
| RK2 median ms / second of stereo audio | 13.85 | 58.97 | 114.33 | 222.31 |
| RK4 median ms / second of stereo audio | 29.96 | 89.12 | 174.81 | 344.32 |

The separate pinned legacy timing and all individual rounds are retained
in `characterization.json`. Legacy includes EQ, transport/noise bookkeeping
and mixing; the prototype is only the core and FIRs. These are different
effects, not a sound-equivalent optimization benchmark. Timings are not
worst-case quantum budgets.

Chrome 154.0.8037.58 on the same M1, headless AudioContext at 48 kHz, muted
destination, output device unverified. Each trial uses a fresh context,
188 warmup quanta and 750 measured quanta (two seconds). One or four stereo
nodes run in parallel. The synthetic bass/chord/bright-partial input is
generated in the timed block. Moving trials alternate drive every 16 blocks;
prototype edits are deliberately unsmoothed. They exercise control updates,
not final automation sound quality or live mode/quality switching.

| Path | One, steady | One, edits | Four, steady | Four, edits |
|---|---:|---:|---:|---:|
| Phase-2 legacy | 5.7% | 7.0% | 17.4% | 19.1% |
| RK2/4× | 12.5% | 15.4% | 42.9% | 39.8% |
| RK4/4× | 21.7% | 21.9% | 50.6% | 50.4% |

These are **coarse duty-cycle estimates**, not accurate CPU percentages.
Neither `performance.now` in the worklet nor `renderCapacity` was available.
The adapter uses the existing 1 ms `Date.now` boundary-count method, whose
limitations are documented in `cost/audioLoad.ts`. Reversals between steady
and edited trials are not evidence that editing is faster. All trials
reported zero resets/nonfinite outputs and zero *provable per-node deadline
misses*. That last count is a lower bound; it does not count missed device
output or prove that the sum of four nodes fits a quantum. Full raw reports,
latencies and environment are in `browser-measurement.json`.

## Verification and next increment

Focused research tests cover opposite histories at zero input, tiny values,
symmetric fault recovery, deterministic edits/reset, independent channels,
first/last block samples, filter gain/delay, numerical refinement and a known
aliased signal. Repository typecheck and lint plus an explicit strict
typecheck of the research TypeScript are run for this increment. The normal
CI gate can discover these tests; no existing golden is regenerated.

Next: improve conditioning and derivative convergence, qualify filter
response/transition-band behavior, reduce resampling cost, and establish a
finer browser cost measurement. Then decide a bounded control domain and
one quality setting before a separate opt-in integration PR. Playback losses,
transport changes, product controls, full song round trips and user audition
belong to subsequent increments. No listening approval is claimed here.
