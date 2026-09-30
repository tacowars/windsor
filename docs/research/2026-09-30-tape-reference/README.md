# Tape magnetic reference and error separation

This is milestone A of Windsor #146, task #147. It adds numerical research
only. The shipping phase-2 effect and the merged #145 prototype, reports,
patches and goldens are unchanged. No product quality setting, performance
budget or listening verdict is selected.

## Results and remaining prerequisite

The continuous-input reference qualifies on all **72 normal cases**, as do
both frozen-reconstruction references. The unchanged full prototype passes
only **30/72** normal cases under the conservative two-pair gate. Its 64×
output is **not qualified over the complete domain**; later work must not
use it to certify the candidate targets or authorize integration.

| Reference family | Normal passes | Worst first refinement | Worst final refinement |
|---|---:|---:|---:|
| Analytic 16× → 32× → 64× | 72/72 | -91.80 dB | -103.44 dB |
| Frozen alpha, raw, 8 → 16 → 32 subdivisions | 72/72 | -104.64 dB | -117.80 dB |
| Frozen alpha, FIRs, 8 → 16 → 32 subdivisions | 72/72 | -104.82 dB | -118.06 dB |
| Unchanged full prototype 16× → 32× → 64× | 30/72 | -51.88 dB | -57.82 dB |

The full-path blockers below occur at all three rates and both polarities.
These values are the positive-history 48 kHz rows; the full report retains
all repetitions. The mid-tone 0.25 and unit high/two-tone cases fail the
**first** pair only, not the final pair. They still need a second passing
refinement before satisfying this experiment's conservative gate.

| Bins | Amplitude | 16× → 32× | 32× → 64× | Gate |
|---|---:|---:|---:|---:|
| 173 | 0.25 | -69.64 | -75.65 | -70 dB |
| 1361 | 0.01 | -52.60 | -58.62 | -60 dB |
| 1361 | 0.25 | -51.88 | -57.82 | -60 dB |
| 1361 | 1 | -55.72 | -61.40 | -60 dB |
| 997 + 1361 | 0.01 | -53.75 | -59.77 | -60 dB |
| 997 + 1361 | 0.25 | -53.06 | -59.02 | -60 dB |
| 997 + 1361 | 1 | -55.07 | -60.86 | -60 dB |

For 4× at 48 kHz, bin 1361, amplitude 0.25, integration against the frozen
reference is **-53.58 dB RK2 / -73.92 dB RK4** before filtering; with FIRs
it is -53.76/-74.70 dB. The refined alpha trajectory versus analytic input
is **-34.05 dB**. Thus refining RK4 integration alone cannot remove the
principal error in this worst RK4 case. Its full-path residual versus
provisional 64× is -34.64 dB; the worst normal RK2/4× residual is -35.09 dB.
These differ from #145's numbers because the comparator is 64×, not 32×.

The alpha-transform's small-signal AC transfer, after integrating its linearly
interpolated derivative, is `(1+a)/2 * (1+z^-1)/(1+a*z^-1)`, with `a=0.75`.
At bin 1361/4× this predicts -0.018745 radians phase error and -34.54 dB AC
residual. The measured amplitude-0.01 RK4 raw phase is -0.018824 radians:
independent support for the derivative-reconstruction diagnosis. This limiting
formula does not model nonlinear gain, remanence or startup DC.

The identity FIR pair measures 32 host samples of delay (zero at 1×) and
less than 0.000443 dB carrier loss at the measured bins. Its nonlinear
full-versus-raw difference is much larger at unit amplitude (about -23 dB),
including intentional removal of above-band harmonics. It is not evidence
of -23 dB *resampling error*. Input-image and output-filter contributions to
the full-path difference remain combined; a full filtered continuous-input
reference is still needed to close that part of the diagnosis. Low other-bin
energy alone is also insufficient: the worst RK4 case has -75.41 dBc
other-bin energy despite its -34.64 dB unfitted residual.

All normal renders have zero resets/clips and finite output. Worst reference
extended-window change is -102.23 dB; the largest normal full-candidate
residual change on extending settling is **0.00000240 dB**, below the declared
0.1 dB sensitivity budget. The quiet low tone's one-period window can differ
by -58.87 dB, which is why it was extended. The independent equation check's
largest absolute slope disagreement is **3.79e-12**, below 2e-9.

