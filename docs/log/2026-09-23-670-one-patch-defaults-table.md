# One patch-defaults table; the worklet's pitch and filter envelope fallbacks join makePatch's

- Date: 2026-09-23
- Area: audio
- Links: issue #670 · record `2026-09-23-656-one-algorithm-table-one-wave-id-set-one-curve` ("Punted"), #669

## Decision

`packages/client/src/audio/worklet/fm/patchDefaults.ts` holds every default a
patch may omit, the worklet's `tone` and feedback clamp bounds and
`OPERATOR_COUNT` (moved there from `audioConstants.ts`, which re-exports it).
`normalisePatch` (worklet) and `makePatch()` (main thread) keep their shapes
and read their numbers from it; `patchDefaults.test.ts` pins the two fills of
an empty patch — and of four partials — equal leaf for leaf with
`patchLeafDifferences`.

Shape: one flat object per level (`PATCH_DEFAULTS`, `OPERATOR_DEFAULTS`,
`ENVELOPE_DEFAULTS`, `LFO_DEFAULTS`, `FILTER_DEFAULTS`), the pitch and filter
envelopes as `ENVELOPE_DEFAULTS` with their overrides spread in, and the one
per-operator rule carried as its input — `LEAD_OPERATOR_LEVEL` for operator A,
`OPERATOR_DEFAULTS.level` for the rest — not as four operator rows. Likewise
`lfo.toOp` is one depth (`LFO_TO_OP_DEFAULT`) times `OPERATOR_COUNT`.

**The two copies had drifted, and the worklet's side moves to `makePatch()`'s
values.** Before this change an empty partial filled `pitchEnv.sustainLevel`
0.7 (makePatch: 0), `pitchEnv.decayTime` 0.4 (0.1) and
`filter.env.sustainLevel` 0.7 (0) in the worklet. The table carries
`makePatch()`'s values.

## Why

- `makePatch()`'s values are the ones every patch that plays already has:
  the wire type of a `patch` message and of the processor's options is the
  complete `Patch`, the library loader completes every file against the
  `makePatch()` template, and the console's knobs read `makePatch()`. The
  worklet's own envelope fallbacks were reachable only by a hand-built
  partial in a test. So aligning them changes no render of a real patch —
  `fmProcessorGolden.test.ts` passes unrefreshed, and every `synth/` test
  passes — while keeping both values would have made the pin test pin a
  known difference instead of equality.
- Operator-count arrays and the clamp bounds are in the table so
  `patchNormalise.ts` holds no number of its own (the ticket's criterion);
  `OPERATOR_COUNT` moved rather than being copied (one definition).

## Punted / alternatives

- Keeping the worklet's 0.7 / 0.4 as a second pitch/filter envelope row:
  rejected — it is the drift the ticket exists to remove, and no shipped
  patch reads it.
- Four explicit operator rows: rejected — they would restate eleven identical
  fields three times to carry one differing level.
- Array fields (`ops`, `lfo.toOp`, `userPartials`) still differ in *merge*
  shape: `makePatch()` takes a supplied array wholesale, the worklet fills
  per index. That is not a default and is left as is.
