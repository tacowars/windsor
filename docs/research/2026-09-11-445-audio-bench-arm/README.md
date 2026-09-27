# #445 — what the music costs: the capability probe and the first indicative pair

Date: 2026-09-11
Ticket: #445
Commit under test: `65a96033`
Status: **indicative only** (CLAUDE.md invariant 3). The target reading is not
this one — see "What is still owed" at the foot.

## Machine and browser

| | |
|---|---|
| Machine | Apple M4 Pro, 14 logical cores, macOS 26.5.1 — **a dev machine, not the target box** |
| Browser | Google Chrome 152.0.7977.83 |
| Backend | WebGL2 (`--backend=webgl2`) |
| Audio device | `AudioContext` at **44100 Hz**, `baseLatency` 0.0058 s (≈ 256 frames) |
| Quantum budget | `128 / 44100` = **2.902 ms** |

The target box is Ryzen 5 5600G / Vega 7 / Chrome on Ubuntu, and its audio
thread is the one that matters. Nothing below is a target reading.

---

## Part 1 — the capability probe

`probe.mjs` in this folder is the whole experiment and re-runs in about 40 s:

```bash
node docs/research/2026-09-11-445-audio-bench-arm/probe.mjs      # both stages
node docs/research/2026-09-11-445-audio-bench-arm/probe.mjs 1    # capability only
```

It serves a one-file page over http (an `AudioWorklet` module will not load
from `file://`) and drives it with the bench runner's own Chrome launcher,
under `--autoplay-policy=no-user-gesture-required` — the same flag, through the
same option, that the audio arm uses. So a successful probe also proves the
flag: the context reached `running` with nobody at the keyboard.

### Stage 1 — which of the ticket's three paths exist

| Path | Result on Chrome 152 |
|---|---|
| (a) `AudioContext.renderCapacity` | **absent.** `'renderCapacity' in AudioContext.prototype` is `false`, `typeof ctx.renderCapacity` is `"undefined"`, and no `update` event ever fires |
| (b) `performance.now()` in `AudioWorkletGlobalScope` | **absent.** `typeof performance === "undefined"` inside the processor |
| (c) `Date.now()` in that scope | **present**, at the usual one-millisecond resolution |

Path (a) was retried under three flag sets in case it was merely gated —
`--enable-experimental-web-platform-features`,
`--enable-blink-features=AudioContextRenderCapacity` and
`--enable-blink-features=WebAudioRenderCapacity`. All three still reported
`inProto: false, type: "undefined"`, so it is not implemented in this build
rather than switched off.

What the processor scope *does* have, for the record: `currentFrame` and
`currentTime` (both numbers) and `sampleRate`. Both are the **audio** clock —
they advance by exactly one quantum per call whatever the render cost — so
neither can measure wall time, which is what a load is.

The main thread's clocks are no help either: over a 3 s idle window the audio
clock tracked the wall clock to within a millisecond, so audio-clock drift is
not a glitch detector and the readout has to come from inside the processor.

### Stage 2 — so how good is path (c)?

One millisecond cannot time a 2.902 ms quantum, so the processors do not try to.
They read `Date.now()` either side of the render and add the difference, which
is not a duration but **the count of integer-millisecond boundaries that fell
inside the call**. Boundaries arrive at a fixed rate in wall time, so counting
the ones that land inside `process()` and dividing by the interval's wall
milliseconds estimates the share of wall time the audio thread spent there.

Stage 2 validates that against synthetic loads of known duration. A probe
processor burns a calibrated spin loop, the main thread times the identical
loop with `performance.now()` for the truth column, and each runs in its own
`AudioContext` (a disconnected worklet node keeps rendering until it is
collected, so a shared context lets earlier trials contend with later ones —
seen on the first attempt and fixed).

| spin | true cost/quantum | true load | estimator, first 3 intervals |
|---|---|---|---|
| 0 | 0 ms | 0.0 % | **0.0 %, 0.0 %, 0.0 %** |
| 2 000 | 0.019 ms | 0.6 % | 2.1 %, 4.1 %, 1.9 % |
| 10 000 | 0.112 ms | 3.9 % | 13.1 %, 11.1 %, 7.9 % |
| 40 000 | 0.366 ms | 12.6 % | 25.5 %, 12.2 %, 13.2 % |