All four reference families also pass their 24 periodic amplitude-4 refinement
probes. This does **not** establish overload safety: 12 high-tone/1× candidate
trials reset (invalid residuals are `null`), and all 24 abrupt block-sequence
trials reset. No reset-generated output qualifies.

Measured on Apple M1 arm64, Darwin 25.5.0, Node 24.21.0 / V8
13.6.233.17-node.53, Float64 source DSP; no browser or audio backend.
`measurement.json` contains 384 reference groups, 768 candidate trials,
192 decomposition rows, 63 independent equation checks, 20 filter checks
and 24 block-boundary sequences. These are numerical measurements, not CPU
or audio-device performance claims.

**Next experiment:** establish a full filtered reference with consistent field
and derivative reconstruction and further step refinement before certifying
full-path candidate residuals. Use the qualified analytic/frozen references
to compare a stage-consistent field/derivative interpolant with the existing
alpha transform, retaining both RK2 and RK4. Then investigate bounded input
conditioning, symmetric overload recovery, DC and long-term stability. Do
not select a solver from its name, change the shipping path, or treat the
remaining full-reference failure as permission to loosen targets.

## Reproduce

From the repository root, using Node 24 and the installed dependencies:

```sh
node docs/research/2026-09-30-tape-reference/measure.mjs
```

Run this sequentially with other numerical benchmarks. It writes only
`measurement.json` in this directory. All input is deterministic; no upstream
checkout, browser, audio device or new dependency is required. The report
keeps every trial, including failed gates and overloads. A reference state
outside its finite/unclipped domain throws instead of resetting to silence.
The code is offline research, with intentional allocations.

The CI-discovered checks are:

```sh
npx vitest run scripts/lib/tapeReference.test.mjs scripts/lib/tapePrototype.test.mjs --no-cache
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-reference/*.ts
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-reference/*.{ts,mjs}' scripts/lib/tapeReference.test.mjs
```

## Defined domain and references

`referenceConstants.ts` declares the gates and refinement levels. All renders
use the #145 default internal Drive/Width/Saturation (0.5 each), zero initial
magnetization, field and alpha-transform history, with no makeup or DC removal.
Positive and negative histories reverse the entire excitation from this same
initial state. Separate tests drive opposite half-sine histories and verify
opposite remanence at identical subsequent zero input.

Normal trials use amplitudes 0.01, 0.25 and 1; amplitude 4 is explicitly an
overload probe. Each uses 44.1/48/96 kHz and coherent bins 17/173/1361 in an
8192-sample record. Two-tone trials use bins 997/1361, splitting the stated
amplitude equally between them (peak bounded by that amplitude). Thus the
unit-amplitude two-tone retains #145's 0.5-per-tone anchor. Both polarities
are run for every rate, level and signal. Rates preserve normalized frequency;
this rate-independent equation consequently should give nearly identical
results across host rates. These are not fixed-Hz comparisons.

There are three distinct numerical questions, recorded as four families:

- **`analytic`:** RK4 at 16×, 32× and 64× evaluates the analytic sinusoid
  and its actual time derivative at every RK stage. Host samples are read at
  their exact timestamps. This is a raw magnetization reference, without FIRs;
  it is not a bandlimited playback output or a calibrated tape model.
- **`frozen-alpha-raw` / `frozen-alpha-filtered`:** hold the 4× sampled field
  and 0.75 alpha-transform derivative endpoints fixed, then subdivide every
  interval 8/16/32 times. Field and derivative are independently interpolated
  linearly, exactly as the original RK midpoint stages assume. The supplied
  derivative is **not** the derivative of that piecewise-linear field. These
  references isolate integration of that particular forcing; the filtered
  family uses the unchanged #145 FIRs on both sides of the core.
- **`prototype-full`:** rerun the unchanged FIR/alpha-transform/RK4 path at
  16×/32×/64×. This changes reconstruction as well as integration and discrete
  filter response. Its refinement residual is not called pure solver error.
  Its finest output remains explicitly provisional wherever its gate fails.

