# Worklet garbage collection on Chrome's audio thread (windsor#222)

windsor#214 ([`2026-09-30-load-sampler-allocation`](../2026-09-30-load-sampler-allocation/README.md),
"What else allocates") found in Node that eight of the ten worklet renders
allocate every quantum with the load meter off, from 3.6 KB (the FM part) to
104 KB (Advanced Drive), against worklet rule 2. This measures the same in
Chrome, on the real-time audio thread, during playback: whether each processor
allocates there, how often the audio thread collects because of it, how long
each collection pauses it, and whether that costs underruns. Its ranking at the
end orders the per-processor fix tickets.

Research only: nothing under `packages/` or `scripts/` changed.

## Environment

- Apple M1 (4 performance and 4 efficiency cores, 16 GB), macOS 26.5.1.
- Google Chrome 154.0.8037.58, headless (`HeadlessChrome/154.0.0.0`), driven by
  `chrome-devtools-mcp@1.10.1` as `.mcp.json` pins it (`--headless=true
  --isolated=true`), in an isolated browser context of its own.
- `npm run dev` (Vite 8.3.1) on this branch, which is `origin/main` at
  `55ffc15` for everything under `packages/`.
- Backend: Web Audio, a real-time `AudioContext` at **44.1 kHz** (128 frames,
  2 902 µs a quantum), `baseLatency` 5.80 ms, `outputLatency` 32 ms. The
  output device is whatever headless Chrome opened; it was not verified.
- **The machine was not quiet.** Other sessions ran throughout, and none of
  them could be stopped for this. The one-minute load average was 13.64 when
  the work began and read between 4.06 and 16.87 after the scenarios (each
  scenario's reading is in the table below). The bytes per quantum do not
  depend on load; the pause lengths and render spans do, and read long rather
  than short on a busy machine.

## What the trace exposes

The MCP's `performance_start_trace` / `performance_stop_trace` trace, saved
raw with `filePath`, contains the **`Realtime AudioWorklet thread`** with:

- **Its own collections.** `MinorGC` and `MajorGC` events on that thread, with
  their `disabled-by-default-v8.gc` phases (`V8.GCScavenger`,
  `V8.GC_MARK_COMPACTOR` and the rest), each with `usedHeapSizeBefore` and
  `usedHeapSizeAfter`.
- **A heap reading after every render call.** Every `process` call is a
  `FunctionCall` event naming its bundle (`fm-processor.js`,
  `advanced-drive-processor.js`, …), and Chrome emits an `UpdateCounters`
  event with `jsHeapSizeUsed` right after each one. That counter is the
  worklet isolate's heap, not the page's: it reads 2.9 to 13 MB, and the
  readings either side of each `MinorGC` match the collection's own
  `usedHeapSizeBefore` and `usedHeapSizeAfter` to the byte (checked at all
  342 collections of scenario a and the Advanced Drive scenario; the first
  is 3 692 832 → 2 884 956). So the heap growth across one call is what that
  processor allocated in that quantum, attributed per processor and per
  quantum directly. No scenario-difference attribution was needed for bytes.

So the question the issue left open, whether the MCP's trace shows the audio
thread's GC, has a yes. Its limits are under "Limits" below.

## Method

**Songs** ([`scenarios/`](scenarios/), written by [`generate-songs.mjs`](generate-songs.mjs)):
one song per scenario, 32 bars at 120 BPM (64 s, looping), imported as JSON.
The FM part is `pad-drift` (the Node probe's patch), a chord part hitting a
three-note chord once a bar and holding it (gate 1), with the harmony moving
every four bars. Each insert is written as `{ "kind": … }` and so runs at its
kind's defaults, as the Node probe's inserts did.

- **a** `a-fm`: the FM part, no inserts.
- **b** `b-<kind>`: the same part with one insert on the master:
  `advanced-drive`, `compressor`, `delay`, `phaser`, `retro-reverb`, `plate`,
  `tape`, `eq`.
- **c** `c-dense`: eight parts (`pad-drift`, `bass-digital`, `lead-bell`,
  `saw-arp`, `drone-sqr`, `ai-voice`, `horde-horn`, `lead-width-sweep`, chord
  parts at bar, half or quarter steps), each with two or three inserts, 20 in
  all: four Advanced Drive, three each of Compressor, Delay, Phaser and Tape,
  two each of Retro reverb and Plate. Run twice.

Every song also has the standing graph: the output stage and the `room`
return's plate (`reverb-processor.js`, asleep in every scenario since no part
sends to it) and the `echo` return (not a worklet).

**Per scenario**, one page of this worker's own, reloaded for each so every
scenario starts with a fresh worklet isolate:

1. Reload with an init script that wraps `AudioWorkletNode` to keep a list of
   the nodes the app builds (page-side instrumentation; no source changes).
   Accept the "Restore" prompt, import the song on the Settings tab, enable
   audio, press Play.
2. **Warm up 5 s**, then turn the load meter **off** by posting
   `{ type: 'reportLoad', quanta: 0 }` to every node's port.
3. **Trace 20 s** of playback (`reload: false`), and save the raw trace.
4. Turn the meter back **on** (`quanta: 345`, the app's one-second interval)
   and read the CPU button's `underruns` count every 2 s for **20 s, untraced**.
   The meter's underrun rule is a single processor's render taking longer than
   its quantum (`worklet/loadSampler.ts`).

[`analyse-trace.mjs`](analyse-trace.mjs) reduces each raw trace to
[`summaries/<scenario>.json`](summaries/), and [`tables.mjs`](tables.mjs)
prints the tables below from those. The analysis:

- **Bytes per call**: the `jsHeapSizeUsed` step across each `process` call.
  Left out: calls in the trace's first 0.5 s (starting the trace stalls the
  thread and moves the counter), calls containing an interrupt
  (`V8.HandleInterrupts`) or a collection, and the counter's rare blips (a
  step of hundreds of KB that reverses at the next reading with no collection
  between, 0 to 2 a trace).
