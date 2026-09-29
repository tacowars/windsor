# Advanced Drive performance review

2026-09-30. Source reviewed: `41f8084cd99d201817b6ddfcb5da6fd091a3e941`.

The user reports 40–55% on Windsor's load meter in Chrome on an M1 MacBook
Air, with similar load across most presets. There is substantial avoidable
work in the DSP, especially smoothing controls which have already settled.
An isolated prototype preserves the existing processing mathematics and
shows a large reduction in Node render time. The initial review below changed
no production code. The subsequent windsor#136 implementation applies only
settled-control smoothing; its source and rebuilt bundle preserve the other
DSP, presets, song formats and goldens. Implementation evidence is recorded
separately below.

No P0 or P1 findings.

## Implemented change — windsor#136

The production change applies **only settled-control smoothing**. It adds a
fixed-capacity active-key array and count to `AdvancedDriveDsp`, fills them
at block configuration, and retains the original arithmetic for active
controls. `Object.is` preserves signed-zero target changes. No new module,
filter cache, FIR change or shaper preparation is introduced.

The implemented source was measured separately against the original commit
on the same named Apple M1 / Node 24 environment below, with no browser or
audio device. [implemented.mjs](implemented.mjs) reads the baseline directly
from Git and builds the current worktree source for the candidate; it does
not substitute a prototype for the implementation. It checks 96,000 exact
double channel samples per preset (576,000 total) before timing, then renders
another second of warm-up and five timed one-second runs in alternating
order. This benchmark ran separately from tests. The original comparison
and warm-up together render two seconds per variant before timing.

| Preset | Original ms | Implemented ms | Reduction |
| --- | ---: | ---: | ---: |
| Soft warmth | 401.7 | 81.6 | 79.7% |
| Biased acid | 490.0 | 164.4 | 66.5% |
| Parallel drum crunch | 457.8 | 130.6 | 71.5% |
| Serial diode treatment | 532.9 | 198.2 | 62.8% |
| Warm bass / torn highs | 547.3 | 234.8 | 57.1% |
| Moving stereo edges | 420.6 | 88.8 | 78.9% |

These are medians of offline milliseconds to render one second of stereo
audio at 48 kHz. The actual implementation showed **57–80% lower render time**
in this run. Use these results for the implemented change, rather than the
initial multi-optimization prototype's 69–86%. Run-to-run timing and runtime
optimization differ; no Chrome load-meter reduction is claimed. Raw values
are in [implemented.json](implemented.json).

Reproduce the implementation benchmark from the repository root:

```sh
node docs/research/2026-09-30-advanced-drive-performance/implemented.mjs
```

`advancedDriveSmoothing.test.ts` adds independent original-recurrence checks
for all continuous controls and thresholds, signed-zero changes, no-op
blocks, in-block settlement and retargeting. Freezing settled controls
checks that the sample update does not write them. Storage identity and
capacity are checked across edits. The same file compares the rebuilt
shipped worklet against its full-control smoothing mode at 44.1/48/96 kHz
through route/modulation/bypass edits, silence, settling and resumed input,
plus all six settled presets. The full-loop reference forces every original
continuous key into the sample loop; it is combined with the independent
recurrence checks so a shared smoothing-formula regression cannot pass just
because both render paths use it.

Decision: `docs/log/2026-09-30-advanced-drive-settled-controls.md`.

Validation: 71 tests passed across the five Advanced Drive test files,
including the 20 new smoothing cases. Typecheck, lint, changed-TypeScript
format checks and the generated-worklet freshness check passed. The project
CI runs the full verify gate; it was not run locally for this ticket.

## Measured experiment

Machine reported by Node: Apple M1, arm64, Darwin 25.5.0. Runtime: Node
v24.21.0, V8 13.6.233.17-node.53. **Browser: none. Backend: source-bundled
JavaScript DSP in Node, no audio device.** These are offline elapsed render
times, not Chrome AudioWorklet CPU measurements or Windsor meter readings.
Hardware model beyond the reported CPU was not collected.

For each of the six factory recipes, render stereo at 48 kHz in 128-frame
blocks. Each variant gets 48,000 warm-up frames and five timed runs of
48,000 frames. Reverse variant order on alternate runs. The input is a
precomputed deterministic stereo mixture of sinusoids. Parameters use the
same Float32 representation as the worklet. The timing includes block
configuration and DSP ticks; it excludes graph construction, input generation,
audio device scheduling, telemetry and the processor's output-buffer writes.
Tests were not run concurrently with this benchmark.