`references` records both successive refinement residuals and all three
states. A pass requires both residuals at or below -70 dB for low/mid, or
-60 dB for high/two-tone, zero resets/clips, nonzero finite output and an
extended-settling residual below -80 dB. These are the original reference
margins; candidate targets remain -60/-50 dB. Refinement differences are
empirical evidence, not a rigorous global error bound. Switching branches in
the irreversible term means nominal RK4 order cannot be assumed everywhere.

## Separating the measurements

All principal residuals are unfitted RMS error divided by reference RMS.
They retain DC, gain and nonlinear phase. Most trials compare windows after one and two whole periods. The quiet
low tone (amplitude 0.01, bin 17) instead uses eight and sixteen: a pilot
found four versus eight still differed by -77.95 dB, failing the -80 dB
settling gate. Its original one-period window is retained in
`originalSettlingDb`; each state records its actual window plan. The signal
domain and residual targets were not narrowed to avoid that failure. Delay alignment slices actual preceding
samples, never wraps an unsettled record. Only the measured 32-host-sample
FIR-pair delay is aligned: the 1× path has no FIR delay. `filters` records
identity-core impulse delay/DC gain and the linear carrier response at every
measured tone. The nonlinear core's phase is never treated as fixed latency.

`candidates` reruns both original solvers at 1×/2×/4×/8×. Raw residuals compare
against the analytic reference; full-path residuals compare against provisional
64×, so consult the matching `prototype-full` gate before interpreting them.
Carrier gain and phase are diagnostic projections only; they never modify the
principal residual. Single-tone other-bin energy excludes DC and in-band
integer harmonics. It still includes settling leakage and folded nonlinear
components, and can miss aliases coincident with harmonic bins. Two-tone
other-than-carrier energy includes intended harmonics/intermodulation as well
as aliases/leakage; neither this metric nor its waveform residual is labeled
alias energy.

`decomposition` fixes the factor at 4×. `rawIntegrationDb` and
`filteredIntegrationDb` compare each candidate with the corresponding frozen
reference. `reconstructionDb` compares the refined raw alpha trajectory with
the analytic trajectory. `filterPathDifferenceDb` compares the full path with
the raw path after measured delay alignment; it includes input images,
nonlinear response to those images and output filtering, not just linear
passband loss. These differences have different denominators and may cancel;
their dB values must not be added to form an error budget.

## Independent checks and limitations

`momentSlope` independently evaluates the Langevin function as the mean of
`u` under density proportional to `exp(q*u)` on [-1,1], and its derivative as
the variance. Composite Simpson quadrature uses 4096 panels, avoiding both
coth subtraction and the prototype's Taylor branch. A separately arranged
irreversible/reversible equation is checked at signed fields, signed states,
tiny/zero field and both derivative signs. The origin additionally has the
closed-form susceptibility `b/(1-alpha*b)`, where `b=c*Ms/(3*a)`.

Negative-control tests reject a reversed equation sign, a missing irreversible
term, singular near-zero evaluation, deliberately coarse integration, a
one-sample delay error, gain fitting, reset-generated silence and incomplete
refinement. Spectral fixtures distinguish an intended cubic harmonic, a folded
third harmonic and exponential settling leakage. The extended-window test
catches the quiet low-tone transient that the original prefix leaves behind.
Boundary evidence records first/last samples, state, finiteness, resets and
clips for tiny/zero/DC, signed steps and abrupt overloads at every rate and
both solvers. Finite recovery is explicitly distinct from valid-reference
operation.

The integration paths still share the #145 slope routine and parameter table;
the independent check reduces, but cannot eliminate, correlated errors. No
physical recording or independent full CHOW render is available. Tests cover
the declared controls only, not control corners, automation, 60-second drift,
filter transition-band qualification, or a new stable overload policy.

The imported core is Jatin Chowdhury's GPL-3.0-only CHOW adaptation at revision
`604372e4ffd9690c3e283362e4598cb43edbb475`; see the preserved
[attribution/audit](../2026-09-30-tape-phase-3/AUDIT.md) and
[licence](../2026-09-30-tape-phase-3/COPYING). The new stage driver and integral
check introduce no additional upstream or dependency code. This is unrelated
to the shipping effect's CC0 REELS provenance.
