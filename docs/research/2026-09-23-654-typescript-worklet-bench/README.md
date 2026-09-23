# #654 — the TypeScript conversion, render-time comparison

**Dev-machine indication only. This is not a target reading** (CLAUDE.md
invariant 3). Node renders through the worklet harness, not an
`AudioWorkletGlobalScope` in Chrome; relative cost on one machine.

## Machine and method

| | |
|---|---|
| Machine | Apple M1 (laptop), macOS 26.5.1 |
| Runtime | Node v24.20.0 via `npx tsx`, V8 JIT, one process per line |
| Bench | `docs/research/2026-09-15-548-fm-voice-loop-specialisation/bench.mts`, unchanged: 12 held voices, 10 s, median of 9 |
| Before | `main` at `99c79472` (after #644), read for #645 |
| After, first build | the branch with the folder's default class-field emit (define semantics) |
| After, shipped | the branch with `useDefineForClassFields: false` in `fm/tsconfig.json` |

## Results

| Part | Before | After, define semantics | After, shipped |
|---|---|---|---|
| `pad-drift` (alg 4, 4 ops) | 53.1 ms | — | 54.1 ms |
| `horde-horn` (alg 1, 3 ops) | 66.2 ms | — | 67.3 ms |
| `pickup-blip` sus 0.7 (alg 0, 2 ops) | 31.4 ms | 34.2 ms | 32.5 ms |
| `hat` sus 0.7 (alg 7, 3 ops) | 32.0 ms | 58.0 ms | 32.6 ms |
| **Scenario total** | **182.7 ms** [188,187,194,189,181,182,182,183,182] | **336.1 ms** [343,343,346,343,335,335,336,333,330] | **187.3 ms** [187,189,198,198,183,183,183,189,184] |

The first build's bundle carried every declared class field as `x;`, which
defines it as `undefined` before the constructor writes a number; V8 then
represents the field as tagged and boxes every later double write, which is
both the +84 % and an allocation per write on the audio thread. With
`useDefineForClassFields` off the declared fields emit nothing, the bundle
differs from the JS build only by the banner, a dropped dead argument and a
local alias, and the scenario reads +2.5 %, inside the run-to-run spread
(the before medians ranged 181–194). The ticket's line was 5 %.
