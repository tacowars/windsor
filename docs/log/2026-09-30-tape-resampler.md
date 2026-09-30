# Qualify the Tape oversampling FIR pair and split its cost from the core

Windsor [#207](https://github.com/tacowars/windsor/issues/207) opens
milestone C of [epic #146](https://github.com/tacowars/windsor/issues/146).
Every candidate solver runs the magnetic core at 2, 4 or 8× between two
identical Blackman-windowed sinc FIRs, the original Windsor pair from
[the prototype](2026-09-30-tape-magnetic-prototype.md). That pair's gain
and latency were pinned. Its passband, transition, imaging and aliasing
were never qualified, and its cost was never separated from the core's.
Milestones C and D need to choose a filter from numbers.

## Decision

Keep the family fixed and sweep only its length:

- **Family.** Taps `span × factor + 1`, Blackman window, cutoff
  `0.45 / factor`, both FIRs identical, `span` host samples of latency.
- **Sweep.** Spans 16, 24, 32, 48 and 64, at 2, 4 and 8×.
- **Figures.** Two, declared before measurement: the epic's **-60 dBc** on
  the worst image and the worst alias, and **±0.1 dB to 0.40 fs** on the
  end-to-end pair. Both are reporting thresholds for choosing among these
  filters. They are not audibility claims and not product acceptance.

Every figure is measured two ways, from the impulse response and by direct
tone. The measurement uses an identity core and the unchanged
`ResampledHysteresis`.

The cost split uses the phase-3 Node benchmark method, with and without the
GPL-3.0-only CHOW-derived RK4 core. That core is used here only to split
cost, and its attribution is kept.

The [research README](../research/2026-09-30-tape-resampler/README.md)
records the method, the per-filter table, every agreement figure and the
measured environment. The run took 33.4 s of its 900 s bound, with nothing
missing.

## Outcome

- **Spans that meet both figures.** At every factor, only **spans 48 and
  64** do:
  - span 48: 0.031 dB, -75.1 dBc image, -81.1 dBc alias;
  - span 64: 0.003 dB, -85.7 dBc image, -91.7 dBc alias.
- **Span 32, the phase-3 filter.** It meets -60 dBc, at -73.0 image and
  -79.0 alias. It **fails** the passband figure, at 0.68 dB end to end at
  0.40 fs.
- **Spans 16 and 24.** They fail both figures.
- **Both methods.** They agree within 3.7e-4 dB on passband deviation and
  within 5.9e-4 dB on image and alias levels.
- **Delay.** The pair's delay is exactly `span` host samples at every
  point.
- **Coefficients.** They are symmetric within 5.6e-17 and sum to 1 within
  8.9e-16. They are not bit-exactly symmetric.
- **Cost of the figures.** Spans 48 and 64 cost 1.4–1.9× the span-32
  pair's Node time. They raise latency from 0.667 ms to 1.0 or 1.333 ms at
  48 kHz. At span 32, the existing pair is 20–23% of the RK4 path's Node
  cost.
- **The symmetric decimator.** It is 10–22% faster than the existing loop
  with an identity core. With RK4 it saves 2.9% at 2× and 3.2% at 4×.
  This run does not resolve its sign at 8×. It is **not** shown equivalent
  within the declared 1e-15 × peak: the difference reaches 3.3e-15 × peak.
  A Dot2 reference puts that rounding in the existing loop. The symmetric
  loop stays within 2.2e-16 of the reference, and the existing loop within
  1.67e-15.

Milestone D may choose from spans 48 and 64 of this family if it keeps
these figures. It may use span 32 only by relaxing the passband figure.
The product filter, solver, default and latency are **not chosen here**.
No other window, cutoff or family was tried; each would be a separate
task.

## Still unresolved

- Browser cost of four instances with music input and edits, against
  phase 2. This is the next milestone C child. The Node timings here do
  not stand in for it, and they are not a quantum budget.
- Candidate accuracy on the corner tones.
- Milestones D and E, including the fixed delay and dry alignment that a
  `span`-sample pair requires.
