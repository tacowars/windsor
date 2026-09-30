# Tape corner accuracy: RK4 2× and 4× with the span-32 and span-48 pairs

Windsor [#215](https://github.com/tacowars/windsor/issues/215) is the last
accuracy question of milestone B in
[epic #146](https://github.com/tacowars/windsor/issues/146). The pending
milestone D record (`2026-09-30-tape-magnetic-integration-design`) fixes the
product core as RK4 on the `knee`-conditioned system, 2× by default with 4×
as an audition switch, behind the span-48 FIR pair of
[#207](https://github.com/tacowars/windsor/issues/207). This task measures
those two settings, and the same factors with the span-32 pair, on tones at
every corner of the control cube and its centre at 48 kHz. It is research
only. It changes no shipping code, chooses no default and does not reopen
the design record. The [decision](../../log/2026-09-30-tape-corner-accuracy.md)
summarises the outcome.

**Licence and provenance.** The equation is the GPL-3.0-only CHOW-derived
research core (Jatin Chowdhury, upstream
`604372e4ffd9690c3e283362e4598cb43edbb475`); see
[AUDIT](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING). It is imported unchanged, with
the knee conditioning (`configured`, `stage`), the continuous reconstruction
and playback kernel, the RK stage integrator (`step`, driven through #204's
`integrate`), the FIR pair (`coefficients`, `ResampledHysteresis`,
`SymmetricResampledHysteresis`) and #167's refinement, residual, spectrum and
gate functions. Tables are passed by parameter.

## Declared experiment (before reproduction)

Everything here is declared in [`cornerConstants.ts`](cornerConstants.ts).

- **Matrix.** 48,000 Hz only. Controls (Drive/Width/Saturation): the centre
  0.5/0.5/0.5 and the eight corners, nine points. Signals: bins 17, 173 and
  1361 singly and the 997+1361 two-tone, four signals of 8192-frame periods.
  Levels 0.25 and 1 (normal, gated) and 4 (the domain edge, reported without
  a gate). Positive polarity only. **108 reference cases.**
- **Reference.** #167's qualified method on the `knee` system: the
  continuous span-32 reconstruction of the tone and its exact derivative at
  every RK stage, RK4 at 16×, 32× and 64×, and playback by the same
  continuous kernel. A case qualifies only when both successive pairs
  (16→32, 32→64) pass for raw magnetization and for full output: -70 dB low
  and mid, -60 dB high and two-tone, plus the -80 dB settling gate on every
  state. An unqualified reference is reported, and its candidates are marked
  `no reference`; it never passes. Three periods, principal window period 1,
  extended period 2. The eight/sixteen-period quiet-low rule applies only to
  level 0.01, which this matrix does not contain.
- **Candidates.** RK4 at 2× and 4×, each with the span-32 pair and the
  existing decimator loop, and with the span-48 pair and the symmetric
  decimator. Four settings, **432 candidate renders**. Setting ids are
  `rk4/2x/32`, `rk4/2x/48s`, `rk4/4x/32` and `rk4/4x/48s`.
- **Candidate form.** As in #167, the RK4 stages read the pair's continuous
  interpolating function and its exact derivative, and never a derivative
  estimated from samples. Every accepted state then goes through the
  unchanged discrete decimator of `ResampledHysteresis` (span 32) or
  `SymmetricResampledHysteresis` (span 48), which stand in place of its core.
  So `output[n] = Σ taps[j] · M[n·factor − j]`, delayed by `span` host
  samples. The host tone also runs through the class's own interpolator. The
  largest difference between its output and the field at every step point is
  recorded as `interpolationDifference`.
- **Why [`render.ts`](render.ts) exists.** The imported reconstruction and
  `renderConditioned` fix the kernel at `EXPERIMENT.firSpan` (32) and the
  playback at the integral-normalised kernel. Neither takes the span-48 pair
  by parameter. `render.ts` repeats `kernel`, `normalization` and `Field` with
  the span as a parameter, operation for operation. A test shows them
  bit-identical to the imported ones at span 32. The span-32 candidates use
  the imported `Field` itself.
- **Gate.** The unfitted full-output residual against the 64× reference
  must be at most **-60 dB** on the low and mid tones and **-50 dB** on the
  high tone and the two-tone case. Those figures are the reference margins
  plus #153's 10 dB `candidateMarginDb`. The render must be finite, with no
  reset, clip or abort and a nonzero peak. As #167 applied it, the extended
  window must agree with the principal one within 0.1 dB.
- **Alignment.** Only the pair's fixed delay is aligned. The candidate
  delays by `span` host samples and the reference by 32, so the reference
  window is shifted by `span − 32` (0 or 16 samples). Gain, DC and nonlinear
  phase stay in the residual. There is no makeup gain, fitted alignment or
  relaxed threshold.
- **Reported beside the gate, never gated:**
  - the gain and phase projection on each carrier bin (`transfer`);
  - other-bin energy from the imported `spectrum`, compared with the
    -60 dBc figure: non-harmonic for single tones, other than carriers for
    the two-tone;
  - the same figure for the reference;
  - the level-4 rows.
- **Bound.** One sequential child runs under a parent-enforced **900-second**
  SIGKILL. The schedule is case-major (level, then controls, then signal).
  Each case journals its reference (16/32/64×) on completion, then each of
  its four candidates. An expired run keeps complete and partial groups and
  any truncated tail, and lists every missing reference and candidate. The
  report is assembled afterwards with no new numerical work, and there is no
  retry.

## Reproduce

From the repository root on Node 24:

```sh
node docs/research/2026-09-30-tape-corner-accuracy/measure.mjs
npx vitest run scripts/lib/tapeCornerAccuracy.test.mjs scripts/lib/tapeConditioning.test.mjs --no-cache
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-corner-accuracy/*.ts
```

## Results

The run is recorded in [`measurement.json`](measurement.json) with source
hashes. It completed **108/108 reference cases and 432/432 candidate
renders in 188.7 s** of the 900-second bound, with exit 0, no expiry and no
truncated tail. It ran on an Apple M1 (8 cores, arm64), Darwin 25.5.0, Node
v24.21.0 / V8 13.6.233.17-node.53, with the Float64 source DSP in Node and no
browser. The elapsed time bounds the reproduction; it is not a CPU
measurement.

The run was made twice. The first run labelled the eight edge-level
candidates of the two unqualified references `ungated` rather than
`no reference`. The status order was fixed, so an unqualified reference now
outranks the ungated label, and the run was repeated. All 108 references
and all 432 residuals and projections are bit-identical between the runs.

### References

**106 of 108 qualify.** All 72 gated cases qualify. The worst successive
residual among them is -68.99 dB (two-tone, 1/1/1, level 0.25, against
-60). The two unqualified cases are at the domain edge, controls 1/0/1,
level 4:

| Case | Raw 16→32, 32→64 | Full 16→32, 32→64 | Margin |
|---|---:|---:|---:|
| 1/0/1, bin 1361, level 4 | -32.66, -58.50 | -32.23, -63.69 | -60 |
| 1/0/1, 997+1361, level 4 | -42.49, -66.75 | -42.51, -70.59 | -60 |

Both are finite and settle, and both converge, but the 16→32 pair misses.
Their eight candidates are `no reference`.

### Candidates, per setting (72 gated rows each)

| Setting | Passes | Worst row (margin past gate) |
|---|---:|---|
| `rk4/2x/32` | 46/72 | 1/0/1, bin 1361, level 1: -14.80 dB vs -50 (+35.20) |
| `rk4/2x/48s` | **44/72** | 1/0/1, bin 1361, level 1: -14.78 dB vs -50 (+35.22) |
| `rk4/4x/32` | 66/72 | 1/0/1, bin 1361, level 1: -31.18 dB vs -50 (+18.82) |
| `rk4/4x/48s` | **50/72** | 1/0/1, bin 1361, level 1: -30.62 dB vs -50 (+19.38) |

Every low (bin 17) and mid (bin 173) row passes in all four settings. Every
failure is on the high tone or the two-tone case, and every failing render
is finite, with no reset, clip or abort. The largest extended-window
sensitivity is 8.5e-7 dB, so no row fails on settling. The `rk4/4x/32`
worst row reproduces #167's -31.18 dB for the same case, and its raw
trajectory equals `renderConditioned`'s bit for bit (tested).

The failing rows follow, as full residuals in dB. **Bold** marks a fail; the
gate is -50 dB on every row listed.

| Controls D/W/S | Signal | Level | 2x/32 | 2x/48s | 4x/32 | 4x/48s |
|---|---|---:|---:|---:|---:|---:|
| 0/1/0 | 1361 | 0.25 | **-38.31** | **-36.96** | -51.58 | **-42.16** |
| 0/1/0 | 997+1361 | 0.25 | **-34.90** | **-34.09** | **-45.63** | **-40.36** |
| 0/1/1 | 1361 | 0.25 | **-38.31** | **-36.96** | -51.58 | **-42.16** |
| 0/1/1 | 997+1361 | 0.25 | **-34.90** | **-34.09** | **-45.63** | **-40.36** |
| 1/0/1 | 1361 | 0.25 | **-44.66** | **-43.05** | -62.50 | **-48.11** |
| 1/0/1 | 997+1361 | 0.25 | **-49.66** | **-45.79** | -69.15 | **-48.36** |
| 1/1/0 | 1361 | 0.25 | **-38.35** | **-36.98** | -51.60 | **-42.14** |
| 1/1/0 | 997+1361 | 0.25 | **-34.96** | **-34.13** | **-45.67** | **-40.35** |
| 1/1/1 | 1361 | 0.25 | **-38.19** | **-36.79** | -51.01 | **-41.83** |
| 1/1/1 | 997+1361 | 0.25 | **-35.37** | **-34.42** | **-46.01** | **-40.26** |
| 0.5/0.5/0.5 | 1361 | 1 | -51.19 | **-47.80** | -72.99 | -50.46 |
| 0.5/0.5/0.5 | 997+1361 | 1 | -56.69 | **-49.95** | -71.13 | -50.65 |
| 0/0/0 | 1361 | 1 | **-42.29** | **-42.24** | -63.22 | -63.01 |
| 0/0/0 | 997+1361 | 1 | **-46.31** | **-46.27** | -66.88 | -66.89 |
| 0/0/1 | 1361 | 1 | **-42.29** | **-42.24** | -63.22 | -63.01 |
| 0/0/1 | 997+1361 | 1 | **-46.31** | **-46.27** | -66.88 | -66.89 |
| 0/1/0 | 1361 | 1 | **-44.79** | **-42.53** | -56.97 | **-46.11** |
| 0/1/0 | 997+1361 | 1 | **-43.65** | **-41.69** | -55.89 | **-45.31** |
| 0/1/1 | 1361 | 1 | **-44.79** | **-42.53** | -56.97 | **-46.11** |
| 0/1/1 | 997+1361 | 1 | **-43.65** | **-41.69** | -55.89 | **-45.31** |
| 1/0/0 | 1361 | 1 | **-32.06** | **-31.94** | -50.82 | **-46.32** |
| 1/0/0 | 997+1361 | 1 | **-37.48** | **-37.15** | -57.81 | **-48.05** |
| 1/0/1 | 1361 | 1 | **-14.80** | **-14.78** | **-31.18** | **-30.62** |
| 1/0/1 | 997+1361 | 1 | **-21.42** | **-21.27** | **-38.50** | **-35.37** |
| 1/1/0 | 1361 | 1 | **-45.26** | **-41.71** | -58.36 | **-44.10** |
| 1/1/0 | 997+1361 | 1 | **-44.07** | **-40.98** | -57.08 | **-43.49** |
| 1/1/1 | 1361 | 1 | **-36.65** | **-35.40** | -60.68 | **-41.37** |
| 1/1/1 | 997+1361 | 1 | **-39.58** | **-37.04** | -56.16 | **-40.56** |

### Does span 48 change the verdict?

**Yes, at both factors, and always from pass to fail.**

- **At 2×**, two rows change: the centre at level 1, bin 1361 and the
  two-tone. The margins are 2.20 and 0.05 dB.
- **At 4×**, sixteen rows change: the bin-1361 and two-tone rows at 0/1/0,
  0/1/1, 1/0/0, 1/1/0 and 1/1/1 at level 1, and the bin-1361 rows at 0/1/0,
  0/1/1, 1/1/0 and 1/1/1 plus both 1/0/1 rows at level 0.25.

The saved spectra locate the change in the pair, not in the integration:

- **Carriers.** The span-32 and span-48 projections agree within 0.0007 dB
  and 1.6e-5 rad on every row.
- **Non-harmonic (alias) energy.** On the bin-1361 rows it agrees within
  0.022 dB between the spans.
- **Harmonic energy.** On every gated bin-1361 row it is **24.37 dB lower**
  with span 48 (-63.7 dBc at most, against -39.2 dBc for the reference and
  -39.3 dBc for span 32). That is the third harmonic at bin 4083 (23.92 kHz,
  0.498 fs), which the span-32 pair passes and the span-48 pair removes.

The declared reference is the span-32 kernel, so a span-48 candidate's
residual includes that filter difference by construction. At 4× it is the
larger error on most high rows. For example, the centre bin-1361 row at
level 1 is -73.0 dB with span 32 and -50.5 dB with span 48, and that row's
reference third harmonic sits at -49.9 dBc. On mid-tone rows where span 32
reaches -131 to -136 dB, span 48 stops near -103 dB. This run cannot
separate the pair difference further, because a span-48 reference is
outside the declared matrix. The verdicts above are the declared gate's,
unadjusted.

### Plain statement

**Neither product setting meets the gates at every control point.**
RK4/2× with span 48 passes 44/72 and fails 28 rows. RK4/4× with span 48
passes 50/72 and fails 22 rows. All the failures are high-tone or two-tone
rows:

- **Worst row.** Both settings are worst at 1/0/1, bin 1361, level 1: -14.78
  dB at 2× and -30.62 dB at 4×, against -50 dB (35.22 and 19.38 dB past the
  gate).
- **Next worst at 4×/48.** The same controls on the two-tone case, at
  -35.37 dB.
- **Other misses at 4×/48.** The remaining twenty rows (0/1/x, 1/1/x, 1/0/0,
  and 1/0/1 at level 0.25) fall between -40.3 and -48.4 dB.

Measured with the span-32 pair, where the reference's own filter matches,
RK4/4× passes 66/72. Its six misses are 1/0/1 at level 1 (bin 1361 and
two-tone) and the two-tone case at 0/1/x and 1/1/x at level 0.25. RK4/2×
passes 46/72. This informs the audition. It does not choose the default and
does not reopen the design record.

### Domain edge (level 4, ungated)

All 144 edge renders are finite, with no reset, clip or abort. The
reconstructed source field reaches |H| = 4.17, including the startup
overshoot, and the knee maps it to at most 2.54. Two cases have no
reference (above). The worst residuals are:

- **With a qualified reference:** -1.4 dB (1/1/1, bin 1361) at 2× and
  -20.2 dB (1/0/0, bin 1361) at 4×.
- **Against the two unqualified references:** +5.3 dB at 2× and -2.6 dB at
  4×, reported but not a result.

Low tones stay below -115 dB at every setting.

### Diagnostics

- **Interpolator.** The interpolator of each FIR class agrees with the
  continuous field at every step point within 2.8e-7 (span 32) and 9.7e-8
  (span 48). That is consistent with the discrete taps being normalised by
  their sum and the continuous kernel by its integral.
- **Other-bin energy.** It meets the -60 dBc figure on 45/72 gated rows at
  2× and 48/72 at 4×, for either span. The worst, about -10.5 dBc, is on
  two-tone rows, where intermodulation counts as other-bin energy; the
  reference shows the same -10.6 dBc there. For single tones the reference's
  non-harmonic energy is at most -90.6 dBc, so a single-tone candidate's
  non-harmonic figure is its aliasing.

## Not resolved here

- Accuracy at 44.1 and 96 kHz: survival is established there, accuracy is
  not.
- A span-48 continuous reference that would separate the pair's response
  from integration error.
- Everything in milestones D and E, including the product default, which
  the audition settles.
