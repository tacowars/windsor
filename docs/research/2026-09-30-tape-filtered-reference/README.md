# Tape continuous reconstructed and filtered reference

Windsor #150 continues milestone A of #146. It preserves the shipping
effect, [#145](../2026-09-30-tape-phase-3/README.md) and
[#148](../2026-09-30-tape-reference/README.md) byte for byte.
The experiment follows the
[greenfield direction](../../log/2026-09-30-tape-greenfield-direction.md);
it chooses no product core, quality mode or default.

## Results

The **full filtered reference passes 72/72 normal cases**, as do the raw
and fixed-observation families. The previous full-alpha family's 30/72
result remains preserved; it has not been relabeled as qualified.

| Family | Normal passes | Worst 16×→32× | Worst 32×→64× |
|---|---:|---:|---:|
| Raw integration | 72/72 | -91.81 dB | -103.43 dB |
| Fixed 8× playback observation | 72/72 | -92.74 dB | -104.03 dB |
| Full integration and playback | 72/72 | -92.85 dB | -104.03 dB |

Worst normal reference settling change is -102.23 dB. Worst candidate
extended-window residual sensitivity is 0.000777 dB, below 0.1 dB. Every
normal render is finite with zero failures/resets/clips. These results
qualify this defined continuous reconstructed/filter system on the stated
domain; they do not establish physical fidelity or all-control stability.

The new consistent candidates meet these waveform targets as follows.
Each cell gives passes out of 72 and the worst full residual; the threshold
is case-dependent (-60 dB low/mid, -50 dB high/two-tone).

| Solver | 1× | 2× | 4× | 8× |
|---|---:|---:|---:|---:|
| RK2 | 30; -8.72 dB | 36; -28.83 dB | 60; -41.21 dB | 72; -53.76 dB |
| RK4 | 48; -23.58 dB | 72; -51.19 dB | 72; -69.64 dB | 72; -83.04 dB |

For the previous worst RK4/4× anchor (48 kHz, bin 1361, amplitude 0.25),
the refined new raw reconstruction versus analytic forcing is -90.04 dB.
The old refined alpha forcing versus the new filtered reference is
-34.06 dB; old RK4 integration against its frozen-alpha reference remains
-74.70 dB. This supports the reconstruction diagnosis independently of a
solver-name change. The full-versus-raw playback difference at this anchor
is -39.67 dB and includes intended harmonic removal, not just filter error.

Across the normal domain, the isolated 8× versus 64× playback quadrature
difference on the same fine state history is at most -107.39 dB. The
identity-core delay is 32 host samples at every tested factor, including
the new filtered 1× path. Its measured DC gain ranges from 0.99999669 at
1× to 1.00000000000111 at 64×; no gain correction is fitted to these results.

All 24 periodic amplitude-4 reference probes pass in all three families.
Nevertheless, both consistent solvers fail at 1× for the amplitude-4 high
tone at every rate/polarity (12 invalid trials); the alpha baseline also
resets in those 12 trials. All invalid residuals are null. Of 54 unique signed
step-pulse trials, 24 abort when reconstructed ±8/±100 exceeds the declared
unclipped input domain; the 30 zero/tiny/unit probes remain finite. These
are recorded failures, not overload recovery or production safety.

Measured on Apple M1 arm64, Darwin 25.5.0, Node 24.21.0 /
V8 13.6.233.17-node.53, Float64 source DSP, no browser/audio device.
The report has 288 new reference groups, 1536 candidate trials,
96 decomposition rows, seven filter checks, 54 boundary trials and
96 explicitly historical full-alpha reference gates. These are numerical
results, not timing or CPU measurements.

**Next experiment:** declare a bounded control/input domain and condition
the core, exercising both overload polarities, DC, rapid edits and
60-second runs at all three rates. Keep RK4/2×, RK4/4× and RK2/8× as
comparison candidates rather than selecting a product solver here.
Qualify filter response and browser cost before deciding one path versus
useful inexpensive/magnetic options. This experiment's direct sinc sums
and offline allocations are not a proposed audio-thread implementation.

## Complete failed-case inventory

There are no new normal reference failures. The following normal candidate
failures occur at all three rates and both polarities. "All" means amplitudes
0.01/0.25/1; "high/two-tone" means bin 1361 and bins 997+1361. All other
normal candidates pass their waveform gate. Per-trial values, overload
failures above and the original 42/72 failed full-alpha normal gates remain
in `measurement.json` (`passes: false` or a non-null `failure`).

| Family/solver/factor | Failing normal inputs |
|---|---|
| Consistent RK2/1× | Mid bin 173 at 1; high/two-tone at all levels |
| Consistent RK2/2× | High/two-tone at all levels |
| Consistent RK2/4× | High/two-tone at 1 |
| Consistent RK4/1× | High/two-tone at 0.25/1 |
| Alpha RK2 and RK4/1× | Low bin 17 at 0.25; mid/high/two-tone at all levels |
| Alpha RK2 and RK4/2× | Mid/high/two-tone at all levels |
| Alpha RK2/4× | Mid/two-tone at all levels; high at 0.01/0.25 |
| Alpha RK4/4× | Mid/high/two-tone at all levels |
| Alpha RK2 and RK4/8× | Mid at 0.01/0.25; high/two-tone at all levels |

## Defined system

Time `t` is in host samples. Let `L=32`, `c=0.45`, and

```text
k(u) = 2c sinc(2c u) [0.42 + 0.5 cos(2πu/L) + 0.08 cos(4πu/L)]
       for |u| < L/2; zero otherwise; sinc(v) = sin(πv)/(πv)
Z = integral k(u) du
H(t) = sum over integer n>=0 of x[n] k(t-n-L/2) / Z
D(t) = sampleRate * dH(t)/dt
M(0) = 0; integrate the unchanged #145 magnetic equation using H,D
y(t) = integral from 0 to L of k(u-L/2) M(t-u) / Z du
```

Negative input and magnetization history are zero. The kernel and its
first derivative vanish at the support endpoints, so either endpoint
inclusion convention gives the same value. A stable near-zero sinc series
avoids division by zero. `Z` is a fixed 4096-panel Simpson integral, checked
against 2048 panels, never a fitted per-render or per-grid gain.

This is a continuous reconstruction of actual host samples, including
finite-kernel images and startup; it is not a clean analytic sine followed
by a lowpass. The two filters converge to #145's normalized Blackman-sinc
design as its grid is refined. Its old discrete per-factor normalization
differs slightly from this fixed continuous normalization. We compare
against the original FIR implementation independently in tests.

`Field` caches direct kernel sums on each requested RK stage grid. Periodic
forcing is reused only after the causal startup support; this caches exact
stage evaluations, not an independently interpolated derivative. Physical
derivative units multiply by host rate; the RK timestep divides by host
rate and factor. Rates therefore retain the original normalized-frequency
semantics, not fixed-Hz comparisons.

State samples are read at `t=i/factor` before advancing to the next time.
Playback uses composite trapezoid quadrature on that grid; endpoint weights
are zero. The linear identity-core pair has 32 host samples of fixed delay.
Nonlinear phase is never fitted away. Old alpha 1× bypasses both FIRs and
is aligned using actual preceding samples; new consistent 1× retains
sampled versions of both filters. It is not an equivalent product mode.

## Qualification and comparisons

`measurement.json` records three reference families at 16×/32×/64×:

- `raw`: refine integration of the exact continuous reconstructed field,
  observing host-rate raw magnetization.
- `frozen`: refine that same integration while holding playback observation
  and quadrature fixed at 8×. Its finest value still has 8× quadrature error;
  it qualifies only fixed-observation integration comparisons.
- `output`: refine integration and playback quadrature together. The input
  reconstruction has no separate grid approximation, since its finite
  kernel sum and derivative are evaluated directly at every stage. This
  is the full filtered family; the frozen result alone cannot qualify it.

The domain is #148's 72 normal cases: 44.1/48/96 kHz; bins 17/173/1361 and
997+1361 in 8192 frames; peak amplitudes 0.01/0.25/1; both polarities from
zero history; default internal Drive/Width/Saturation 0.5. Two-tone peak
amplitude is split equally between its tones. Twenty-four amplitude-4
cases are separate probes. No control corners or automation are covered.

Boundary probes use nine unique signed host-sample levels: 0, ±1e-12,
±1, ±8 and ±100, each once per rate and solver (3 × 2 × 9 = 54).
Every pulse starts from zero history, has its plateau at samples 128–255,
and returns to zero at 256. `level` carries the polarity exactly once;
there is no independent sign multiplier. This replaces the initial report's
120 rows, which duplicated opposite sign/level combinations and zero.

Report settings are namespaced as `settings.experiment`, `settings.reference`
and `settings.filtered`. Stimulus amplitudes are `experiment.levels`
(0.01/0.25/1/4), integration refinements are `filtered.levels` (16/32/64),
and this pulse matrix is `filtered.boundaryLevels`. The preserved
`experiment.stressLevels` describes #145's sequential stress input, not
this experiment's independent pulse matrix.

Each claim requires both successive unfitted RMS refinement residuals
below -70 dB low/mid or -60 dB high/two-tone, finite nonzero output and no
reset/clip/failure. Settling compares periods one/two, except quiet low
tones use eight/sixteen, and must stay below -80 dB. Candidate residual
sensitivity to those extended windows must stay within 0.1 dB. Invalid
trials abort with a reason and null residuals; no recovery silence scores.

Both solvers at 1×/2×/4×/8× are compared for the new forcing and unchanged
alpha baseline. Candidate target flags require a qualified full reference,
valid output, residual ≤-60 dB low/mid or ≤-50 dB high/two-tone, and the
settling sensitivity budget. A flag is a waveform target result, not a
complete product or alias-qualification result.
Each consistent candidate additionally reports raw integration error
against the qualified raw reference, sharing the same continuous forcing
and keeping playback quadrature out of that comparison.

The decomposition reports raw reconstructed versus analytic forcing after
16-sample alignment, full versus raw after the playback filter's 16-sample
alignment, 8× versus 64× output quadrature from the same 64× state history,
and frozen-alpha versus the new full reference. The old RK2/RK4 4×
fixed-alpha integration errors remain independent anchors. These metrics
retain intended filter effects and differ in denominator; do not add their
dB values. Single-tone other-bin power includes settling/folded components
but misses aliases on harmonic bins. Two-tone other-than-carrier power
includes intended harmonics/IMD. Neither is a universal alias measurement.

## Reproduce and verify

From the repository root on Node 24 with installed dependencies:

```sh
node docs/research/2026-09-30-tape-filtered-reference/measure.mjs
npx vitest run scripts/lib/tapeFilteredReference.test.mjs scripts/lib/tapeReference.test.mjs scripts/lib/tapePrototype.test.mjs --no-cache
npm run typecheck
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-filtered-reference/*.ts
npm run lint -- --ignore-pattern '.claude/worktrees/**'
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-filtered-reference/*.{ts,mjs}' scripts/lib/tapeFilteredReference.test.mjs scripts/lib/tapeReference.test.mjs
git diff --check
git diff origin/main --exit-code -- packages/engine packages/app docs/research/2026-09-30-tape-phase-3 docs/research/2026-09-30-tape-reference scripts/lib/tapePrototype.test.mjs
```

The one sequential reproduction writes only this directory's report. It
reads #148's report to retain its failed full-alpha gates as explicitly
historical evidence, not new measurements. All new comparisons are rendered
again. Run numerical jobs sequentially. This is offline, intentionally
allocating research; no browser, audio device or local upstream checkout
is used. CI discovers the three focused test files without configuration
changes. CI owns the full `verify` gate.

The fix round changes only the older `tapeReference.test.mjs` frozen-history
test's timeout from the 5-second default to 6 seconds: full CI timed out
while the focused slice passed. Its numerical assertions are unchanged;
this narrow ownership exception does not modify #145/#148 sources or
reports. The three new report checks pin both settings domains, unique
signed pulse coverage and label agreement with the rendered plateau.
Report regression keeps metadata and polarity exact, but compares computed
field/state/output values to 12 decimal places: Linux CI differed from the
Mac report by about 6.5e-15 in the final state. This portability allowance
does not change any reference qualification or candidate residual gate.

## Independence and limits

Tests check H/D through an impulse superposition and finite differences at
interior stages and endpoints, then check time scaling with a cubic field
whose exact integral is known. The independently coded original FIR checks
kernel values; Simpson convolution checks playback quadrature and delay.
Negative controls catch coarse integration, a reversed or old mismatched
derivative, missing rate scale, wrong sample alignment, gain fitting,
DC removal, silent/reset output, insufficient settling and a single passing
refinement pair. Earlier equation/alias/settling tests remain in the focused
slice. Signed step pulses, tiny/zero input and DC plateaus retain field,
state, first/last block samples and failure evidence at all three rates.
These pulses pass through reconstruction; they are not the old raw abrupt
core-input sequence or an overload recovery policy.

All numerical paths still share #145's equation and default controls.
#148's independent integral-moment check reduces that correlated risk;
self-refinement is empirical evidence, not a rigorous error bound or an
independent physical recording. Full transition/stopband qualification,
control corners, rapid edits, 60-second stability, DC removal, conditioning,
allocation-free product implementation and browser CPU measurement remain
later tasks. No listening verdict or calibrated machine accuracy is claimed.

The core retains Jatin Chowdhury's GPL-3.0-only adaptation at
`604372e4ffd9690c3e283362e4598cb43edbb475`; see the preserved
[audit](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING). The reconstruction, driver and
tests are original; no additional upstream/dependency source is imported.
This is distinct from the shipping effect's CC0 REELS provenance.
