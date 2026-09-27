# #548: the FM voice loop, generic versus the fixed-index kernel

**Dev-machine indication only. This is not a target reading** (CLAUDE.md
invariant 3). These are Node renders through the worklet harness, not an
`AudioWorkletGlobalScope` in Chrome. They show relative cost on one machine
and say nothing about audio-thread headroom on the Ryzen 5 5600G / Vega 7
box. That reading is requested below.

## Machine and method

| | |
|---|---|
| Machine | Apple M4 Pro (dev machine), macOS 26 |
| Runtime | Node v24.16.0 via `npx tsx`, V8 JIT, one process per line |
| Before | main at `31413ecf` (after #547: dormant voices and plate sleep), from the main checkout |
| After | this branch, `tech-debt/548-…` |
| Harness | `packages/client/src/audio/__fixtures__/workletHarness.ts`, 48 kHz, 128-frame quanta, no sample collection |
| Statistic | median of 9 scenario renders, each part in a fresh processor, after one warm-up render of every part. Two alternating before/after passes; the medians agreed within 1.5 % |

```bash
npx tsx docs/research/2026-09-15-548-fm-voice-loop-specialisation/bench.mts <root> <label>
SPECIALISE=0 npx tsx docs/research/2026-09-15-548-fm-voice-loop-specialisation/bench.mts <root> <label>
```

## Scenario

There are 12 held voices: four parts with three notes each (MIDI 48, 55, 60,
velocity 0.9), and no note-off in 10 s. Every part sets `spread` to 0, so one
note is one voice. Every carrier sustains above 0, so #547's dormancy never
engages. That way the loop runs for the whole render, and a skipped voice
neither flatters nor hides the loop's cost.

| Part | Algorithm | Operators sounding | Source |
|---|---|---|---|
| `pad-drift` | 4, two 2-op stacks | all four | factory |
| `horde-horn` | 1, (D,C)>B>A | three (D at level 0) | factory |
| `pickup-blip`, sustain 0.7 | 0, the full series | two (C and D at level 0) | factory, sustain raised |
| `hat`, sustain 0.7 | 7, additive | three (D at level 0); A is noise, B and C are raw squares | factory, sustain raised |

## Results

| Part | Before | After | Change |
|---|---|---|---|
| `pad-drift` (4 ops) | 58.3–58.7 ms | 32.6–33.0 ms | −44 % |
| `horde-horn` (3 ops) | 67.5–67.7 ms | 37.1–37.6 ms | −45 % |
| `pickup-blip` (2 ops) | 59.7–60.2 ms | 20.6 ms | −66 % |
| `hat` (additive, 3 ops) | 46.2–46.8 ms | 21.4–21.5 ms | −54 % |
| **Scenario total** | **231.9 / 234.9 ms** | **111.5 / 112.0 ms** | **−52 %** |

The go threshold was 20 %.

Two more readings, both dev-machine and indicative:

- **This branch with `specialise: false`**, which renders every voice through
  the generic loop with the `Math.pow` calls inline, read 239.9 ms. That is
  within noise of main, so the switch really is main's path.
- **An upper-bound probe during prototyping** hand-unrolled algorithm 0 alone.
  It read 16.9 ms on the two-operator part and 34.0 ms on a four-operator
  algorithm-0 preset (`score-dry-ticker`), against 60 and 64 ms before. The
  shipped kernel, with routing flags shared by every algorithm, read 13.4 ms
  and 30.8 ms on the same two parts. The flags cost nothing measurable.

## Where the saving comes from

The kernel is `render`'s arithmetic in `render`'s order, with three changes:

- The four operators are written out, and their state is held in locals.
- The routing and the carriers are booleans fixed for the call.
- An operator whose amplitude is exactly 0 for the call is not computed.

The largest share is the locals and the fixed indices. The four-operator
part, which skips nothing, still drops 44 %. The idle-operator skip adds the
rest on the two- and three-operator parts. The `Math.pow` precompute runs at
control rate and is too small to separate at this resolution.

Output is bit-identical: `fmProcessorKernel.test.ts` compares Float32 bytes
against `specialise: false` for all 114 factory presets and the routing edge
cases. The decision record is
`docs/log/2026-09-15-fm-voice-kernel-fixed-index-bit-identical.md`.

## What is still owed: the target reading

Owed from `target-box-A204` through the orchestrator, after merge. Re-take the
#445 audio arm on the merged commit:

```bash
node scripts/run-bench.mjs --backend=webgl2 --route=rampart-v1 --build=5000 \
  --horde=400 --audio=bed-01 --base=http://localhost:5173 \
  --expect-commit=<merge sha> --out=<new research folder>/bench-out
```

Compare `loadPct` p50 and p95 in the audio windows against the #445 WebGL2
re-take `20260914T151727Z` (audio-1 7.3 / 8.5 %, audio-2 7.1 / 8.8 %). Note
that the #547 merge also sits between those two commits. Record
`underrunEvents` as well; it should stay 0. `bed-01` is the game soundtrack
and holds few voices, so the saving on the box may be far smaller than this
held-chord scenario shows.
