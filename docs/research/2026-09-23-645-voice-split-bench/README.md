# #645 — the Voice split, render-time comparison

**Dev-machine indication only. This is not a target reading** (CLAUDE.md
invariant 3). Node renders through the worklet harness, not an
`AudioWorkletGlobalScope` in Chrome; relative cost on one machine, nothing
about audio-thread headroom on the Ryzen 5 5600G / Vega 7 box.

## Machine and method

| | |
|---|---|
| Machine | Apple M1 (laptop), macOS 26.5.1 |
| Runtime | Node v24.20.0 via `npx tsx`, V8 JIT, one process per line |
| Bench | `docs/research/2026-09-15-548-fm-voice-loop-specialisation/bench.mts`, unchanged: 12 held voices, 10 s, median of 9 |
| Before | `main` at `99c79472` (after #644), from the main checkout |
| After | `tech-debt/645-split-the-fm-voice-class-fixed-index`, from its worktree |

```bash
npx tsx docs/research/2026-09-15-548-fm-voice-loop-specialisation/bench.mts <root> <label>
```

## Results

| Part | Before | After | Change |
|---|---|---|---|
| `pad-drift` (alg 4, 4 ops) | 53.1 ms | 53.5 ms | +0.8 % |
| `horde-horn` (alg 1, 3 ops) | 66.2 ms | 65.5 ms | −1.1 % |
| `pickup-blip` sus 0.7 (alg 0, 2 ops) | 31.4 ms | 31.2 ms | −0.6 % |
| `hat` sus 0.7 (alg 7, 3 ops) | 32.0 ms | 32.2 ms | +0.6 % |
| **Scenario total** | **182.7 ms** [188,187,194,189,181,182,182,183,182] | **182.1 ms** [188,188,193,189,182,182,182,182,182] | **−0.3 %** |

Within noise; the ticket's line was a regression over ~5 %. The split adds
one call per render chunk (`Voice.render` → `renderVoiceKernel(voice, …)`) and
one per control block; the kernel's locals, its store-back and the generic
loop's body are unchanged, and V8 inlines the delegate.

The per-part numbers are lower than #548's table (`pad-drift` 32.6 ms there)
because that table was read on a different machine (Apple M4 Pro); only the
before/after pair here is comparable.