Read it as: **0 at rest, monotone in the true load, and over-reading it by
roughly 2–3×.** The bias is structural — the audio thread renders in bursts, so
boundaries inside a burst are not uniformly distributed over the call, and 1 ms
quantisation aliases against a periodic call pattern. It is an order-of-magnitude
instrument and the code says so in three places (`audioLoad.ts`'s header, the
overlay's `est`, and `browser-testing.md` §3.4).

`peakPct` inherits the same resolution and is a **lower bound** — which took a
review round to make true. A span of N crossings proves the render took more
than `N − 1` ms and nothing about N itself, so the readout scales `peakMs − 1`:
one crossing reads 0 % (it proves nothing — the render may have taken a
microsecond and merely straddled a boundary), two crossings prove one whole
millisecond. It is informative exactly where it matters, because a quantum at
or over budget crosses several boundaries and cannot hide.

`underruns` — quanta whose measured span reached the **whole** budget — is the
one hard number, unaffected by the bias.

---

## Part 2 — the indicative control-vs-audio pair

```bash
npm run dev:client -- --port 5218 --strictPort
node scripts/run-bench.mjs --backend=webgl2 --route=rampart-v1 --build=5000 \
  --horde=400 --audio=bed-01 --base=http://localhost:5218 \
  --out=docs/research/2026-09-11-445-audio-bench-arm/bench-out
```

Two rungs were run; both artifact sets are in `bench-out/`, frozen and never
edited. Each is two back-to-back loads per arm, 1 warm-up lap and a 60 s window.

### The headline: horde 400 (`…T170526Z-…-paired.json`, `allPass: true`)

| | control (silent) ×2 | arm (`bed-01`) ×2 |
|---|---|---|
| `header.audio` | `null` | `bed-01`, **running**, 44100 Hz, 4 parts, 12 max voices, 5 processors |
| `audio.loadPct` p50 | 0.00 %, 0.00 % | **3.39 %, 3.50 %** |
| `audio.loadPct` p95 | 0.00 %, 0.00 % | 4.20 %, 4.40 % |
| `audio.loadPct` max | 0.00 %, 0.00 % | 5.41 %, 4.90 % |
| `audio.peakPct` | 0.00 % | 34.45 % **as recorded — read it as 0 %**, see the note below |
| `audio.underruns` | 0 | **0** |
| frame p95 | 17.2, 17.5 ms | 17.5, 17.1 ms |
| frame p99 | 17.6, 17.7 ms | 17.7, 17.6 ms |
| worst frame | 17.9, 17.8 ms | 17.9, 17.8 ms |
| frames > 100 ms | 0 | 0 |
| heap over window | 196→195, 200→198 MB | 197→200, 208→211 MB |

Pair verdict: **both pairs pass.** p95 deltas +1.74 % and −2.29 % — the arm was
*faster* than its control on the second pair, which is the honest way of saying
the difference is inside this machine's run-to-run noise. Draw-call deltas
+0.008 and +0.006 against an allowance of 0.5, so the two sides drew the same
scene. Both arms reproduced at **0 % p50 spread**.

### What this says, and what it does not

- **The music does not move the frame budget on this machine.** Four parts and
  the plate cost nothing the frame gates can see at 400 enemies and a 5 000-piece
  fort. On an M4 Pro that is unsurprising and is precisely why it is indicative.
- **The audio thread runs at a few percent.** Take 3.4 % as "single digits, and
  the true figure is lower" — stage 2 says the estimator over-reads by 2–3×, so
  the real duty cycle is plausibly around 1–2 %. That is consistent with the two
  unqualified Node figures this ticket set out to replace (the plate at ~1 % of a
  core, 32 voices at ~10 %), which is a weak but welcome cross-check.
- **The control reads exactly 0.00 %**, on every percentile of both runs. That
  is the most useful line in the table: a duty-cycle sampler that reported noise
  would not produce a clean zero across 3 600 frames of a control, so the arm's
  3.4 % is measuring the DSP rather than the instrument.
- **Zero underruns**, and no quantum the clock can convict of anything.

> **These payloads predate a fix and are kept and labelled rather than re-taken**
> (invariant 3: superseded readings are kept). They were recorded while
> `peakPct` scaled the raw boundary-crossing count and an underrun was counted
> at `span ≥ budget`. The review showed a span of N crossings proves only
> `N − 1` ms of work — a 2.2 ms render straddling three boundaries is not a
> missed 2.902 ms deadline — so both now subtract that millisecond. Against
> this same data the current code reads **`peakPct` 0 %** and the same **0
> underruns**; `loadPct` is untouched by the fix. The correction only makes the
> two firm numbers firmer, and nothing here overstated the music's cost.
- **It says nothing about the target box**, whose CPU is a different class and
  whose audio thread contends with a Vega 7 driver. That is the reading that
  matters and it is not this one.

### The second rung, horde 300 (`…T164931Z-…-paired.json`)

Run first because objective §8 names 300 as the M3 spot-check rung. Its audio
numbers agree with the 400 pair almost exactly — `loadPct` p50 3.49 % / 3.59 %,
0 underruns, control flat 0 — and **both of its pairs pass the comparison**.

Its stored `allPass` is `false`, for a reason that has nothing to do with
audio: both arms fail epic #54 decision 7's on-screen gates (`visibleP5`
258–261 against p5 ≥ 300) with every frame gate green, because the frustum
holds ~86 % of the spawn and that gate is unsatisfiable at a 300 rung by
construction. The control fails it identically. **That mismatch is #461.**

