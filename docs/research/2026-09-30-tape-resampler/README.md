# Tape resampler: the phase-3 FIR pair's response and cost

Windsor [#207](https://github.com/tacowars/windsor/issues/207) opens
milestone C of [epic #146](https://github.com/tacowars/windsor/issues/146)
with the resampler. Every candidate solver runs the magnetic core at 2, 4 or
8× the host rate between an interpolating FIR and a decimating FIR, the
original Windsor pair in
[`resampler.ts`](../2026-09-30-tape-phase-3/resampler.ts). Until now its
gain and latency were pinned, but its passband, transition, imaging and
aliasing were never qualified, and its cost was never separated from the
core's. This task measures both on a declared span sweep, and adds a
symmetric form of the decimator.

It is research only. It chooses no product filter, solver or default and
changes no shipping code. The shipping resampler, like the shipping core,
will be written separately as original work.

The FIR is original Windsor work. The core is Jatin Chowdhury's
GPL-3.0-only CHOW Tape adaptation at upstream
`604372e4ffd9690c3e283362e4598cb43edbb475`
([AUDIT](../2026-09-30-tape-phase-3/AUDIT.md),
[COPYING](../2026-09-30-tape-phase-3/COPYING)). Here it is used only to
split cost, in part 3. `coefficients`, `ResampledHysteresis` and
`Hysteresis` are imported unchanged.

## Declared experiment before measurement

[`resamplerConstants.ts`](resamplerConstants.ts) holds every value below.
The code is laid out as follows:

- [`response.ts`](response.ts) does part 1.
- [`symmetric.ts`](symmetric.ts) holds the symmetric loop and part 2.
- [`measure.mjs`](measure.mjs) runs the bounded child and part 3.
- [`evidence.mjs`](evidence.mjs) derives every table from saved records.

The phase-3 loader and report writer and #167's journal recovery are reused
by read-only import.

**Family.** The existing pair has `span × factor + 1` taps, a Blackman
window, and a cutoff of `0.45 / factor` in oversampled units. Both FIRs are
identical, and the pair's latency is `span` host samples. The sweep is
**spans 16, 24, 32, 48 and 64** at **factors 2, 4 and 8**: fifteen filters,
all at 48 kHz, Float64, with an identity core. No other window, cutoff or
family is measured.

**Part 1, response.** Each figure is measured two ways:

- **From the impulse response.** It is captured through the unchanged
  class and read with an exact DTFT.
- **By direct tone.** A coherent cosine runs through the same class and is
  read with a direct DFT.

Every declared tone is an exact bin of a 400-frame rectangular window, so
the steady state is exactly periodic and no FFT is needed. 256 frames
settle before each window.

- **Interpolator alone.** The following are measured:
  - The magnitude on a 4096-point grid, from 0 to the oversampled Nyquist
    inclusive.
  - The passband deviation over 0 to 0.40 host fs. The impulse-response
    method scans 4001 points. The tone method uses 40 tones at 0.01 steps.
  - The -0.1, -1 and -6 dB edges. The impulse-response method finds the
    first crossing on the passband step, then bisects 48 times. The tone
    method bisects over the bins of an 8192-frame window, then
    interpolates linearly in dB.
  - The worst image for the host tones 0.05, 0.10, 0.20, 0.30, 0.40 and
    0.45 fs: the largest spectral peak of the oversampled output above
    0.5 host fs, relative to the tone.
- **Decimator alone.** A stand-in core object returns an injected unit
  oversampled cosine, so the class's own decimation loop is what is
  measured. The cosine is injected at every in-band image `k·fs ± f`,
  `k = 1 … factor−1`, of the same six tones. The leaked host-band peak is
  the alias level.
- **The pair in cascade.** This gives the end-to-end passband deviation,
  the same three edges, and the delay: the impulse response's peak index
  and centroid, and each passband tone's phase against `span`.
- **Linear phase.** It is asserted by coefficient symmetry, not by
  unwrapped phase. Each FIR's group delay is `(taps − 1) / 2` oversampled
  samples, which is `span / 2` host samples.

**Reporting figures.** These are for choosing among these filters. They are
not audibility claims and not product acceptance.

- **-60 dBc:** the epic's target, applied to the worst image and to the
  worst alias.
- **±0.1 dB to 0.40 fs:** applied to the end-to-end cascade deviation. The
  issue did not say which path it applies to. The interpolator alone is
  reported beside it, and the verdicts are the same on either.

The two methods must agree within 0.01 dB on passband deviation and within
1 dB on image and alias levels. The coefficient checks use declared
tolerances: a mirrored difference of at most 1e-15, and a sum within 1e-14
of 1.

**Part 2, symmetric decimator.** The loop pairs mirrored taps, with one
multiply per pair and the centre tap alone. The interpolator loop is copied
unchanged. Both loops run on a deterministic 65,536-frame stereo signal:

- **Left:** phase 3's benchmark sines.
- **Right:** LCG noise of amplitude 0.5, with seed 207.

The declared bound is a maximum absolute difference of at most 1e-15 × the
signal's peak. The difference and its location are recorded.

Bit identity is not claimed. As a diagnostic beyond the issue, each loop's
own error is also measured against an Ogita–Rump–Oishi Dot2 reference over
the same oversampled samples. This is a dot product accurate to about twice
Float64 precision.

**Part 3, cost split.** This uses the phase-3 benchmark method:

- One-second rounds, five of them, after a one-second warmup.
- Stereo, at 48 kHz.
- Alternating cell order.
- Phase 3's precomputed input,
  `0.3 sin(0.057 i) + 0.1 sin(0.37 i)`, with the right channel its
  negation. That input is inline in phase 3's `measure.mjs`, which runs an
  experiment when imported, so the same formula is declared again here.

Four variants are timed:

- **(a)** identity core, existing decimator.
- **(b)** identity core, symmetric decimator.
- **(c)** RK4 core, existing decimator.
- **(d)** RK4 core, symmetric decimator.

(a) and (b) run at every sweep span. All four run at span 32. The groups
run cheapest first: the three identity sweeps by factor, then a/b/c/d at
span 32 by factor.

**Stop rule.** One sequential child runs under a parent-enforced
**900-second** wall-clock bound, as in #188, with part 1, then part 2, then
part 3. Each filter record, equivalence point and benchmark round is
journaled on completion. A killed run keeps its partial groups and any
truncated tail. The report is assembled afterwards, with no new numerical
work, and there is no retry or overlapping job.

## Reproduce

Run from the repo root on Node 24:

```sh
node docs/research/2026-09-30-tape-resampler/measure.mjs
npx vitest run scripts/lib/tapeResampler.test.mjs --no-cache
```

## Results

[`measurement.json`](measurement.json) holds the single bounded run. It
completed in 33.4 s of the 900 s bound, with nothing missing. Every record
is in it: grids, tone sweeps, every image and alias by both methods,
equivalence points and every benchmark round.

**Coefficients and delay.**

- **Symmetry.** No filter's coefficients are *bit-exactly* symmetric. The
  largest mirrored difference is 5.6e-17, and the largest |sum − 1| is
  8.9e-16. Both are within the declared tolerances. The cause is rounding:
  the window's cosine at `i` and at `N−1−i`, and the normalising division.
- **Identical FIRs.** The interpolator and decimator impulse responses,
  captured through the class, equal the coefficients exactly at every sweep
  point, so the two FIRs are identical.
- **Delay.** The cascade peaks at index `span` at every point. Its centroid
  is within 4.3e-14 of `span`, and every passband tone's phase delay is
  within 2.6e-14 samples of it. The pair's delay equals `span` host samples
  exactly: 0.333, 0.5, 0.667, 1.0 and 1.333 ms at 48 kHz.

**Per filter.** The column abbreviations:

- *Pair* is the end-to-end deviation with the identity core.
- *Interp.* is the interpolator alone.
- *Edges* are the cascade's -0.1 / -1 / -6 dB points, in host fs.
- *Image* and *alias* are the worst levels, in dB.
- *Cost* is the identity-core pair's median ms per second of stereo audio,
  existing / symmetric decimator.

| Factor | Span | Taps | Pair ±dB to 0.40 | Interp. ±dB | Edges | Image | Alias | Delay | ±0.1 dB | -60 dBc | Cost ms |
|---|---:|---:|---:|---:|---|---:|---:|---:|---|---|---:|
| 2× | 16 | 33 | 3.8127 | 1.9063 | 0.3154 / 0.3594 / 0.4177 | -22.35 | -28.37 | 16 | **fail** | **fail** | 12.11 / 9.40 |
| 2× | 24 | 49 | 1.7755 | 0.8877 | 0.3601 / 0.3896 / 0.4284 | -49.06 | -55.08 | 24 | **fail** | **fail** | 14.57 / 13.13 |
| 2× | 32 | 65 | 0.6755 | 0.3378 | 0.3826 / 0.4047 / 0.4338 | -73.01 | -79.03 | 32 | **fail** | pass | 18.86 / 16.03 |
| 2× | 48 | 97 | 0.0307 | 0.0153 | 0.4051 / 0.4198 / 0.4392 | -75.10 | -81.12 | 48 | pass | pass | 26.74 / 23.10 |
| 2× | 64 | 129 | 0.0030 | 0.0015 | 0.4163 / 0.4273 / 0.4419 | -85.70 | -91.72 | 64 | pass | pass | 33.68 / 29.58 |
| 4× | 16 | 65 | 3.8126 | 1.9063 | 0.3154 / 0.3594 / 0.4177 | -22.35 | -28.37 | 16 | **fail** | **fail** | 19.84 / 17.05 |
| 4× | 24 | 97 | 1.7754 | 0.8877 | 0.3601 / 0.3896 / 0.4284 | -49.05 | -55.07 | 24 | **fail** | **fail** | 27.21 / 24.15 |
| 4× | 32 | 129 | 0.6755 | 0.3378 | 0.3826 / 0.4047 / 0.4338 | -72.97 | -78.99 | 32 | **fail** | pass | 34.91 / 30.04 |
| 4× | 48 | 193 | 0.0307 | 0.0153 | 0.4051 / 0.4198 / 0.4392 | -75.08 | -81.10 | 48 | pass | pass | 49.74 / 44.72 |
| 4× | 64 | 257 | 0.0030 | 0.0015 | 0.4163 / 0.4273 / 0.4419 | -85.72 | -91.74 | 64 | pass | pass | 65.47 / 55.81 |
| 8× | 16 | 129 | 3.8126 | 1.9063 | 0.3154 / 0.3594 / 0.4177 | -22.35 | -28.37 | 16 | **fail** | **fail** | 43.99 / 38.36 |
| 8× | 24 | 193 | 1.7754 | 0.8877 | 0.3601 / 0.3896 / 0.4284 | -49.05 | -55.07 | 24 | **fail** | **fail** | 58.84 / 50.42 |
| 8× | 32 | 257 | 0.6755 | 0.3378 | 0.3826 / 0.4047 / 0.4338 | -72.97 | -78.99 | 32 | **fail** | pass | 77.66 / 66.66 |
| 8× | 48 | 385 | 0.0307 | 0.0153 | 0.4051 / 0.4198 / 0.4392 | -75.08 | -81.10 | 48 | pass | pass | 114.09 / 99.58 |
| 8× | 64 | 513 | 0.0030 | 0.0015 | 0.4163 / 0.4273 / 0.4419 | -85.72 | -91.74 | 64 | pass | pass | 148.06 / 126.86 |

The interpolator's own -0.1 / -1 / -6 dB edges are in the report. Its
-6 dB edge is 0.4498–0.4500 fs everywhere, which is the 0.45 cutoff.

In host units, the response depends on span, not factor. The three factors
agree to within 0.05 dB on every figure above.

- **Worst image.** At every point it is the 0.45 fs tone's first image, at
  0.55 fs. It is measured relative to that tone, which itself sits at about
  -6 dB.
- **Worst alias.** It is the same 0.55 fs image, reaching the decimator
  unattenuated, so it reads about 6 dB lower than the worst image.

Both methods agree everywhere. The largest disagreements are:

- 3.7e-4 dB on passband deviation, at span 64. There the 4001-point scan
  finds a ripple peak (0.0030 dB) between the 0.01-spaced tones (0.0026 dB).
- 2.4e-7 dB on image level.
- 5.9e-4 dB on alias level, in the deep stopband, at -192 dB.

The tone-measured edges match the impulse-response edges to 4 decimals.

**Symmetric decimator, part 2.** The declared bound is **not met at 14 of
the 15 points**. The table's *Location* column is the channel and frame of
the largest difference.

| Point | Max difference | ÷ peak | Location | Existing loop vs Dot2 | Symmetric loop vs Dot2 | ≤ 1e-15 × peak |
|---|---:|---:|---|---:|---:|---|
| 2x/16 | 3.33e-16 | 6.66e-16 | right 2568 | 4.44e-16 | 1.11e-16 | pass |
| 2x/24 | 5.55e-16 | 1.11e-15 | right 20023 | 5.55e-16 | 1.11e-16 | **fail** |
| 2x/32 | 5.55e-16 | 1.11e-15 | right 1209 | 5.55e-16 | 1.11e-16 | **fail** |
| 2x/48 | 6.66e-16 | 1.33e-15 | right 12151 | 6.66e-16 | 1.11e-16 | **fail** |
| 2x/64 | 8.88e-16 | 1.78e-15 | right 54516 | 8.88e-16 | 1.11e-16 | **fail** |
| 4x/16 | 5.55e-16 | 1.11e-15 | right 2281 | 6.66e-16 | 1.67e-16 | **fail** |
| 4x/24 | 6.66e-16 | 1.33e-15 | right 10559 | 6.66e-16 | 1.11e-16 | **fail** |
| 4x/32 | 8.88e-16 | 1.78e-15 | right 24942 | 8.88e-16 | 1.11e-16 | **fail** |
| 4x/48 | 1.11e-15 | 2.22e-15 | right 26089 | 1.11e-15 | 1.11e-16 | **fail** |
| 4x/64 | 1.22e-15 | 2.44e-15 | right 47199 | 1.22e-15 | 1.11e-16 | **fail** |
| 8x/16 | 7.77e-16 | 1.55e-15 | right 24517 | 7.77e-16 | 2.22e-16 | **fail** |
| 8x/24 | 9.99e-16 | 2.00e-15 | right 5724 | 8.88e-16 | 2.22e-16 | **fail** |
| 8x/32 | 1.11e-15 | 2.22e-15 | right 26718 | 1.11e-15 | 1.11e-16 | **fail** |
| 8x/48 | 1.55e-15 | 3.11e-15 | right 22695 | 1.55e-15 | 2.22e-16 | **fail** |
| 8x/64 | 1.67e-15 | 3.33e-15 | right 8974 | 1.67e-15 | 2.22e-16 | **fail** |

The signal's peak is 0.49998, so the bound is 5.0e-16. The largest
difference is 3.3e-15 × peak, at 8x/64: Float64 rounding at the 1e-15
level, not a structural error.

The Dot2 diagnostic places the difference in the **existing** loop. The
existing loop is up to 1.67e-15 from the reference. The symmetric loop is
at most 2.2e-16 from it, and is the closer of the two at every point. A
centre tap off by 1e-9 fails the same comparison by more than four orders
of magnitude (see the test).

The declared bound is left as declared, and is not met. The loops are not
shown equivalent within 1e-15 × peak. What is shown is that they agree
within 3.4e-15 × peak, and that the symmetric loop is the more accurate one.

**Cost split, part 3.** These are medians in ms per second of stereo audio,
at span 32.

| Factor | (a) identity, existing | (b) identity, symmetric | (c) RK4, existing | (d) RK4, symmetric | FIR share (a)/(c) | Saving (c) − (d) |
|---|---:|---:|---:|---:|---:|---:|
| 2× | 22.07 | 20.18 | 94.31 | 91.60 | 23.4% | 2.71 (2.9%) |
| 4× | 42.07 | 37.85 | 185.63 | 179.72 | 22.7% | 5.91 (3.2%) |
| 8× | 70.01 | 62.91 | 347.79 | 376.87 | 20.1% | -29.08 (-8.4%) |

- **FIR share.** The existing FIR pair is 20–23% of the RK4 path's Node
  cost at span 32.
- **Identity core.** The symmetric loop is faster at every one of the 15
  sweep points, by 10–22%. In the span-32 groups it is faster by 9–10%.
- **RK4 core.** The symmetric loop saves 2.9% at 2× (d < c in 4 of 5
  rounds) and 3.2% at 4× (5 of 5). At 8× the RK4 rounds spread from
  326–395 ms for (c) and 318–391 ms for (d). That spread is larger than
  the ~7 ms the loop saves with an identity core, so this run does not
  resolve the sign of the 8× saving.
- **Context.** The same identity cell, timed in two groups, differed by up
  to 21%: 18.86 against 22.07 ms at 2×, 34.91 against 42.07 at 4×, and
  77.66 against 70.01 at 8×. Only differences inside one group are
  compared.

**Environment.** The measurement ran on an Apple M1 (arm64), Darwin
25.5.0, Node v24.21.0 / V8 13.6.233.17-node.53.

- **Backend.** Float64 source DSP, from an esbuild bundle of the research
  TypeScript.
- **Load.** The load average was 3.0–4.4 during the run, from the user's
  other applications, which were not controlled.

This is **Node cost**. It is not browser or audio-thread cost, and it is
not a quantum budget.

## Outcome

These are the smallest statements the evidence supports.

- **Which spans meet both figures.** At each of 2×, 4× and 8×, **spans 48
  and 64** meet ±0.1 dB to 0.40 fs and -60 dBc for both images and
  aliases:
  - span 48: 0.031 dB, -75.1 dBc image, -81.1 dBc alias;
  - span 64: 0.003 dB, -85.7 dBc image, -91.7 dBc alias.
- **Which spans fail.** Spans 16 and 24 fail both figures. Span 32, the
  phase-3 filter, meets -60 dBc (image -73.0, alias -79.0) but fails the
  passband figure: 0.68 dB end to end at 0.40 fs, and 0.34 dB for the
  interpolator alone.
- **Choices for milestone D.** Within this family and cutoff, milestone D
  may choose from spans 48 and 64 if it keeps these two figures. Span 32
  is available only if it relaxes the passband figure.
- **Cost of meeting the figures.** For the identity-core pair, in ms per
  second of stereo audio, existing / symmetric decimator:
  - 2×: span 48 costs 26.7 / 23.1, and span 64 costs 33.7 / 29.6. Span 32
    costs 18.9 / 16.0.
  - 4×: span 48 costs 49.7 / 44.7, and span 64 costs 65.5 / 55.8. Span 32
    costs 34.9 / 30.0.
  - 8×: span 48 costs 114.1 / 99.6, and span 64 costs 148.1 / 126.9. Span
    32 costs 77.7 / 66.7.
- **Latency of meeting the figures.** The latency rises from 32 host
  samples (0.667 ms at 48 kHz) to 48 (1.0 ms) or 64 (1.333 ms).

The product filter is **not chosen here**. No window, cutoff or other
family was tried.

## Unresolved

- The browser cost of four instances with music input and edits, against
  phase 2. This is the next milestone C child. The Node numbers above do
  not stand in for it.
- Candidate accuracy on the corner tones.
- Milestones D and E, including the fixed-delay, dry-alignment, bypass and
  parallel-routing work that the pair's `span`-sample latency requires.
- The symmetric decimator's declared equivalence bound, which is not met.
- The sign of its RK4 saving at 8×, which this run does not resolve.
- Other filter families (half-band, polyphase IIR, minimum phase, another
  window or cutoff). Each is a separate task.
