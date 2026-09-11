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

## What is still owed (the target reading)

The final acceptance criterion of #445 is **post-merge and does not gate it**
(objective §8: readings ride the cadence). The target-box session takes it:

1. Re-run `probe.mjs` on the Ubuntu box and record which path that Chrome
   offers. If it has `renderCapacity`, the readout's internals can change
   behind the same four fields — they are defined by what they mean, not by
   how they are obtained.
2. One control-vs-audio pair **per backend** (`bed-01`, the current spot-check
   rung), recorded in this folder beside these, naming the row it drew.
3. Argue in that record whether `underruns === 0` should become a gate.
   `audio-architecture.md` §7's "suggested criterion" — zero underruns over a
   60 s M3-equivalent window — is the starting point, and there is now a real
   column to argue it against instead of a guess.

## Files

- `probe.mjs` — the capability probe, both stages, reproducible.
- `bench-out/` — the four run payloads and two paired comparisons, frozen.
- Decision record: `docs/log/2026-09-11-audio-bench-arm-and-worklet-load-readout.md`.
