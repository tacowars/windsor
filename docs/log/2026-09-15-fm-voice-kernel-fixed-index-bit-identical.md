# The FM voice loop takes a fixed-index kernel, proven bit-identical

- Date: 2026-09-15
- Area: audio
- Links: issue #548 · research `docs/research/2026-09-15-548-fm-voice-loop-specialisation/`

## Decision

**Go.** #548's go/no-go rule was bit-identical output for every factory
preset and at least 20 % less render time on its scenario. The prototype
met both, so it ships:

- `Voice.renderKernel` in `worklet/fm-processor.js` is one kernel for every
  algorithm. It evaluates the operators D, C, B, A with their state in locals.
  Routing is read as six edge flags and four carrier flags, set once per render
  call, not walked per sample through `order` and `mods`.
- Within a render call, an operator whose amplitude is exactly 0 and not
  ramping is not computed. Its phase still advances. Its feedback history is
  set to the ±0 the generic loop would have stored. A noise operator is never
  skipped.
- `bindConstants`, called from `start` and `rebind`, precomputes the two
  per-note `Math.pow` values in `updateControl`. It also decides whether the
  voice takes the kernel.
- The generic loop stays, for two jobs. It is the fallback: a voice with two
  noise operators on an algorithm whose topological order is not D..A, or an
  algorithm table the kernel cannot render exactly. It is also the reference:
  `processorOptions.specialise: false` (never set by the game or the console)
  renders every voice through it, with the `Math.pow` calls inline, as main
  did. `fmProcessorKernel.test.ts` renders all 114 factory presets both ways
  and compares the Float32 bytes.

Dev-machine result (Apple M4 Pro, Node v24.16.0, indicative): the 12-voice
scenario went from 232–235 ms to 111.5–112 ms, a 52 % cut. The target-box
reading goes through the #445 arm (see the research README).

## Why

Bit-identity holds by construction, not by tolerance:

- The kernel performs the same IEEE operations in the same order. Float32
  stores become `Math.fround`, and table reads, feedback and the filter are
  unchanged.
- Every algorithm's modulators have a higher index than their target, so D..A
  is a valid evaluation order. The only order-dependent shared state is the
  voice's noise generator, which is why two noise operators need the D..A
  topological order.
- Summing modulators or carriers from +0 means that dropping a term that is
  exactly ±0 changes no bits. Two-term sums commute exactly. Three-term lists
  must already be ascending, and `kernelEdges` refuses one that is not.
- The idle rule is "amplitude exactly 0 for the whole call". That is precisely
  the case where an operator's output multiplies to ±0 everywhere, so the rule
  covers level-0 operators without trusting the level.

## Punted / alternatives

- **Eleven hand-written kernels, or kernels per active-operator set.** The
  single flagged kernel already cuts 45–66 % per part. The branches are
  constant for the whole call, and V8 predicts them. More kernels would
  multiply the code the review has to trust, for a saving nobody has measured.
- **`new Function` kernels generated at bind time.** Not needed. It would also
  have made the worklet depend on the page's CSP allowing eval in
  `AudioWorkletGlobalScope`.
- **Skipping an idle operator's phase.** Rejected. A live retune can wake the
  operator, and its phase must be where the generic loop would have left it.
- **Per-sample `Math.floor` and the kind branch.** Left in place. Removing
  either changes the arithmetic, and the ticket forbids any audible change.