The payload also predates the runner fix this PR's review produced: an audio
run's verdict is now re-derived from its own frame metrics, so the runner no
longer fails an audio pair on a gate that does not apply to it, and this rung
would now report a pass. The re-run to refresh the payload was skipped for
time — the 400-rung pair above is the record, and #461 owns the rung.

---

## Target box, 2026-09-14

Written by `target-box-A204`, delegated by `orchestrator-A204`.

**Every line exited non-zero, and not one run is a valid frame reading.** All
twelve loads, control and arm on both backends, fail the runner's validity
gate (implied fps < 55). They render at 28–36 fps. That is **GPU-bound frame
time, not an occluded or throttled window**, whatever the gate's wording says:

- WebGL2's timer query reads a GPU frame time of ~26–29 ms against a CPU scene
  time of ~6–8 ms.
- A throttled window renders ~1 fps, not ~35.

The audio columns *are* measured: the `AudioContext` was running in every arm
window, and `playbackStats` is read from the context itself. The frame verdicts
are the orchestrator's to draw; this section quotes the JSON.

### Machine, browser, build

| | |
|---|---|
| Machine | Ryzen 5 5600G / Vega 7, Ubuntu 26.04.1 LTS, GNOME/Wayland, 3840×2160 @ 60.000 Hz fixed, scale 1.25 — **the target box** |
| Browser | Google Chrome 152.0.7977.64 |
| GL / WebGPU | ANGLE over OpenGL ES 3.2, `radeonsi renoir ACO`, Mesa 26.0.8; WebGPU adapter `amd` / `gcn-5` under `--enable-features=Vulkan` |
| Audio device | `AudioContext` at **48000 Hz**, `baseLatency` 0.010667 s (512 frames); quantum budget **2.667 ms** |
| Commit | worktree detached at `ddaf0b2e` (#275 merged as `7abaf2f1`, plus a docs-only metrics commit); every run's `header.gitCommit` is `ddaf0b2e`, served from `/@vite/env` |
| Scenario | `rampart-v1`, `build=5000` (`header.building.pieces` 5001), `horde=400`, horde renderer **`capsule`** (the placeholder row); 1 warm-up lap (~152 s); 60 s window; ~446 draw calls and `visibleP5` 345–355 on every run, so the fort and horde drew |
| Flags | the runner's own. WebGL2: throwaway profile, `--enable-logging`, window 1920×1080. WebGPU adds `--enable-features=Vulkan`. Each audio arm's Chrome, and only that one, adds `--autoplay-policy=no-user-gesture-required` |

Pre-flight (§3.1) passed at 14:29Z:

- display mode current and fixed at 60 Hz;
- session unlocked;
- no browser process by name;
- Vite on `127.0.0.1:5173` only;
- `gpu-probe.mjs` `webgpuUsable: true` with the Vulkan flag, `webgl2Hardware: true`, no software renderer.

It had **no remote-desktop item**, and that gap cost the first WebGL2 line.

### The three lines

```bash
node scripts/run-bench.mjs --backend=<webgl2|webgpu> --route=rampart-v1 --build=5000 \
  --horde=400 --audio=bed-01 --base=http://localhost:5173 \
  --expect-commit=ddaf0b2e2274ae997676868e456e8770aa03d532 \
  --out=docs/research/2026-09-11-445-audio-bench-arm/bench-out
```

| runId | backend | wall clock (UTC) | exit | status |
|---|---|---|---|---|
| `20260914T143034Z` | WebGL2 | 14:30:34 – 14:45:37 | 1 | **confounded — kept and labelled, not a reading.** An RDP session (`gnome-remote-desktop`, `:3389`, from the maintainer's machine) was attached, and CI overlapped three of its four windows |
| `20260914T150239Z` | WebGPU | 15:02:38 – 15:17:27 | non-zero (`allPass: false`) | no RDP; CI overlapped the first audio window |
| `20260914T151727Z` | WebGL2 | 15:17:27 – 15:32:21 | non-zero (`allPass: false`) | **the re-take**: no RDP, no CI in any window |

The wrapper's echoed exit code for the last two lines is unusable: it captured
`date`'s status. The paired files' `allPass: false` and the failing validity of
every run mean the runner exited non-zero.

Every pair's `comparison` is `null`: the runner does not compare runs that
failed validity.

### CI and remote desktop, per window

A sampler read `Runner.Worker` by process name every 5 s. From 15:02 it also
read established `:3389`/`:5900` connections. Windows are placed from each
file's write time: control windows close at the write, arm windows 3 s before
it (the settle wait).

| run | window (UTC) | `Runner.Worker` samples | RDP at open / close | load avg |
|---|---|---|---|---|
| WebGL2 `…143034Z` silent-1 | 14:33:25–14:34:25 | 6 / 12 | attached* | 1.3–2.1 |
| WebGL2 `…143034Z` silent-2 | 14:37:06–14:38:06 | 0 / 12 | attached* | 6.4→3.3 |
| WebGL2 `…143034Z` audio-1 | 14:40:43–14:41:43 | 11 / 12 | attached* | 10.0–13.6 |
| WebGL2 `…143034Z` audio-2 | 14:44:24–14:45:24 | 12 / 12 | attached* | 2.6→10.2 |
| WebGPU `…150239Z` silent-1 | 15:05:20–15:06:20 | 0 / 13 | 0 / 0 | 1.4–1.8 |
| WebGPU `…150239Z` silent-2 | 15:08:56–15:09:56 | 1 / 12 | 0 / 0 | 1.9–2.4 |
| WebGPU `…150239Z` audio-1 | 15:12:33–15:13:33 | **11 / 12** | 0 / 0 | 9.2–12.2 |
| WebGPU `…150239Z` audio-2 | 15:16:14–15:17:14 | 0 / 12 | 0 / 0 | 2.3–2.7 |
| WebGL2 `…151727Z` silent-1 | 15:20:15–15:21:15 | 0 / 12 | 0 / 0 | 1.2–2.1 |
| WebGL2 `…151727Z` silent-2 | 15:23:50–15:24:50 | 0 / 12 | 0 / 0 | 0.6–0.8 |
| WebGL2 `…151727Z` audio-1 | 15:27:28–15:28:28 | 0 / 12 | 0 / 0 | 0.6–0.8 |
| WebGL2 `…151727Z` audio-2 | 15:31:08–15:32:08 | 0 / 12 | 0 / 0 | 0.6–0.9 |

\* The first line predates the RDP column. The connection was found
established after the line closed at 14:45Z, and the maintainer confirmed
it was his. It is taken as attached throughout; the record cannot show when it
was opened.

### Per run, per arm

Frame interval in ms. `schedMs` is mean / p95. `underrunEvents`,
`underrunDuration` and `totalDuration` are the `playbackStats` deltas over the
window **plus the 3 s settle wait**. Latencies are `header.audio`, read at
window close, in ms: average / minimum / maximum / base. `est` is the
duty-cycle sampler's `audio.underruns`.

**WebGL2 — the re-take, `20260914T151727Z` (clean windows)**

| run | fps | p50 / p95 / p99 / max | >100 ms | gates | `loadPct` p50 / p95 | `schedMs` | `underrunEvents` | `underrunDuration` | `totalDuration` | ratio | latencies | est |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| silent-1 | 35.57 | 28.0 / 29.6 / 30.2 / 45.3 | 0 | p95 ✗ p99 ✓ worst ✓ | 0 / 0 | 0 / 0 | — | — | — | — | — | 0 |
| silent-2 | 35.52 | 28.0 / 29.6 / 30.2 / 45.5 | 0 | p95 ✗ p99 ✓ worst ✓ | 0 / 0 | 0 / 0 | — | — | — | — | — | 0 |
| audio-1 | 35.77 | 27.9 / 29.4 / 30.0 / 45.5 | 0 | p95 ✗ p99 ✓ worst ✓ | 7.3 / 8.5 % | 0.011 / 0.10 | 0 | 0 | 63.152 s | 0 | 37.1 / 0.0 / 42.3 / 10.67 | 0 |
| audio-2 | 35.86 | 27.8 / 29.4 / 29.9 / 44.6 | 0 | p95 ✗ p99 ✓ worst ✓ | 7.1 / 8.8 % | 0.011 / 0.10 | 0 | 0 | 63.152 s | 0 | 37.8 / 0.0 / 53.3 / 10.67 | 0 |

GPU frame time (WebGL2 timer query): p50 25.8 ms, p95 27.4–27.7 ms, on every
run. CPU `sceneMs` p50: 5.5–5.9 ms.

**WebGPU — `20260914T150239Z`**

| run | fps | p50 / p95 / p99 / max | >100 ms | gates | `loadPct` p50 / p95 | `schedMs` | `underrunEvents` | `underrunDuration` | `totalDuration` | ratio | latencies | est |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| silent-1 | 34.42 | 28.9 / 30.5 / 31.6 / 91.0 | 0 | p95 ✗ p99 ✓ worst ✓ | 0 / 0 | 0 / 0 | — | — | — | — | — | 0 |
| silent-2 | 33.82 | 29.3 / 31.1 / 33.7 / 87.3 | 0 | p95 ✗ p99 ✗ worst ✓ | 0 / 0 | 0 / 0 | — | — | — | — | — | 0 |
| audio-1 *(CI)* | 32.06 | 28.9 / 49.9 / 96.1 / 129.9 | 15 | p95 ✗ p99 ✗ worst ✗ | 8.7 / 11.9 % | 0.023 / 0.10 | 0 | 0 | 62.150 s | 0 | 37.0 / 0.0 / 42.2 / 10.67 | 2 |
| audio-2 | 33.58 | 29.4 / 31.4 / 44.7 / 88.0 | 0 | p95 ✗ p99 ✗ worst ✓ | 7.2 / 8.2 % | 0.014 / 0.10 | 0 | 0 | 63.152 s | 0 | 37.9 / 0.0 / 49.1 / 10.67 | 0 |

WebGPU GPU frame time is n/a (#10). CPU `sceneMs` p50: 9.0–11.2 ms. audio-1's
fifteen frames over 100 ms fall in the one window a CI job overlapped
(11 / 12 samples); by the collision rule that window is a re-take candidate.

**WebGL2 — confounded, `20260914T143034Z` (RDP attached; CI in three windows)**

| run | fps | p50 / p95 / p99 / max | >100 ms | `loadPct` p50 / p95 | `underrunEvents` | `underrunDuration` | `totalDuration` | latencies | est |
|---|---|---|---|---|---|---|---|---|---|
| silent-1 | 30.80 | 32.5 / 35.6 / 38.5 / 64.3 | 0 | 0 / 0 | — | — | — | — | 0 |
| silent-2 | 31.75 | 31.2 / 34.6 / 36.9 / 52.1 | 0 | 0 / 0 | — | — | — | — | 0 |
| audio-1 | 29.94 | 33.0 / 39.4 / 41.7 / 58.5 | 0 | 8.8 / 12.3 % | 0 | 0 | 63.131 s | 35.1 / 0.0 / 44.1 / 10.67 | 5 |
| audio-2 | 28.63 | 34.8 / 39.5 / 42.1 / 61.1 | 0 | 10.1 / 12.6 % | 0 | 0 | 63.152 s | 35.1 / 0.0 / 44.3 / 10.67 | 4 |

Against the re-take on the same backend and commit, frames were ~5 fps slower,
GPU frame time p50 27.6–30.6 ms against 25.8, and `loadPct` 1–3 points higher.
That is what the RDP stream and CI together cost. The two can't be separated
here: silent-2 had no CI job but did have RDP and a decaying load of 6.4→3.3.

### Stated plainly, not corrected

- **The delta spans more than the window.** `totalDuration` is 63.15 s over a
  60 s window (62.15 s on one WebGPU run): the 60 s window plus the 3 s settle
  wait. `underrunEvents` and `underrunDuration` span the same 63 s, so quote
  both numbers. The zero underruns here are zero over ~63 s.
- **`minimumLatency` reads 0 in-game on the box**, in every arm run on both
  backends, exactly as in the #275 probe
  (`docs/research/2026-09-14-275-playbackstats-probe/`), where it also never
  left 0. `averageLatency` reads 35–38 ms, `maximumLatency` 42–53 ms.

### What the numbers show (facts; the verdicts are not drawn here)

- **The frame gates fail on the scenario itself, not because of the music.** On
  the clean WebGL2 re-take the arms read 35.77 / 35.86 fps against 35.57 /
  35.52 in silence, with p95 29.4 ms against 29.6. The M3 record
  (`docs/research/2026-08-31-m3-horde-budget.md`) passed this same
  `rampart-v1`, build-5000, 400-enemy rung on both backends on this box.
  Since then the horde has moved to the server (M4) and the terrain, sky,
  fog, ship and ground-cover work has landed. **Per invariant 3, a rung that
  passed before and fails now files a P2 ticket.** This record does not
  diagnose the cause.
- **`bed-01` recorded zero `playbackStats` underruns in all six arm windows**,
  including the two a CI job overlapped at load 10–13. `underrunDuration`
  is 0 s throughout, so the ratio is 0. The sampler's `est` read 5, 4 and 2
  in the loaded windows and 0 in every clean one. It over-reads; stage 2
  above showed why.
- **The audio thread's duty cycle is 7–9 % p50** on the box by the sampler
  (8–13 % p95), against 3.4 % on the M4 Pro. Stage 2 says the sampler
  over-reads at light loads, so the true figure is lower.
- **Main-thread scheduling** (`schedMs`) averages 0.011–0.030 ms per frame,
  p95 0.10 ms.

## What is still owed

1. ~~Re-run the capability probe on the Ubuntu box~~ — **done 2026-09-14.**
   Neither `renderCapacity` nor `performance` in the worklet scope exists, so
   the readout keeps path (c). The probe also found `AudioContext.playbackStats`,
   which #275 adopted as the underrun source. Record:
   `docs/research/2026-09-14-275-playbackstats-probe/`.
2. ~~One control-vs-audio pair per backend~~ — **taken 2026-09-14, above,
   drawing the `capsule` horde row.** Its **audio** columns are measured. Its
   **frame** comparison is not a reading: every run fails validity on
   GPU-bound frame time. Whether the pair stands as the #445 target reading,
   or is re-taken once the P2 frame-budget ticket lands, is the
   orchestrator's call. The WebGPU audio-1 window overlapped CI.
3. **Whether `underruns === 0` becomes a gate.** The column now exists and
   reads 0 in all six arm windows on the target box: WebGL2 clean ×2,
   WebGL2 under RDP + CI ×2, WebGPU ×2 (one under CI). The window is ~63 s,
   not 60 s, and the frame budget was already blown. The argument is for the
   orchestrator and Pat; two facts bear on it:
   - a `playbackStats` underrun is a whole 512-frame output callback, and
     under sustained overload the counter saturates (#275 probe findings 3
     and 5);
   - on this box zero held while the main thread rendered at ~30 fps and a
     CI job loaded the CPU.

## Files

- `probe.mjs` — the capability probe, both stages, reproducible.
- `bench-out/` — the Mac's eight run payloads and two paired comparisons
  (`20260911T…`), frozen; and the target box's twelve run payloads and three
  paired comparisons (`20260914T…`), frozen. `20260914T143034Z` is the
  confounded WebGL2 line (RDP attached).
- Decision record: `docs/log/2026-09-11-audio-bench-arm-and-worklet-load-readout.md`.
