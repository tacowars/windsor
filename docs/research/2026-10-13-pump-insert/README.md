# What the Pump insert costs (windsor#803)

Pump is a drawn gain shape that the onsets of a key signal restart (record
`docs/log/2026-10-13-pump-insert.md`). This note measures what the shipped
bundle, `packages/engine/src/worklet/generated/pump-processor.js`, costs in
Chrome, on the Tape cost study's pattern
(`docs/research/2026-09-30-tape-browser-cost/`): instances on a fresh
`OfflineAudioContext`, the render's wall time over the program's length,
against the 48 kHz quantum.

**One Pump costs 0.030 ms a quantum, 1.1 % of the 2.667 ms budget at
48 kHz. Four cost 0.114 ms (4.3 %), and sixteen 0.452 ms (17 %).** The cost
grows linearly with the instance count. Editing the shape every 16 quanta
cost nothing measurable, and an open card's scope added 2 to 2.5 %.

## Setup

- **Machine:** Apple M1 (4 performance and 4 efficiency cores, 16 GB),
  macOS 26.7.1 (Darwin 25.6.0), Node 24.21.0. Never quiet: other sessions
  shared it, and the one-minute load average was 2.30 before the run and
  2.43 after.
- **Browser:** Google Chrome 155.0.8059.40, arm64, headless
  (`HeadlessChrome/155.0.0.0`), launched by `bench.mjs` with a temporary
  profile, no extensions and muted output. Pages are served from
  `127.0.0.1`.
- **Backend:** `OfflineAudioContext`, 48 kHz, stereo, 128-frame quanta. The
  bloom study found that the offline render thread ran the same JavaScript
  2 to 4 times slower than the real-time thread on this machine
  (`docs/research/2026-10-11-bloom-insert/README.md`), so these figures are
  on the high side of what the real-time thread spends.
- **Budget:** one quantum, **2.667 ms at 48 kHz**. A share is ms per quantum
  over that.

## Method

`bench.mjs` bundles `page.ts` with esbuild, serves it and the generated
worklet bundles, launches Chrome, collects each repeat the page posts, and
writes [`measurement.json`](measurement.json). Run it from the repository
root on Node 24:

```bash
node docs/research/2026-10-13-pump-insert/bench.mjs
```

The page builds a 20-second program, 960,000 frames:

- **Input:** a stereo pad, three sines (A3, C♯4, E4) at 0.08 each, the right
  channel detuned 0.2 %, peaking at 0.24 (about −12 dBFS).
- **Key:** a kick on every beat at 120 BPM, a 0.12 s decaying sine falling
  from 150 Hz to 50 Hz, peak 0.9.

Each Pump node is built as the insert builds it (`pumpInsert.ts`): the
program on input 0, the key on input 1, `external` at 1, and the params
`pumpParameters(DEFAULT_PUMP, 120)` writes: the default shape, a synced 1/4
cycle (500 ms at 120 BPM), Depth 1, Sens 0.6, Hold 80 ms and Smooth 1.5 ms.
Each node renders the whole program to the destination. The harness cell
sends the program straight to the destination with no Pump.

The modes, each at 1, 4 and 16 instances:

- **steady:** the defaults throughout.
- **edits:** every 16 quanta, the second point's level flips between 0.05
  and 0.4 on every instance, so the worklet rebuilds its segments about 470
  times over the render, the work a drawing hand causes.
- **scope:** each node is sent `{ type: 'scope', enabled: true }`, as the
  card does while it is on screen, so the worklet keeps the key trace and
  posts it with the phase.

For each cell, five repeats on a fresh context each. The worklet module is
loaded and the graph is built before timing. `performance.now()` brackets
`startRendering()` alone. **Duty = render ms / 20,000 ms**, and **ms per
quantum = duty × 2.667**. The figure is the median of the five. It is an
exact mean over the render and cannot see a single quantum's peak. Each
repeat includes a fresh worklet scope's JIT warm-up, spread over 7,500
quanta.

As a check that the measured path is the active one, the page reports the
left channel's RMS for each instance. The pad's is 0.0980 with no Pump and
0.0834 through one (−1.4 dB, the default shape's duck on every beat), and
0.0854 under the edits, whose shallower second point ducks less.

## Result

Render ms, median (min to max) of five repeats; ms per quantum and share
from the median.

| Mode | Instances | Render ms | ms / quantum | Share of 48 kHz quantum |
|---|---:|---:|---:|---:|
| harness | 0 | 6 (6–8) | 0.0008 | 0.03 % |
| steady | 1 | 222 (220–251) | 0.0295 | 1.1 % |
| steady | 4 | 853 (851–856) | 0.114 | 4.3 % |
| steady | 16 | 3,390 (3,367–3,441) | 0.452 | 17.0 % |
| edits | 1 | 221 (220–222) | 0.0295 | 1.1 % |
| edits | 4 | 855 (851–867) | 0.114 | 4.3 % |
| edits | 16 | 3,390 (3,381–3,405) | 0.452 | 17.0 % |
| scope | 1 | 221 (220–222) | 0.0294 | 1.1 % |
| scope | 4 | 873 (869–880) | 0.116 | 4.4 % |
| scope | 16 | 3,473 (3,469–3,540) | 0.463 | 17.4 % |

- **Linear in the count.** Four instances cost 3.9 times one, and sixteen
  15.3 times one. Each instance's work is its own: the two followers, the
  shape and the slew run a sample at a time on every instance.
- **Edits are free at this rate.** A segment rebuild is at most 16 points of
  arithmetic, and it runs at most once a quantum, so a shape being drawn
  costs what a still one does.
- **The scope is cheap.** While the card is on screen, the trace and the
  phase reports add 2 to 2.5 % to the instances' cost. Only the instance
  whose card is open pays it.
- **Pump does not sleep.** Its render is a per-sample gain on the input, and
  the detector must hear the key every sample for a trigger to land within
  1 ms, so it could rest only when the input and the key are both silent.
  At 0.030 ms an instance there is little to save. The inserts that sleep
  on silence (windsor#793) are the ones whose tails cost more.

The raw repeats, the plan and the machine are in
[`measurement.json`](measurement.json).
