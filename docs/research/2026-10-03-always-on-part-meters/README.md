# What always-on part meters cost

Windsor [#533](https://github.com/tacowars/windsor/issues/533), part of epic
[#519](https://github.com/tacowars/windsor/issues/519). tacowars wants the
Song mixer's two lights per part, the green activity light and the red clip
latch (windsor#159, `songMixerLights.ts`), on the part strip's chips on every
tab. Those lights read one peak meter per part (`createPeakMeter`,
`packages/engine/src/mixer/peakMeter.ts`): one `AudioWorkletNode` per part,
which hidden views release on purpose (#666). Lighting the chips on every tab
keeps up to 16 of them running whenever audio is on. This measures what that
costs, so tacowars can choose between real meters on the chips and the
note-driven dots of windsor#528.

Research only: nothing under `packages/` or `scripts/` changed. The research
multi-input meter lives in this folder only.

## In short

At 16 parts, on this machine, in real time:

- **16 separate shipped meters** add **154 µs** a quantum to the audio thread
  on average (52–238 µs across 9 runs), **5.5 %** of the 128-frame budget
  (2.0–8.2 %), and post **457 reports a second** to the main thread, which
  spends **5–10 ms a second** more on them.
- **One meter node with 16 inputs** (the research prototype here) adds
  **92 µs** (31–139 µs), **3.3 %** of the budget (1.1–4.8 %), and posts
  **28.5 reports a second**; the main thread spends **0.6–2.7 ms a second**
  more. In every run it cost 0.54–0.67 of the 16 separate nodes on the audio
  thread.
- **Note-driven dots** cost the audio thread nothing, but cannot show the red
  clip latch: clipping is a property of the samples, not of the notes.

The recommendation, with its numbers, is at the end: **one multi-input
node**.

## Environment

- Apple M1 (4 performance and 4 efficiency cores, 16 GB), macOS 26.7.1
  (build 25G241), arm64, Node v24.21.0.
- Google Chrome 154.0.8037.93, headless (`HeadlessChrome/154.0.0.0`),
  started by [`cdp.mjs`](cdp.mjs) with a throwaway profile, `--mute-audio`,
  `--autoplay-policy=no-user-gesture-required` and background throttling off
  (#343's switches), driven over the DevTools protocol.
- Backend: Web Audio, a real-time `AudioContext({ latencyHint: 'interactive' })`
  as the app makes it, on whatever output device headless Chrome opened, which
  was not verified. Its rate is the device's, and **it changed during the
  runs**: 20 of the 36 audio pages ran at **44.1 kHz** (quantum budget
  2 902 µs, `baseLatency` 5.80 ms) and 16 at **48 kHz** (2 667 µs, 5.33 ms).
  Chrome's device callback asked for **256 frames** (two quanta) throughout
  (`AudioDestination::RequestRender`, `frames_requested`). Every share of the
  budget below uses its own page's rate.
- Offline cross-check: `OfflineAudioContext`, stereo, 48 kHz.
- Code: the bench at `2755a38` on `origin/main` `64761dd`; the shipped meter is
  the generated `peak-meter-processor.js`, served byte for byte
  (sha256 `a5c48829…1666`).
- **The machine was not quiet.** Other sessions ran throughout; the one-minute
  load average read 1.37–8.03 across the passes. See "The spread" below.

## Method

### What is timed

Chrome emits a `RealtimeAudioDestinationHandler::Render` trace event
(category `webaudio`) around each 128-frame render of the whole graph, every
node's `process` inside it, on the `Realtime AudioWorklet thread`. Its `dur`
is the quantum's wall time on the audio thread and its `tdur` the thread's
CPU time. That is the **audio-thread time per quantum** in every table: the
whole graph, so it includes Chrome's own per-node work (input marshalling,
the call into the processor, the silent sink), not only the processor's
JavaScript.

The audio pass enables only `webaudio`, `disabled-by-default-v8.gc` and
`blink.user_timing`. The `v8` and `devtools.timeline` categories mark every
`process` call with an event of their own; that would charge the tracer's
cost once per node, so it would grow with N and bias the comparison against
16 separate nodes. The AudioWorklet global scope has no `performance.now()`
in this Chrome (#250 found the same), so the earlier rigs' in-processor
`Date.now()` counters (1 ms resolution) could not resolve a meter.

Collections run as their own tasks between renders
([`2026-09-30-worklet-gc-in-chrome`](../2026-09-30-worklet-gc-in-chrome/README.md)),
so the audio thread's GC is counted apart from the render time, from the
top-level `V8.GC_*` events on that thread.

### Cases and variants

- **Song**: #343's 16-part song,
  [`sixteen-pads-light.json`](../2026-10-01-automation-param-cost/sixteen-pads-light.json)
  (16 `pad-drift` parts at `spread` 0, which plays in real time here), looped,
  normalised by `makeArrangement` and played as the app's host plays it:
  `FmEngine`, `AudioSystem`, `initMusic`, `unlock`, `startMusic` and the 25 ms
  pump. Each part's meter taps `strip.rotation.output`, where the shipped
  strip meter sits.
- **Isolated**: 16 looping stereo `AudioBufferSourceNode`s playing #211's
  deterministic program
  ([`program.ts`](../2026-09-30-tape-browser-cost/program.ts)) at the
  context's rate, summed through one gain into the destination; each meter
  taps one source.
- **Separate**: the shipped meter, one node per metered part, through the
  shipped `createPeakMeter` (`setActive(true)`); in the song case, the strips'
  own `PartStrip.meter`, as the Song mixer lights them.
- **Multi**: [`multiMeterProcessor.mjs`](multiMeterProcessor.mjs) and
  [`multiMeter.mjs`](multiMeter.mjs), one node with 16 inputs and one silent
  sink. Each input runs the shipped per-sample loop on its own slice of
  state; the node posts one `Float32Array` of all 16 reports at the shipped
  30 Hz. An input with nothing connected and nothing held is skipped.

All 16 parts or sources play at every N; only the meters change.

### Passes

[`bench.mjs`](bench.mjs) bundles [`page.mjs`](page.mjs) with esbuild, serves it
beside the engine's generated worklet bundles, and runs the passes in
[`passes.mjs`](passes.mjs). Each pass is a fresh page with a fresh
`AudioContext`, so a fresh worklet isolate.

- **Audio**: one page per case and variant. After a 3 s warm-up the trace
  runs while the page steps the meter count through three blocks,
  `0 1 8 16`, `8 16 0 1`, `1 0 16 8` (rotated by the round), 2 s a step. A
  `performance.mark` at each switch delimits the segments; the first 0.25 s
  of each (nodes being built and torn down) is left out. So every N is
  compared with N = 0 on the same context, thread and song, about 4 s
  away. One page is one **run**; a run's value for N pools its three
  segments, and its **delta** is that minus the same page's N = 0.
- **Main thread**: one page per case at N = 0, and per case and variant at
  N = 16, traced for 8 s after a 3 s warm-up with `toplevel` and
  `devtools.timeline`. A port's handler shows as a `FunctionCall` named
  `node.port.onmessage` (a MessagePort raises no `EventDispatch`); its task,
  which also deserialises the message, is the top-level task holding it.
  The delta is against the same round's N = 0 page.
- **Offline**: #211's method on the isolated graph, the render of 20 s at
  48 kHz timed from the page, every variant and N, three times a round.
- **Reports a second**: counted on the main thread by the meters' own
  `revision`, per segment.

One invocation runs three rounds. It ran three times, so every audio
configuration has **9 runs** and every offline cell 27 renders.

### Rerun

From the repo root, on Node 24, with the installed Google Chrome:

```bash
node docs/research/2026-10-03-always-on-part-meters/bench.mjs   # about 10.5 min; writes results/<time>.json
node docs/research/2026-10-03-always-on-part-meters/report.mjs  # the tables below, from every results file
```

`--rounds <n>` changes the round count; `--quick` is a one-minute harness
check whose file `report.mjs` leaves out. [`analyse.mjs`](analyse.mjs) reduces
a trace; [`benchConstants.mjs`](benchConstants.mjs) holds every value above.
The raw results are in [`results/`](results/).

## Results

Each cell is the mean over the runs, then the runs' minimum and maximum.

### Audio thread, song

Per-quantum wall time of the whole render. 9 runs per variant.

| Variant | N | Mean, µs | p95, µs | Mean, % of budget | Δ mean vs N = 0, µs | Δ, % of budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| separate | 0 | 1169.4 (820.2–1382.2) | 1445 (1058–1628) | 41.81 (28.26–49.23) | — | — |
| separate | 1 | 1174.6 (853.3–1393.7) | 1440 (1185–1610) | 42.02 (29.40–48.02) | 5.2 (-48.2–112.4) | 0.21 (-1.81–4.22) |
| separate | 8 | 1167.5 (873.4–1401.0) | 1441 (1141–1643) | 41.77 (30.09–48.27) | -1.9 (-84.7–83.7) | -0.04 (-2.92–3.14) |
| separate | 16 | 1205.7 (905.4–1395.7) | 1464 (1123–1663) | 43.15 (31.19–49.59) | 36.3 (-32.0–133.0) | 1.33 (-1.10–4.99) |
| multi | 0 | 1175.8 (826.7–1410.2) | 1463 (1028–1730) | 42.10 (28.48–49.11) | — | — |
| multi | 1 | 1160.9 (823.8–1382.5) | 1431 (1103–1603) | 41.54 (28.85–47.96) | -15.0 (-73.4–42.1) | -0.56 (-2.75–1.45) |
| multi | 8 | 1180.7 (863.8–1382.4) | 1436 (1100–1689) | 42.27 (29.76–48.64) | 4.8 (-27.8–41.0) | 0.17 (-0.96–1.54) |
| multi | 16 | 1194.7 (869.0–1373.8) | 1458 (1098–1636) | 42.78 (29.94–48.86) | 18.9 (-44.0–74.4) | 0.68 (-1.52–2.69) |

The song's own render, 820–1 410 µs a quantum, moves by ±50 µs between the
segments of one page. That is larger than the meters at 1 and 8 parts, so
those deltas are noise around zero. At 16 parts the separate nodes read
+36 µs on average and the multi node +19 µs, both inside the noise of
single runs. The song case bounds the cost; it does not resolve the two
variants. The isolated case does.

### Audio thread, isolated

The same, with 16 cheap sources (about 20 µs a quantum at N = 0), so the
meters are most of what changes. 9 runs per variant.

| Variant | N | Mean, µs | p95, µs | Mean, % of budget | Δ mean vs N = 0, µs | Δ, % of budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| separate | 0 | 19.2 (5.4–30.8) | 46 (11–72) | 0.69 (0.20–1.06) | — | — |
| separate | 1 | 36.6 (12.9–59.6) | 87 (35–127) | 1.31 (0.48–2.05) | 17.4 (6.6–29.2) | 0.62 (0.23–1.03) |
| separate | 8 | 100.1 (34.5–158.8) | 188 (66–269) | 3.58 (1.28–5.47) | 80.9 (29.1–128.4) | 2.89 (1.04–4.42) |
| separate | 16 | 172.9 (57.8–268.4) | 304 (91–445) | 6.18 (2.17–9.25) | 153.7 (52.4–238.0) | 5.50 (1.96–8.20) |
| multi | 0 | 20.5 (6.9–30.9) | 45 (17–64) | 0.73 (0.24–1.06) | — | — |
| multi | 1 | 42.9 (16.3–65.9) | 96 (43–134) | 1.54 (0.58–2.27) | 22.4 (5.6–35.0) | 0.80 (0.19–1.21) |
| multi | 8 | 75.7 (24.8–116.4) | 139 (42–195) | 2.70 (0.93–4.01) | 55.1 (17.9–85.5) | 1.97 (0.67–2.95) |
| multi | 16 | 112.6 (38.0–170.0) | 190 (61–276) | 4.02 (1.39–5.86) | 92.0 (31.1–139.1) | 3.29 (1.14–4.79) |

- **Separate** costs about 9.6 µs a quantum per meter (3.3–14.9 µs), close
  to linear in N.
- **Multi** costs more than one separate node at N = 1 (+22 µs against
  +17 µs: it walks 16 inputs), the same at about 2 parts, and less from
  there: **0.60 of the separate nodes at 16** (0.54–0.67 in the nine
  same-round pairs). The saving is Chrome's per-node work, not the loop,
  which is the same in both.

### The spread

Within one page the segments agree closely (isolated, separate, 16 meters:
262, 266 and 277 µs in one run). Between pages and invocations the audio
thread's speed changed about threefold. In the first invocation (load 2.6–6.3)
16 separate meters cost 52–76 µs and the song's N = 0 was 820–1 100 µs; in
the next two (load 1.4–5.5) they cost 145–238 µs and the song's N = 0 was
1 107–1 410 µs. The thread's CPU time matches its wall time to within 2 µs in
every cell, so the thread was not waiting: it ran slower. This rig cannot see
which core or clock Chrome's audio thread ran on, so the cause is not
established. The ratio of the two variants held through both states
(0.54–0.67), and the offline renders, on Chrome's offline thread, stayed
steadier (16 separate meters: 45–63 µs in all 27 renders).

### Audio thread: CPU time, GC and clock

CPU time is the render event's `tdur`. "Renders holding a GC" counts
collections that started inside a render, summed over the 9 runs.

| Case | Variant | N | CPU mean, µs | Scavenges / s | GC, ms / s | Longest pause, µs | Renders holding a GC | Quanta / s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| song | separate | 0 | 1170.8 (820.2–1384.2) | 0.3 (0.0–1.0) | 0.04 (0.00–0.11) | 214 | 9 | 344.3–375.3 |
| song | separate | 1 | 1175.8 (853.8–1395.4) | 0.6 (0.0–1.3) | 0.10 (0.00–0.21) | 333 | 16 | 344.5–375.4 |
| song | separate | 8 | 1168.7 (873.1–1402.4) | 2.6 (1.1–4.4) | 0.31 (0.22–0.42) | 308 | 10 | 344.2–375.6 |
| song | separate | 16 | 1207.3 (907.1–1397.6) | 5.7 (2.5–12.0) | 0.55 (0.41–0.92) | 310 | 30 | 344.4–375.1 |
| song | multi | 0 | 1177.5 (827.9–1412.9) | 0.6 (0.0–1.3) | 0.08 (0.00–0.19) | 312 | 19 | 344.5–375.3 |
| song | multi | 1 | 1162.2 (824.4–1383.9) | 0.6 (0.0–1.3) | 0.08 (0.00–0.16) | 278 | 14 | 344.4–375.3 |
| song | multi | 8 | 1182.3 (865.6–1384.1) | 2.6 (1.1–4.8) | 0.35 (0.17–0.47) | 370 | 6 | 344.0–375.2 |
| song | multi | 16 | 1196.0 (869.5–1375.9) | 5.1 (2.9–9.1) | 0.52 (0.33–0.81) | 287 | 8 | 344.3–375.0 |
| isolated | separate | 0 | 18.8 (4.9–30.4) | 0.0 (0.0–0.0) | 0.00 (0.00–0.00) | 0 | 0 | 344.2–375.2 |
| isolated | separate | 1 | 36.4 (12.4–59.4) | 1.4 (1.1–1.7) | 0.33 (0.12–0.53) | 601 | 0 | 344.0–375.2 |
| isolated | separate | 8 | 100.0 (34.4–159.1) | 9.9 (9.5–10.5) | 1.27 (0.50–1.76) | 335 | 0 | 344.1–375.3 |
| isolated | separate | 16 | 172.8 (57.4–268.2) | 19.9 (18.8–20.9) | 2.54 (0.94–3.62) | 296 | 0 | 344.4–375.3 |
| isolated | multi | 0 | 20.1 (6.4–30.5) | 0.0 (0.0–0.0) | 0.00 (0.00–0.00) | 0 | 0 | 344.1–375.3 |
| isolated | multi | 1 | 42.6 (15.8–65.6) | 1.3 (1.1–1.5) | 0.34 (0.12–0.52) | 613 | 0 | 344.4–375.2 |
| isolated | multi | 8 | 75.4 (24.4–116.3) | 9.9 (9.3–10.6) | 1.29 (0.50–1.86) | 348 | 0 | 344.4–375.6 |
| isolated | multi | 16 | 112.5 (37.6–170.7) | 19.9 (19.0–20.9) | 2.49 (0.93–3.52) | 322 | 0 | 344.3–375.5 |

- **Collections grow with the parts tapped, by the same amount in both
  variants**: about 1.25 scavenges a second per tapped part (19.9 a second at
  16 in either), though the multi node posts 16 times fewer messages. So the
  posts are not what allocates. This rig does not say what does; the input
  side of Chrome's per-input marshalling is a candidate, untested. At 16
  parts the collections take up to 2.5 ms a second (0.25 % of the thread),
  with pauses up to 0.6 ms, mostly between renders.
- **Real time held.** The renders ran at 344–345 quanta a second at 44.1 kHz
  and 375 at 48 kHz, and the audio clock advanced at 0.996–1.003 of wall
  time in every segment but two (0.964 in one song segment, multi at 8, and
  0.923 in one isolated main-thread page at N = 0).

### Reports reaching the main thread

| Case | Variant | N | Reports / s |
| --- | --- | ---: | ---: |
| song | separate | 1 | 28.5 (28.5–29.0) |
| song | separate | 8 | 229.3 (227.6–231.9) |
| song | separate | 16 | 457.2 (455.4–459.7) |
| song | multi | 1, 8, 16 | 28.4–28.5 (27.5–28.5) |
| isolated | separate | 16 | 457.8 (455.0–459.7) |
| isolated | multi | 16 | 28.5 (28.4–28.5) |

A meter reports once its frame count reaches the rate / 30, which 128-frame
quanta reach every 12 quanta at 44.1 kHz and every 13 at 48 kHz: 28.7 and
28.8 a second.

### Main thread at 16 parts

9 runs per row. The song's N = 0 page already handles 46.5 port messages a
second: its processors' own load reports.

| Case | Variant | N | Handler calls / s | Handler, ms / s | Handler tasks, ms / s | Busy, ms / s | Δ busy vs N = 0, ms / s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| song | none | 0 | 46.5 (45.3–46.8) | 0.25 (0.20–0.34) | 1.74 (1.54–2.15) | 3.97 (3.63–4.88) | — |
| song | separate | 16 | 506.2 (504.2–508.6) | 2.66 (2.34–3.63) | 7.10 (5.91–9.83) | 9.24 (7.91–12.43) | 5.27 (4.29–7.85) |
| song | multi | 16 | 75.4 (74.5–75.7) | 0.78 (0.63–1.10) | 2.52 (1.88–3.97) | 4.55 (3.60–6.72) | 0.58 (-0.07–1.84) |
| isolated | none | 0 | 0.0 (0.0–0.0) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.08 (0.03–0.13) | — |
| isolated | separate | 16 | 460.6 (459.5–462.3) | 4.24 (1.36–6.26) | 10.17 (3.15–15.04) | 10.56 (3.29–15.82) | 10.48 (3.25–15.71) |
| isolated | multi | 16 | 28.8 (28.7–29.0) | 1.23 (0.55–1.46) | 2.65 (1.11–3.16) | 2.75 (1.15–3.32) | 2.67 (1.11–3.23) |

- **Separate**: about 9 µs a handler call and 22 µs a task (isolated), so
  5–10 ms of main-thread time a second at 16 parts, 0.5–1 % of the thread.
- **Multi**: one message a 30th of a second, but a dearer one: about 43 µs a
  call and 92 µs a task, since `data` deserialises a fresh `Float32Array`
  (an ArrayBuffer) where the shipped report is a small object. Still 0.6–2.7
  ms a second, a quarter or less of the separate nodes. Posting a plain
  array instead might be cheaper; that was not measured.
- Neither figure includes drawing the lights, which every option pays.

### Offline cross-check (isolated, 48 kHz)

#211's method, comparable with the earlier Tape numbers. 27 renders per row,
each delta paired with the N = 0 render of the same repeat.

| Variant | N | ms / quantum | Δ vs N = 0, µs / quantum |
| --- | ---: | ---: | ---: |
| none | 0 | 0.0033 (0.0030–0.0045) | — |
| separate | 1 | 0.0068 (0.0062–0.0101) | 3.5 (2.9–5.5) |
| separate | 8 | 0.0283 (0.0258–0.0390) | 25.0 (22.7–35.1) |
| separate | 16 | 0.0521 (0.0482–0.0679) | 48.8 (45.0–63.4) |
| multi | 1 | 0.0077 (0.0071–0.0101) | 4.4 (3.9–5.6) |
| multi | 8 | 0.0193 (0.0179–0.0250) | 16.0 (14.9–20.5) |
| multi | 16 | 0.0330 (0.0302–0.0456) | 29.8 (27.0–42.5) |

Offline, 16 separate meters cost 48.8 µs a quantum and the multi node 29.8
(0.61 of it), matching the real-time ratio. The offline figures sit at the
low end of the real-time range: in the first invocation real time read
52–76 µs, in the others up to 238 µs.

## Limits

- **One machine, under load**, and an audio thread whose speed changed
  threefold between invocations for a reason this rig cannot see. The
  real-time ranges above are what this M1 did that afternoon; the ratio
  between the variants is the steadier number.
- **The output device's rate changed** between 44.1 and 48 kHz during the
  runs. Each page's budget uses its own rate; a meter's cost per quantum
  does not depend on the rate, its share of the budget does (by 9 %).
- **Headless Chrome**, as in the earlier rigs. The headed browser on the
  default device was not measured.
- **The song case does not resolve the variants**: its own render moves by
  more than the meters cost. It confirms only that 16 meters on a 16-part
  song stay inside the song's own run-to-run noise in most runs.
- **The multi node is a prototype.** It reproduces the shipped loop and
  report rate; it has no tests, no golden, and its message is a typed array.
  Shipping it would be an engine change (a new processor and its bundle).
- **What allocates per tapped input on the audio thread** is not
  established.

## Recommendation

**One multi-input meter node**, always on while audio is on, feeding the
chips on every tab (and able to feed the Song mixer's lights, which today
build their own 16 nodes).

The numbers that decide it, at 16 parts:

| | 16 separate nodes | One multi-input node | Note-driven dots |
|---|---:|---:|---:|
| Audio thread, Δ µs a quantum (real time, mean and range) | 154 (52–238) | 92 (31–139) | 0 |
| Share of the quantum budget | 5.5 % (2.0–8.2 %) | 3.3 % (1.1–4.8 %) | 0 |
| Offline, Δ µs a quantum | 48.8 | 29.8 | 0 |
| Reports to the main thread a second | 457 | 28.5 | none |
| Main thread, Δ ms a second | 5.3–10.5 | 0.6–2.7 | not measured |
| Shows the red clip latch | yes | yes | no |

- Against 16 separate nodes, the multi node does the same job for 0.54–0.67
  of the audio-thread cost in every paired run, with 16 times fewer messages
  and a quarter or less of the main-thread time. The shipped nodes' only
  advantage is that they exist today.
- Against note-driven dots, it costs 1–5 % of the audio budget, permanently,
  on this machine; for reference, the 16-part song's own render takes
  28–49 %. What it buys is the clip latch and activity that follows the
  sound (tails, sends, mutes) rather than the notes.
- If tacowars wants the chips to cost nothing on the audio thread, note-driven
  dots, without the red light, are the choice; 16 separate shipped nodes are
  not the choice on these numbers.

tacowars makes the call.