Median milliseconds to render one second of stereo audio:

| Preset | Original | Only skip settled smoothing | Combined prototype | Combined reduction |
| --- | ---: | ---: | ---: | ---: |
| Soft warmth | 380.4 | 64.1 | 52.9 | 86.1% |
| Biased acid | 428.8 | 105.5 | 95.0 | 77.8% |
| Parallel drum crunch | 426.9 | 92.6 | 85.7 | 79.9% |
| Serial diode treatment | 453.0 | 113.5 | 103.0 | 77.3% |
| Warm bass / torn highs | 521.4 | 175.7 | 161.9 | 68.9% |
| Moving stereo edges | 444.5 | 71.8 | 61.7 | 86.1% |

The combined prototype adds unchanged filter/tone coefficient caching and
omits the discarded decimation convolution. Raw repetitions and environment
are in [benchmark.json](benchmark.json). Those two changes individually
have much smaller and noisy effects while the smoothing cost remains;
this run does not establish their separate browser speedups. Improvements
are not additive. Parameter automation will reduce the smoothing saving
while the edited controls approach their targets.

## Recommendations, in priority order

### P2: Skip smoothing controls that have already reached their targets

`packages/engine/src/worklet/advancedDrive/advancedDriveDsp.ts:58`

Every host sample visits all 53 continuous controls and performs the
dictionary reads, writes, arithmetic and snap check. At 48 kHz this is
2,544,000 smoothing iterations per second, even with every knob stationary.
That cost exists in every routing mode and continues while bypassed.

Prototype: at block configuration, fill a preallocated key array with only
controls whose current and target values differ. Run the existing smoothing
expression and snap check, in their original order, on those keys. Keep
the same per-sample smoothing and eight-host-sample modulation cadence.
Keys which settle during the block remain in the list until the next block.
Do not change smoothing to block-rate or freeze LFO/follower state.

Checked against the constructor (current and target values start equal),
the snap-to-target logic, k-rate parameter descriptors and live parameter
retargeting. The performance experiment isolates this change; it is the
largest measured improvement. Production regression coverage should compare
original and optimized output through settled controls, tiny changes around
the snap threshold, edits during a ramp and many simultaneous edits.

### P2: Avoid recomputing unchanged filter and tone coefficients

`packages/engine/src/worklet/advancedDrive/driveRouting.ts:39`
and `packages/engine/src/inserts/advancedDriveFilter.ts:25`

Every eight host samples, configuration runs on all six stage instances,
both eleven-filter crossovers and four tilt/inverse filters. The single
route still configures both crossovers and the unused stages. All 28
biquads rebuild coefficients even when their inputs are identical, and
disabled stage filters are configured too.

Prototype: cache the last scalar coefficient inputs on each filter and
tone instance and return when they are unchanged. The filter's options
object is mutated in place, so caching that object's identity would be
incorrect. Check all five biquad inputs, and tilt's inverse flag too.
This preserves each channel's separate delay state and handles modulated
cutoff by recomputing whenever its effective value changes.

Checked against `DriveFilter.reset` and `DriveTone.reset`: they clear signal
history, not coefficients, so an equal-input cache remains valid after reset.
Production tests should cover unchanged configuration after reset, stereo
state independence, modulated cutoff and changes while a stage is inactive.
Sharing coefficient computation between equal stages is a later refinement,
not part of this prototype.

### P2: Do not convolve decimator outputs which are discarded

`packages/engine/src/worklet/advancedDrive/advancedDriveDsp.ts:96`
and `packages/engine/src/worklet/advancedDrive/driveOversample.ts:31`

Both oversampled phases run the 65-tap output FIR on each channel, but only
phase zero's result is retained. A FIR's future output depends on its input
history, not its prior calculated outputs.

Prototype: on phase one, still write the input sample and advance the FIR
cursor, but omit the dot product. This removes two 65-tap convolutions per
host frame, with the original arithmetic order for every retained output.
The nonlinear graph still processes both phases. Filter coefficients,
oversampling, latency and multiband dry phase compensation are unchanged.

