# A twelfth algorithm: Stack + One, a three-operator stack beside a lone carrier

- **Date:** 2026-10-17
- **Status:** accepted
- **Links:** windsor#895 · the cost, `docs/research/2026-10-17-twelfth-algorithm/`
  · the routing table, `packages/engine/src/worklet/fm/algorithms.ts` · the
  kernel's routing rules, `packages/engine/src/worklet/CLAUDE.md` rule 3

## Context

Until now, none of the eleven algorithms kept a three-deep modulation chain
and a separate voice at once. Series + Tap (`D>C>B>A +B`) taps a chain,
but its second carrier modulates the first. Stack + Two (`D>C | B | A`)
keeps the free voices, but its stack is two deep. The six-operator patch
translation research (`docs/research/2026-10-09-dx7-patch-translation/`,
not on `main`) found that 117 of 780 voices would take such an algorithm,
110 of them closer to the original, with a mean gain of −14.3 dB, measured
in its reduced six-operator renderer (engine gap E5). Two examples are a swept clap
"splat" over a noise tail, and a tom with a separate noise partial.
tacowars also wants it as a sound-design choice of its own.

## Decision

1. **Index 11, `Stack + One`, label `D>C>B | A`:** `mods: [[], [C], [D],
   []]`, `carriers: [A, B]`. D modulates C, C modulates B, and B and A are
   both heard.
2. **Additive.** Indices 0–10 keep their routing and their output.
   `fmProcessorGolden` passes unchanged, and no patch format is bumped: no
   stored patch holds 11, and `normalisePatch` clamps to
   `ALGORITHMS.length − 1`, so 12 or more now clamps to 11, as 11 clamped
   to 10 before.
3. **No kernel change.** Every modulator has a higher index than its
   target, and neither list has three terms, so `kernelEdges` gives the
   algorithm an edge set (`EDGE_CB | EDGE_DC`) and the fixed-index kernel
   renders it through the flags it already reads, bit-identical to the
   generic loop. Its two carriers sum A then B, as every two-carrier
   algorithm does. The generated bundle's diff is the table row.
4. **The picker draws from the table.** The Parts tab's grid of three
   columns goes from 3 + 3 + 3 + 2 to four full rows of three, at 1440 ×
   900 and on the iPad Pro at 1024 × 1366. The diagram puts A and B on the
   carrier row, with C above and D above C, and the operator cards mark A
   and B as carriers. Neither needed a layout change.

## Consequences

- **The voice scales its carrier sum by 1/√(carriers).** With D and C at
  level 0, Stack + One renders Stack + Two's signal at √(3/2) times its
  level, within float32 rounding (1.0e-7 of the peak). It is bit-identical
  to Split Branch (`D>C>(B,A)`) with the same operators at 0, which also
  has two carriers. `synth/fmAlgorithmStackPlusOne.test.ts` pins both, and
  each operator at 0 in turn, in the kernel and in the generic loop.
- **Cost.** On a drum program it costs what Stack + Two does. On a pad
  program it costs 16 % more, the same as the other three-deep chains
  (Split Branch, Twin Mod): on pads the cost follows the depth of the
  chain. The research note has the numbers.
- **The six-operator patch converter** (research code, outside the repo)
  can now map voices to index 11.