- **Bytes per quantum**: the mean per call times calls per quantum, so the
  plate insert's figure is not halved by the sleeping return that shares its
  bundle, and the dense song's figures sum a bundle's instances.
- **Render span**: one quantum is the process calls from after one
  output-stage call to the next (the output stage is the graph's last node).
  A collection outside any call is charged to the quantum after it, as its
  duration plus that quantum's span. That assumes the collection delayed the
  quantum; it may instead have run while the thread was idle.

The raw traces (101 to 270 MB each) are not committed.

## Results

### Collections on the audio thread, per scenario

Meter off, 20.2 s traced after a 5 s warm-up.

| Scenario | Minor GC | Major GC | GC / s | Longest pause, µs | GC time, ms/s | Bytes / quantum, all processors | MB per scavenge |
|---|---:|---:|---:|---:|---:|---:|---:|
| a `a-fm` | 25 | 0 | 1.24 | 217 | 0.16 | 2 914 | 0.81 |
| b `b-advanced-drive` | 317 | 0 | 15.70 | 167 | 1.44 | 80 978 | 1.78 |
| b `b-compressor` | 88 | 0 | 4.36 | 164 | 0.39 | 10 590 | 0.84 |
| b `b-delay` | 50 | 0 | 2.48 | 229 | 0.26 | 6 006 | 0.84 |
| b `b-phaser` | 75 | 0 | 3.71 | 184 | 0.33 | 9 096 | 0.84 |
| b `b-retro-reverb` | 77 | 0 | 3.81 | 209 | 0.32 | 9 246 | 0.84 |
| b `b-plate` | 206 | 0 | 10.20 | 210 | 0.76 | 25 970 | 0.88 |
| b `b-tape` | 100 | 0 | 4.95 | 152 | 0.41 | 12 146 | 0.85 |
| b `b-eq` | not measured | | | | | | |
| c `c-dense` | 436 | 0 | 21.58 | 299 | 2.67 | 462 084 | 7.38 |
| c `c-dense`, run 2 | 461 | 0 | 22.82 | 395 | 2.84 | 462 090 | 6.98 |

Every collection was a scavenge (`MinorGC`, type `allocation failure`), and
none fell inside a `process` call: each ran as its own task on the audio
thread, right after the render calls of a quantum and before the next. The
median pause was 68 to 122 µs across the scenarios (122 µs in a, 89 µs
with Advanced Drive, 117 and 119 µs in the dense runs). "MB per scavenge" is
the allocation rate over the collection rate: the young generation grows
with the allocation rate, so the dense song, at 159 MB/s, collects 22 times
a second, not the 196 it would at scenario a's 0.81 MB a scavenge.

**The EQ scenario was skipped.** On `main` the `eq` kind is not in the insert
registry (it is registered by the console card's PR, #220, still open), so the
import drops `{ "kind": "eq" }` from the master, and the master's "Add insert"
menu offers no EQ (Classic Drive, Advanced Drive, Tape, Bus compressor,
Chorus, Ensemble, Phaser, Echo, Dub delay, Plate reverb, Retro reverb). The
EQ's processor was never built, so Chrome has no reading for it.

### Underruns and render spans

The meter-on pass (20 s, untraced) and the traced spans:

| Scenario | Load avg, 1 min | Meter during warm-up | Meter pass: CPU | Underruns added in the pass | Quanta traced | Median span, µs | p99, µs | Max, µs | After a GC: max with its GC, µs | Over 2 902 µs: no GC / after a GC |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| a | 16.87 | 6 %, underruns 1 | 4–6 % | 0 | 6 790 | 127 | 216 | 253 | 418 | 0 / 0 |
| Advanced Drive | 14.81 | 17 %, 0 | 14–18 % | 0 | 6 786 | 351 | 489 | 550 | 626 | 0 / 0 |
| Compressor | 15.01 | 7 %, 0 | 4–7 % | 0 | 6 788 | 154 | 268 | 1 778 | 407 | 0 / 0 |
| Delay | 9.78 | 6 %, 0 | 6–7 % | 0 | 6 786 | 151 | 260 | 552 | 463 | 0 / 0 |
| Phaser | 9.32 | 9 %, underruns 1 | 6–9 % | 0 | 6 790 | 163 | 268 | 694 | 449 | 0 / 0 |
| Retro reverb | 14.83 | 7 %, 0 | 3–7 % | 0 | 6 792 | 148 | 254 | 424 | 416 | 0 / 0 |
| Plate | 12.89 | 9 %, 0 | 4–9 % | 0 | 6 786 | 189 | 305 | 518 | 468 | 0 / 0 |
| Tape | 13.73 | 7 %, 0 | 4–8 % | 0 | 6 788 | 175 | 293 | 712 | 401 | 0 / 0 |
| Dense | 15.10 | 49 %, 0 | 49–53 % | 0 | 6 789 | 1 923 | 2 445 | 3 492 | 2 968 | 1 / 1 |
| Dense, run 2 | 6.69 | 53 %, 0 | 49–52 % | 0 | 6 788 | 1 967 | 2 548 | 3 515 | 3 009 | 6 / 2 |

"Quanta traced" counts the output stage's calls; the span columns leave out
the first 0.5 s. The two warm-up underruns (a and Phaser) came in the audio
context's first 7.5 s, before the trace; the meter's `peak 34 %` in most
warm-ups is the same start-up cost.

No meter-on pass counted an underrun. In the traced spans, no single-insert
scenario's quantum came near its 2 902 µs budget, with or without a
collection charged to it. The dense song's render takes two thirds of the
budget at the median (with the trace's own cost in it), and a few of its
quanta ran over. Its worst quanta were ones with no collection before them
(3 492 and 3 515 µs); charged with its collection, the worst quantum after
one read 2 968 and 3 009 µs. So in these runs the collections did not make
the dense song's late quanta; its render cost did.

### Per processor: bytes per quantum, against the Node table

Chrome's figures are the traced direct attribution with the meter off; Node's
are windsor#214's "After, off" column (the same bundles).

| Processor | Chrome, bytes / call, median | Chrome, bytes / quantum | Calls allocating | Node, bytes / quantum | Chrome ÷ Node | Chrome confirms per-quantum allocation |
|---|---:|---:|---:|---:|---:|---|
| FM part (`pad-drift`) | 2 880 | 2 909 | every call | 3 587.62 | 0.81 | yes |
| Advanced Drive | 78 144 | 78 070 | every call | 103 565.66 | 0.75 | yes |
| Compressor | 7 680 | 7 680 | every call | 10 244.42 | 0.75 | yes |
| Delay (`dub-delay`) | 3 096 | 3 096 | every call | 6 184.07 | 0.50 | yes |
| Parametric EQ | not measured | | | 3.38 | | not measured (kind not registered on `main`) |
| Output stage | 0 | 0 to 4.5 | 0 to 6 % of calls | 6.08 | | no: none in most calls, never per quantum |
| Phaser | 6 180 | 6 186 | every call | 8 243.42 | 0.75 | yes |
| Retro reverb | 6 336 | 6 337 | every call | 8 102.64 | 0.78 | yes |
| Plate (insert) | 23 064 | 23 061 | every insert call | 41 021.63 | 0.56 | yes |
| Plate (room return, asleep) | 0 | 0 | none | | | no, while asleep |
| Tape | 9 216 | 9 234 | every call | 12 299.36 | 0.75 | yes |

In the dense song, where each call's figure is the same as alone to the byte
(for example 7 680, 6 180, 3 096 and 9 216), Advanced Drive's four instances
make 313 361 of its 462 084 bytes a quantum (68 %), the two plates 46 135
(10 %), Tape 27 658 (6 %), Compressor 23 042 (5 %), Phaser 18 541 (4 %),
Retro reverb 12 676 (3 %), the eight FM parts 11 381 (2.5 %) and Delay 9 289
(2 %).

**Chrome confirms all eight** of the processors Node flagged, every call,
the same bytes in every quantum (the median, mean and second-half mean agree),
so none of it is warm-up. The output stage is clean in Chrome as in Node:
0 to 6 % of its calls allocate anything, 48 or 96 bytes at most, and its
median call allocates nothing.

Four processors (Advanced Drive, Compressor, Phaser, Tape) read 0.75 of
Node's bytes. So does the meter: with it on (`summaries/a-fm-meter-on.json`)
the plate return and the output stage read 24 bytes a call and the FM part
24 more than with it off, against Node's 32 for the meter's two `Date.now()`
heap numbers. 12 against 16 bytes a heap number is what pointer compression,
on in Chrome's V8 and off in Node's, would give, so those four very likely
allocate the same objects in both; that reason is inferred from the ratio,
not traced. The FM part (0.81), Retro reverb (0.78), Plate (0.56) and Delay
(0.50) differ from that ratio, so Chrome's newer V8 optimises part of their
allocation away (or the FM part's different chord changes it), and what
remains is still one allocation stream per quantum.

## Ranked: which processor to fix first

Worst first. The GC rate each adds is its scenario's rate less scenario a's
1.24 a second (the FM part alone); bytes are per instance per quantum.

1. **Advanced Drive**: 78 070 bytes a quantum (26.9 MB/s), **+14.5
   collections a second**; alone it is 68 % of the dense song's garbage.
   Longest pause in its scenario 167 µs.
   **After windsor#226: 0 bytes a quantum**, in every one of the 9 670
   measured calls of a 28.6 s trace of `b-advanced-drive` with the meter off
   (same machine and headless Chrome 154, this method, the worktree's dev
   server; one-minute load average 4.27 before and 3.90 after the trace).
   The thread collected 1.23 times a second, scenario a's rate: the FM
   part's garbage alone. The drive's median call fell from 183 to 107 µs and
   the median quantum span from 351 to 269 µs (both traced). The meter-on
   pass after it read the drive at 5.8–8.7 % with no underrun. Summary:
   [`summaries/b-advanced-drive-after.json`](summaries/b-advanced-drive-after.json).
2. **Plate** (`reverb-processor.js`, as an insert): 23 061 bytes a quantum
   (7.9 MB/s), **+9.0 a second**; longest pause 210 µs. The room return runs
   the same bundle and allocates nothing only because it slept in every
   scenario; a song that sends to it would wake it.

   **After windsor#227: 0 bytes a quantum.** The same `b-plate` scenario and
   method (5 s warm-up, meter off, trace saved and reduced by
   `analyse-trace.mjs` to [`summaries/b-plate-after.json`](summaries/b-plate-after.json)),
   on the same M1, macOS 26.5.1, `HeadlessChrome/154.0.0.0`, 44.1 kHz, load
   average 2.86 before the trace and 3.49 after, 28.3 s traced: every one of
   the 19 121 measured `reverb-processor.js` calls grew the heap by 0 bytes,
   the awake insert's (about 9 730 calls of 40 to 80 µs) and the sleeping
   return's alike. The audio thread collected 1.20 times a second (34
   scavenges, longest 160 µs), against 10.20 before and scenario a's 1.24:
   what remains is the FM part's 2 907 bytes a quantum. The plate passed its
   samples to and from calls V8 did not inline, which boxes each double, and
   first wrote six double fields as 0 or 1; `mixer/reverbAllocation.test.ts`
   now holds it to no allocation and no representation change in Node.
3. **Tape**: 9 234 bytes a quantum (3.2 MB/s), **+3.7 a second**; longest
   152 µs.
4. **Compressor**: 7 680 bytes a quantum (2.6 MB/s), **+3.1 a second**;
   longest 164 µs.
   **After windsor#229: 0 bytes a quantum**, in every one of the 10 147
   measured calls of a 30.0 s trace of `b-compressor` with the meter off
   (same machine and headless Chrome 154, this method, the worktree's dev
   server; one-minute load average 3.83 before and 4.97 after the trace).
   The thread collected 1.24 times a second, scenario a's rate: the FM
   part's garbage alone. The compressor's median call read 13 µs (14
   before) and the median quantum span 157 µs (154 before), both traced.
   The meter-on pass after it read the CPU button at 3–4 % with no
   underrun. Summary:
   [`summaries/b-compressor-after.json`](summaries/b-compressor-after.json).
5. **Retro reverb**: 6 337 bytes a quantum (2.2 MB/s), **+2.6 a second**;
   longest 209 µs.
   **After windsor#230: 0 bytes a quantum**, in every one of the 9 832
   measured calls of a 29.0 s trace of `b-retro-reverb` with the meter off
   (same machine and headless Chrome 154, this method, 44.1 kHz, the
   worktree's dev server; one-minute load average 2.98 before and 4.04
   after the trace). The thread collected 1.24 times a second, scenario a's
   rate: the FM part's garbage alone. The reverb's median call read 16 µs
   (15 before) and the median quantum span 163 µs (148 before), both
   traced. The meter-on pass after it read the CPU button at 3–9 % and
   added no underrun (the one it showed came in the warm-up). Summary:
   [`summaries/b-retro-reverb-after.json`](summaries/b-retro-reverb-after.json).
6. **Phaser**: 6 186 bytes a quantum (2.1 MB/s), **+2.5 a second**; longest
   184 µs.
7. **Delay**: 3 096 bytes a quantum (1.1 MB/s), **+1.2 a second**; longest
   229 µs.
   **After windsor#232: 0 bytes a quantum**, in every one of the 13 187
   measured calls of a 35.7 s trace of `b-delay` with the meter off (same
   machine and headless Chrome 154, this method, the worktree's dev server;
   one-minute load average 4.25 before and 3.01 after the trace). This
   run's context opened at **48 kHz**, not 44.1 (375 quanta a second, so
   `analyse-trace.mjs`'s 2 902 µs budget is 2 667 here; no span came near
   either). The thread collected 1.32 times a second (47 scavenges, longest
   284 µs), against 2.48 before: the FM part's 2 907 bytes a quantum alone,
   which at 48 kHz is scenario a's 1.24 scaled by 375/345. The delay's
   median call read 16 µs (15 before) and the median quantum span 148 µs
   (151 before), both traced. The meter-on pass after it read the CPU button
   at 4–8 % with no underrun. Summary:
   [`summaries/b-delay-after.json`](summaries/b-delay-after.json).
8. **FM part**: 2 909 bytes a quantum for this part (1.0 MB/s), **1.24 a
   second** alone; longest 217 µs. It is last per instance, but it runs once
   per part, so a song's total grows with its part count (the dense song's
   eight parts made 11 381 bytes a quantum, more than one Tape).

Not to fix for allocation: the output stage and the EQ (clean in Node; the
EQ unmeasured here).

How much it costs today: in these runs, no underruns in any meter-on pass,
no collection inside a render call, pauses of 68 to 122 µs at the median and
395 µs at the longest (14 % of a quantum), and at most 2.84 ms of collection
a second on the audio thread, in the dense song. The order above is the
order of garbage and collection rate; the audible case for any fix rests on
the pauses adding up in a denser song or a slower machine, which this
measured neither.

## Limits

- **One machine, busy.** One M1 under load average 4 to 17 from other
  sessions. Pause lengths and spans would differ on a quiet or slower
  machine; bytes per call would not.
- **Tracing changes the thread.** The trace turns on the CPU profiler on the
  audio thread and writes a heap counter after every call, which lengthens
  calls (the spans include it); starting it stalls the thread (up to 34 ms,
  excluded). In the one traced run with the meter on, the meter counted one
  underrun during the trace, in a run whose longest FM call was 7.2 ms with
  no collection in it. Underruns are therefore read in the untraced pass.
- **The meter is off in the trace and on in the pass.** Underruns cannot be
  counted while it is off. The pass's underrun count is a lower bound
  (`cost/audioLoad.ts`), and neither pass sees device-level glitches.
- **One run per scenario**, two for the dense song. The bytes repeat to the
  byte between the dense runs and between each processor alone and in the
  dense song; the collection counts moved by 6 % between the dense runs.
- **Inserts at their defaults**, a single held-chord patch in a and b. Other
  parameters (a drive mode, a tape setting) or patches may allocate
  differently.
- **Major collections**: none in any measured scenario. An exploratory run
  before these (a silent song, whose chord part had no steps) showed two
  memory-reducer mark-compacts on the audio thread (`finalize incremental
  marking via task`), 1 609 and 561 µs, reclaiming start-up garbage (3.0 →
  1.9 MB); that trace was not kept, and whether such a collection can fall
  on a busy quantum was not measured.
- **The EQ** was not measured (above).

## Files

- [`generate-songs.mjs`](generate-songs.mjs) writes [`scenarios/`](scenarios/),
  the ten songs (the repository ignores any folder named `songs/`).
- [`analyse-trace.mjs`](analyse-trace.mjs) reduces a raw trace to a summary:
  `node --max-old-space-size=8192 analyse-trace.mjs <trace.json> <summary.json>`.
- [`summaries/`](summaries/): one per traced run, with every collection's
  time, length and heap before and after. `b-plate-after.json` is the plate
  scenario rerun after windsor#227, and `b-retro-reverb-after.json` the
  Retro reverb's after windsor#230.
- [`tables.mjs`](tables.mjs) prints this README's tables from the summaries.
