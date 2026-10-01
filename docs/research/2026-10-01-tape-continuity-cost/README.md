# The cost of keeping Tape's output continuous (windsor#296)

The decision is in
[`docs/log/2026-10-01-tape-output-continuity.md`](../../log/2026-10-01-tape-output-continuity.md).
`TapeMagneticCore.retune` gains three operations: a comparison, a division
and a multiplication. They rescale M so that M × gain is continuous.

## Why a Node-side relative measurement

- **The settled render runs the same code.** `retune` is only called
  while the core's controls glide. The goldens are bit-identical, and the
  bundle's code diff is the three lines of `retune`.
- **#250/#254's Chrome harness never retunes.** Its edits move the
  insert's Drive, not the core's controls, so its figures stand as they
  were. On the recorded M1 in Chrome 154, four instances ran:
  - at 2×: 1.087 ms per quantum steady and 1.084 ms with edits, within the
    1.33 ms target;
  - at 4×: 2.075 ms, outside it.

## Method

[`bench.mjs`](bench.mjs), on Node 24.20.0, Apple M1 (arm64, 8 cores),
Darwin 25.5.0, at 48 kHz:

- **Bundles.** The shipped `tape-processor.js` at `634e717` (before), and
  this change's (after).
- **Processors.** Four of each bundle, as #254 ran them, at their default
  parameters with `oversampling` 2 or 4.
- **Program.** 5 s of stereo: 110 Hz and 1,310 Hz tones and seeded noise,
  peaking near −6 dBFS.
- **Cases.**
  - steady: nothing moves;
  - switching: every instance's model changes every 16 quanta, so the
    cores glide, and retune every sample, throughout.
- **Repeats.** Each bundle warms up once, then 11 pairs are rendered, the
  two bundles back to back, alternating which goes first.

The figure is the median ms per 128-frame quantum for each bundle, and
the median, least and greatest after / before ratio over the pairs
(`measurement.ndjson`).

## Result

Other sessions loaded the machine throughout: the one-minute load average
was between 6.6 and 22 during the runs. The absolute times are therefore
three to five times #254's Chrome figures and are not costs.

| Factor | Case | Before, ms | After, ms | After / before (least–greatest) |
|---|---|---|---|---|
| 2× | steady | 4.501 | 5.208 | 1.030 (0.701–1.311) |
| 2× | switching | 3.936 | 3.715 | 0.980 (0.866–1.134) |
| 4× | steady | 6.478 | 6.555 | 1.011 (0.692–1.202) |
| 4× | switching | 5.003 | 4.995 | 1.009 (0.908–1.138) |

**No cost is resolved.** The steady cases run identical code, so their
ratios, 1.030 and 1.011, are the noise floor. The switching ratios, 0.980
and 1.009, lie inside it. A rerun on an idle machine would narrow the
floor. It cannot change the steady figures, which run the same code.