Checked against the FIR's complete state (only buffer and cursor). This is
not permission to drop the phase-one input or skip its nonlinear processing.
Production tests should cover impulses, ring wraparound, high-frequency
input, all routes and topology changes. A subsequent interpolation polyphase
implementation could also avoid products with inserted zeros, but it was
not prototyped here. The cutoff is 0.235, so do not assume alternating
coefficients are exactly zero as in an ideal half-band design.

### P2: Prepare shaper constants when stage controls update

`packages/engine/src/inserts/advancedDriveCurves.ts:40`

For every oversampled sample, `driveShape` computes the gain, square root
and zero-input curve subtraction again. Amount, bias and shaper are held
between `DriveStage.configure` calls, including with modulation. Those
values can be prepared at that existing cadence, leaving the input-dependent
curve evaluation at audio rate. Crush's quantization step count is also
independent of the input sample.

Checked against `DriveStage.configure` and `tick`: controls only change in
configure. Keep the amount-zero identity and continuous nonlinear-residual
DC rejection, and retain the shared editor/DSP transfer-function semantics.
Keep division by the same square-root value rather than replacing it with
a reciprocal multiply if exact identity is required. This opportunity is
source-supported but **not benchmarked or implemented** in the experiment.
Test all eight shapers, biased silence and Amount modulation across zero.

## Sound and behavior verification

The comparison script checks original versus experimental DSP doubles with
`Object.is` on both channels before worklet Float32 output rounding, and
requires finite output. It exercises 44.1/48/96 kHz, every factory recipe,
all route and shaper IDs, filter modes, stage switches, amount/bias/level/
frequency/resonance/peak extremes, envelope and LFO modulation, tempo/sync,
dry/wet and bypass changes, smoothing settlement, silence and resumed input.
The deterministic dynamic sweep is boundary coverage, not an exhaustive
Cartesian product of all settings. [parity.json](parity.json) records the
completed checks: 1,689,600 identical channel samples per variant, or
6,758,400 comparisons across the four experiments. Exact equality on these
cases is not a universal proof.

The unmodified implementation's four focused test files passed: 51 tests,
including alias suppression, crossover reconstruction, latency, transitions,
real synth input, schema handling and insert lifecycle. These existing tests
mostly assert behavior and tolerances; Advanced Drive has no persistent
render-hash golden comparable to FM/reverb. Preserve a baseline comparison
or add dedicated regression evidence during a production optimization;
passing the existing tests alone would not prove identical sound.

```sh
npx vitest run packages/engine/src/inserts/advancedDriveDsp.test.ts packages/engine/src/inserts/advancedDriveMusical.test.ts packages/engine/src/inserts/advancedDriveSpec.test.ts packages/engine/src/inserts/advancedDriveInsert.test.ts --maxWorkers=1
```

## Reproduce and next implementation step

From the repository root on Node 24, run these separately:

```sh
node docs/research/2026-09-30-advanced-drive-performance/experiment.mjs --parity
node docs/research/2026-09-30-advanced-drive-performance/experiment.mjs
```

The script reads tracked source from the reviewed commit through `git show`,
bundles it in memory, applies explicit experimental
source substitutions and writes the result JSON beside itself. It never
reads or edits the generated worklet directory. Substitutions fail if the
expected source text is absent. It is a review harness, not a production
patch: its injected cache fields still need TypeScript declarations and
normal source-level tests when implemented.

Start a production change with settled-control smoothing, then the two
measured companions. Preserve the reference render, rebuild worklets, run
the focused DSP checks and types/lint, and measure the resulting worklet in
Chrome on the M1 with the same song and sample rate. Include warm operation,
active knob edits and peak/deadline behavior, not only average throughput.
Do not infer a new Windsor meter percentage from the Node reduction.

Windsor's `cost/audioLoad.ts` uses a millisecond duty-cycle estimator and
sums live processors. Its documentation records over-reading in the earlier
Chrome calibration. Thus the user's 40–55% is neither Activity Monitor CPU
usage nor a precise per-insert percentage; this does not negate the measured
avoidable work. No fresh Chrome calibration was performed in this review.

Avoid a simple bypass/silence early return in this first change. Current
bypass keeps LFO phase, follower and DSP histories running; Mix zero retains
the active FIR latency and multiband dry phase. Suspending those paths needs
separate state and re-entry design to preserve existing behavior.
