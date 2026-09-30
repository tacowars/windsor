# Keep the first magnetic Tape experiment outside the product

**Later direction (2026-09-30):**
[Tape greenfield direction](2026-09-30-tape-greenfield-direction.md)
supersedes the mandatory legacy-parity/opt-in requirements below. This
record preserves the original experiment's decisions and evidence.

Phase 3 begins with a reproducible source audit and scalar prototype in
`docs/research/2026-09-30-tape-phase-3/`. The phase-2 commit `c83564f` is the
baseline. There is no shipped DSP, schema, preset or UI change in this increment.

## Experiment decisions

Compare the CHOW-derived modern Jiles–Atherton equation with RK2/RK4 and
1×/2×/4×/8× sampling. Use RK4 at 32× as a numerical reference and compare
it with 64× before treating it as ground truth. These are research choices,
not product quality settings. Keep raw magnetic state separate from DC
removal and gain compensation so tests can observe memory and instability.
Preserve GPL attribution; do not attribute this work to CC0 REELS.

Use a simple original linear-phase FIR pair for controlled comparisons.
It costs 32 host samples in the identity-core test at all oversampled
settings. Do not reuse CHOW's 1.4-sample correction or claim that fixed
filter alignment removes frequency-dependent nonlinear phase error.

The experiment exposes a convergence/cost tradeoff and overload resets.
Therefore it does **not** select a shipping core or expose a new mode.
RK2/4× is a useful next optimization candidate, with RK4 retained as a
comparison; neither is approved as a production quality setting.

## Compatibility and latency constraints for integration

The absent/default future mode must select the untouched legacy path,
including its seeded calls, old Wear materialization, tonal Bias, Mix and
exact settled dry bypass. No format bump is needed here because no file
shape changes. Any later additive-mode exception depends on proving its
absent default reproduces old behavior; changed meanings require the
format-version process.

For a new mode, align its fixed wet/dry delay locally and keep that delay
stable through its own bypass/quality changes. Deliberately variable
transport delay remains part of the effect. Preallocate histories and
transition state, and prove no stale state or per-block allocation.

The existing insert contract exposes no latency compensation. Adding
delay to the legacy path would break compatibility, and delaying only the
new mode affects parallel tracks/returns. A mode-transition and parallel
routing decision is therefore required **before integration**, separately
from solver work. Do not silently invent compensation support or assume a
crossfade between differently delayed signals is transparent.

## Proposed acceptance targets for the next experiment

These are engineering targets, not a listening verdict or claims the
prototype already meets:

- Zero resets/nonfinite output on a declared normal input/control domain
  at 44.1/48/96 kHz, including rapid edits, DC and 60-second recovery runs.
  Count overload resets separately and bound/recover both signs.
- At least -60 dB residual against a demonstrably converged reference for
  low/mid tones, and -50 dB for the high-tone and two-tone cases, after
  aligning only the fixed filter delay. Report gain/phase error separately
  before making sound-quality claims. Refine the reference until its error
  is at least 10 dB below the applicable target.
- At most -60 dBc non-harmonic energy on the declared ≤1 peak single-tone
  domain, with enough settling to separate transient leakage from aliases.
  Test the filter transition band and independently validate reference
  response; the present three coherent frequencies are not a full sweep.
- Target a cumulative four-instance DSP cost below half a 48 kHz quantum
  (1.33 ms), including edits, on the recorded M1/browser. This reserves
  capacity for the instrument and other inserts. The existing 1 ms clock
  cannot certify that target; obtain a finer measurement or trace before
  selecting a product quality setting. Coarse duty estimates are diagnostic.
- Level-matched synth bass, chords, hats and transient audition still
  requires the user. The muted synthetic browser workload is not audition.

The next small increment should address conditioning/convergence and
resampler cost, without adding playback loss, transport or controls at the
same time. Measurement methods, results and limits are in the research README.
