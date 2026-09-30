# CHOW nonlinear path audit

Inspected local AnalogTapeModel revision
`604372e4ffd9690c3e283362e4598cb43edbb475` on 2026-09-30. Source links below
are pinned to that revision. This is a source audit, not a CHOW binary comparison.

## Chain and wrapper

[`PluginProcessor.cpp`](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/604372e4ffd9690c3e283362e4598cb43edbb475/Plugin/Source/PluginProcessor.cpp)
copies dry before input gain/filtering, then processes mid/side input,
tone-in, compression, hysteresis, tone-out, chew, degradation, transport,
loss, latency compensation, mid/side output, input-filter makeup, output
gain and dry/wet. Final buffer sanitization is a separate safety layer.

[`HysteresisProcessor.cpp`](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/604372e4ffd9690c3e283362e4598cb43edbb475/Plugin/Source/Processors/Hysteresis/HysteresisProcessor.cpp)
and its header establish the production behavior surrounding the equation:

- Drive, width and saturation are linearly smoothed over 500 **internal
  samples**, not a fixed number of milliseconds. Makeup is multiplicatively
  smoothed over 500 internal samples. Porting that count unchanged would
  change smoothing duration with rate/oversampling.
- The UI's Tape Bias is inverted before becoming internal width. Modern
  modes map `c = sqrt(1 - width) - 0.01`, `Ms = 0.5 + 1.5*(1-sat)` and
  `a = Ms/(0.01 + 6*drive)`. This is not Windsor's existing tonal Bias,
  and not an explicit ultrasonic bias oscillator. At width 1, `c` is -0.01;
  the parameter bounds need investigation, not a claim of physical validity.
- Input hard limits precede upsampling: ±8 for RK2, ±10 for RK4, ±12.5 for
  NR4/NR8. Solver clipping is part of its behavior. The research core uses
  a common ±8 **at the internal sample rate** to isolate solver comparisons;
  this is intentionally different, especially on interpolation overshoot.
- The wrapper upsamples double buffers, runs per-channel state (SIMD pairs
  in this build), applies makeup `(1 + 0.6*width)/Ms`, downsamples and applies
  a fourth-order Butterworth highpass at 35 Hz (`DCBlocker.h`).
- Oversampling changes recook and reset the core; switching V1 resets it
  too. Modern solver changes share state. `BypassProcessor.h` fades for
  one block using an undelayed local copy, then skips processing while off.
  This is not a transition design to adopt without a delay-alignment audit.
- V1 has different magnetic scales and a separate bias sinusoid. STN calls
  a learned model and has additional dependencies. Neither is prototyped.
- Reported nonlinear latency is oversampling latency plus 1.4 samples when
  on, zero when off. Plugin-level compensation adds loss and compression
  latency, delays dry, and reports rounded latency to its host. Below 15%
  wet it uses integer dry delay; otherwise fractional delay. Windsor has no
  equivalent host latency interface in `InsertStage`/`insertChain.ts`.

`ToneControl.{h,cpp}` uses reciprocal input/output shelf gains around the
nonlinearity with a 50 ms smoother. It is distinct from magnetic bias and
from playback loss. Do not stack it with Windsor profile EQ by accident.

## Numerical core

[`HysteresisOps.h`](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/604372e4ffd9690c3e283362e4598cb43edbb475/Plugin/Source/Processors/Hysteresis/HysteresisOps.h)
and [`HysteresisProcessing.h`](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/604372e4ffd9690c3e283362e4598cb43edbb475/Plugin/Source/Processors/Hysteresis/HysteresisProcessing.h)
implement the Jiles–Atherton time derivative, Langevin evaluation and an
alpha-transform input derivative with coefficient 0.75. RK2 is midpoint;
RK4 interpolates input and derivative at the midpoint. NR4/NR8 iterate an
implicit residual with `T/1.9`, so they are not simply higher iteration
versions of the same explicit discretization. Their cached analytic
derivative must remain synchronized with the function evaluation.

The near-zero branch substitutes `Q/3` and `1/3`; the source nevertheless
calculates reciprocal Q and coth before selecting that branch. Its final
instability guard checks NaN and a **positive** upper limit, not both signs
and infinities. Those details should not become implicit Windsor contracts.

The scalar prototype preserves the modern parameter mapping and RK formulas,
but branches before division near zero, uses higher-order Taylor terms,
checks small denominators, checks both state polarities and all nonfinite
values, resets all history on failure, and counts resets/clipping. No
makeup, smoothing, magnetic bias oscillator or production DC filter is hidden
inside it. Raw magnetization retaining a value at zero input is expected;
the audible output needs DC handling. The overload failures in the report
are evidence that guards are recovery measures, not proof of a stable solver.

## Resampling and dependencies

Windsor's `driveOversample.ts` is a fixed 65-tap, 2× Blackman FIR at a
0.235 internal-rate cutoff (32 host samples for the pair). Its general
idea is suitable for an experiment, but the implementation is tied to
Advanced Drive constants and full-rate convolution. This prototype uses
an original polyphase interpolator and output-rate decimator, with
`32*factor+1` taps and cutoff `0.45/factor`. The measured 32-sample delay is
for the **linear filter pair**, not a promise about the nonlinear phase.

The checkout has gitlinks for JUCE `ebbe26fd...`, chowdsp_utils `39851f12...`,
RTNeural `0ec5023f...`, foleys GUI and CLAP extensions, but their source is
not populated. Thus `VariableOversampling`, JUCE filter design, exact
minimum/linear-phase coefficients, allocation behavior and dependency
licence notices have **not** been audited. No code from those dependencies,
SIMD layer, neural models, UI or assets is included here. Do not describe
this prototype as a complete JUCE/CHOW port or predict JS cost from it.

## Attribution and licence

`hysteresis.ts` adapts Jatin Chowdhury's three core files above plus the
parameter mapping in `HysteresisProcessing.cpp`, under the checkout's
GPLv3 declaration. It carries an explicit GPL-3.0-only notice and a copy
of that licence in [COPYING](COPYING); Windsor modifications are described
in its header and above. No additional per-file notice appears in those
four upstream files. Preserve this attribution in any later integration.
GPLv3 and AGPLv3 section 13 address combined works; the adapted portion
retains its GPL terms and Windsor retains its AGPL terms. This is unrelated
to the CC0 REELS Lite provenance of the shipping Tape effect.

The explanatory reference is Jatin Chowdhury's
[2019 DAFx paper](https://www.dafx.de/paper-archive/2019/DAFx2019_paper_3.pdf),
especially equations 18–22. The paper identifies its own CC BY 3.0 licence;
its text/figures are not copied into the prototype. Later CHOW code has
different conditioning and parameters, so matching this code does not
establish a calibrated Sony TC-260 model.
