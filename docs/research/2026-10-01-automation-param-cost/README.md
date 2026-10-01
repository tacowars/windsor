# What automation inputs cost the FM worklet (windsor#343)

Decision 16 of `docs/log/2026-10-01-song-automation-lanes.md` leaves open
how the FM worklet receives automated voice parameters. There are two
candidates:

- **Per target:** one k-rate AudioParam per voice target, 29 per part.
- **Slots:** `FM_LANES_MAX` (8) k-rate slots per part, each mapped to a
  target.

At 16 parts that is 464 parameters against 128. This note measures what
each costs while the parameters sit idle, and what ramping them costs. It
also measures what the main thread pays to schedule the ramps. windsor#346
follows its recommendation.

Research only. The probe processors were built on a throwaway working
tree and are not committed. The PR contains only this folder.

**In short:** Chrome charges a fixed price per declared k-rate parameter
per render quantum, read or not: about 0.6 to 1.0 µs. At 16 parts the 29
targets cost 120 to 210 ms of render-thread time per second of audio,
12 to 21 % of a core, before any lane exists. The 8 slots cost 29 to
40 ms, 3 to 4 % of a core. The app's CPU meter cannot see either cost.
Scheduling 128 bent lanes at tick resolution costs the main thread about
6 ms per second of song. The recommendation is **slots**.

## Where and how

- **Machine:** Apple M1 (4 performance and 4 efficiency cores, 16 GB),
  macOS 26.5.1. **The machine was not quiet.** Other sessions ran
  throughout, and the one-minute load average read 6.7 to 16.6 across the
  work. The offline renders below swing by ±20 % run to run because of
  it. The offline comparisons are therefore paired: each run renders
  every case back to back, and the difference is taken within the run.
- **Browsers:** Google Chrome 154.0.8037.92 in both of these modes:
  - **headless:** `HeadlessChrome/154.0.0.0`, the project's
    `chrome-devtools-mcp@1.10.1` instance (`.mcp.json`);
  - **headed:** the installed Google Chrome, started by
    [`cdp.mjs`](cdp.mjs) with a throwaway profile, `--mute-audio`,
    `--autoplay-policy=no-user-gesture-required` and the three
    background-throttling switches off, driven over the DevTools
    protocol.
- **Backends:**
  - **Online:** a live `AudioContext` from the app itself.
    - Headless: 44.1 kHz, `baseLatency` 5.8 ms, `outputLatency` 32 ms,
      on whatever device headless Chrome opens.
    - Headed: the machine's default output device, at 48 kHz,
      `baseLatency` 5.3 ms, `outputLatency` 168 ms. The default device
      changed during the last two headed runs (run 3's a and b), which
      ran at 44.1 kHz with an `outputLatency` of 40 ms.
  - **Offline:** an `OfflineAudioContext` at 48 kHz, stereo.
- **Code:** `origin/main` at `94e9a92`, served by the worktree's Vite
  8.3.1 dev server.

### The probe processors

[`probe-processors.patch`](probe-processors.patch) adds probe processors
to `worklet/fm/fmProcessor.ts`, rebuilt with
`node scripts/build-worklets.mjs`, beside the unchanged `fm-part`:

- **`fm-part-p29`:** the same part, plus 29 k-rate parameters
  (`target0`…`target28`, default 0).
- **`fm-part-p8`:** the same part, plus 8 k-rate parameters
  (`slot0`…`slot7`, default 0).

Each copies its extra parameters' values into a preallocated
`Float64Array` once per quantum, inside the timed render. That is the
least an offset latch would do. Two more, **`-unread`**, declare the same
parameters but never read them, to separate Chrome's share of the cost
from the processor's.

The four cases of the issue are:

| Case | Processor | Lanes |
|---|---|---|
| a | `fm-part`, today's | none |
| b | `fm-part-p29` | 29 idle at their default |
| c | `fm-part-p8` | 8 idle at their default |
| d | `fm-part-p8` | 8 ramping continuously: one `linearRampToValueAtTime` per lane per tick at 124 bpm, along a bent curve |

[`probe.js`](probe.js) swaps `window.AudioWorkletNode` for a subclass,
which builds the case's processor wherever the engine asks for `fm-part`.
The app and the engine run unchanged around it.

### The songs

[`generate-song.mjs`](generate-song.mjs) writes two songs. Each has 16
copies of the shipped `pad-drift` part. Each part holds a three-note
chord struck once a bar, with the harmony moving every four bars, at
124 bpm for 16 bars (30.97 s). There are no inserts and no sends.

- **`sixteen-pads.json`:** the patch as shipped. Its `spread` of 12 gives
  two detuned voices a note, 96 held voices in all. It does not play in
  real time here: in headless Chrome the audio clock ran at 0.79 of wall
  time during playback.
- **`sixteen-pads-light.json`:** the same with `spread` 0, 48 voices. It
  plays in real time, with the audio clock at 1.00 for cases a, c and d.
  It is the song for every online number, and for the offline numbers
  unless a row says otherwise.

### What was read

1. **Online: the app's meter.** For each case, a fresh page restores the
   song, enables audio and plays it from bar 1. After an 8 s warm-up the
   probe takes 20 one-second readouts. Each readout is computed the way
   `AudioLoadMeter.readout()` does (`cost/audioLoad.ts`), from the same
   `load` reports the processors post. Each case got three runs per
   browser, in a rotating order. The probe also reads the audio clock's
   rate, the change in `currentTime` over the wall time. Below 1, the
   render fell behind real time.
2. **Offline: the song render.** The engine's own `renderSong` renders
   the song at 48 kHz, as Export does, and the probe times it. There is
   one warm-up render, then a, b, c and d interleaved, seven times. In
   case d the probe writes the lanes at each of the render's stops (every
   0.25 s, 0.5 s ahead), as the automation player would on the one clock
   (decision 8). The renders' peaks are identical across cases (0.8913).
3. **Offline: the nodes alone** ([`micro.js`](micro.js)). These are 16
   `fm-part` nodes with no notes, rendered for 20 s at 48 kHz. The render
   stops every 0.25 s in every case, and in case d writes the lanes at
   each stop. With every voice idle, the difference between cases is the
   parameters alone. This bench was added because the song render's
   spread on this busy machine hid c and d. It runs 11 times per browser,
   in a rotating order.
4. **Scheduling.** On the live page, with the 16 nodes of case c, the
   probe runs the app's own pump: every 25 ms it writes every lane up to
   0.12 s ahead (`HOST_PUMP_INTERVAL_MS`, `SCHEDULER_LOOK_AHEAD_SECONDS`).
   That is 16 parts × 8 lanes, each lane with a point a beat apart, at
   124 bpm (24 ticks a beat, 49.6 ticks a second). The probe times the
   pump with `performance.now()`, which the page coarsens to 100 µs (it
   is not cross-origin isolated). It runs three variants, 10 s each, and
   then a seek: `cancelScheduledValues` on every lane, then a refill of
   the horizon.
   - **points:** one ramp per lane per point, the fewest a straight lane
     needs (269 calls a second);
   - **tick:** one ramp per lane per tick, straight (6 349 a second);
   - **bent:** one ramp per lane per tick, each value through the bend
     curve (`t^(2^(3·bend))`) (6 349 a second).

Raw results:

| File | What it holds |
|---|---|
| [`online-headless.json`](online-headless.json) | the online runs and the scheduling runs, headless |
| [`online-headed.json`](online-headed.json) | the online runs and the scheduling runs, headed |
| [`offline-song-light-headless.json`](offline-song-light-headless.json) | the light song's offline renders, headless |
| [`offline-song-light-headed.json`](offline-song-light-headed.json) | the light song's offline renders, headed |
| [`offline-song-headless.json`](offline-song-headless.json) | the full song's offline renders, headless |
| [`offline-nodes-headless.json`](offline-nodes-headless.json) | the nodes-alone bench, headless |
| [`offline-nodes-headed.json`](offline-nodes-headed.json) | the nodes-alone bench, headed |

## Results

### Offline: the nodes alone

These are 16 nodes and 20 s of audio at 48 kHz, 11 runs. "Over a" is
each run's render less the same run's case a, as a median with its
min–max, per second of audio. A per-second cost of 10 ms is 1 % of one
core.

| Case | Headless: render, median (min–max) | Headless: over a, ms per audio s | Headed: render, median (min–max) | Headed: over a, ms per audio s |
|---|---|---|---|---|
| a, today | 504 ms (444–899) | — | 798 ms (760–844) | — |
| b, 29 idle | 3 012 ms (2 491–4 591) | **122.8** (102.0–203.4) | 4 334 ms (4 092–4 554) | **175.9** (166.6–185.9) |
| c, 8 idle | 1 155 ms (927–1 824) | **28.7** (17.6–67.4) | 1 602 ms (1 535–1 695) | **40.1** (38.4–43.8) |
| d, 8 ramping | 1 272 ms (1 034–2 129) | **36.4** (22.6–67.3) | 1 786 ms (1 714–1 933) | **50.0** (46.7–54.4) |
| b, unread | 2 716 ms (2 348–4 425) | 109.9 (95.2–176.3) | 4 198 ms (4 006–4 455) | 170.8 (161.3–181.4) |
| c, unread | 997 ms (883–1 763) | 26.6 (20.7–43.2) | 1 627 ms (1 541–1 695) | 40.8 (37.4–43.6) |

Per parameter and per quantum (the median over a, divided by 16 nodes ×
375 quanta a second × the parameter count), that is:

| | b (29) | c (8) | b unread | c unread |
|---|---|---|---|---|
| headless | 0.71 µs | 0.60 µs | 0.63 µs | 0.55 µs |
| headed | 1.01 µs | 0.84 µs | 0.98 µs | 0.85 µs |

### Offline: the song render

These are the engine's `renderSong` at 48 kHz, seven runs. "Over a" is
the paired difference: its median, its min–max, and how many of the
seven runs came out above a. Per second is per second of song (30.97 s).

| Song, browser | a | b | c | d |
|---|---|---|---|---|
| light, headless | 32.14 s (23.49–38.14) | 37.56 s (30.94–47.65) | 31.68 s (24.21–39.61) | 33.05 s (24.09–40.18) |
| over a | — | **+6.52 s** (+3.13…+10.57), 7/7 above; +210 ms/s, +20 % | +0.13 s (−3.60…+6.05), 4/7 above | −1.73 s (−3.77…+10.36), 3/7 above |
| light, headed | 27.72 s (22.18–35.69) | 34.25 s (25.66–40.50) | 29.94 s (23.54–31.16) | 28.43 s (23.33–40.53) |
| over a | — | **+4.94 s** (+3.48…+7.09), 7/7 above; +159 ms/s, +18 % | −0.47 s (−4.76…+2.30), 3/7 above | +0.71 s (−2.20…+4.84), 4/7 above |
| full, headless | 37.27 s (31.71–49.70) | 43.71 s (37.41–53.63) | 38.06 s (32.46–45.96) | 36.65 s (34.61–45.86) |
| over a | — | **+6.45 s** (+3.70…+17.39), 7/7 above; +208 ms/s, +17 % | +0.24 s (−6.36…+13.78), 5/7 above | +1.76 s (−8.98…+13.69), 4/7 above |

In case d the render's main thread also wrote 214 528 ramps, in 122 to
140 ms in all, during the render's stops.

### Online: the app's meter

These are the light song, 20 readouts after an 8 s warm-up, three runs
per case. A cell gives each run's median `loadPct`, then the audio
clock's rate for each run.

| Case | Headless: load, run 1 / 2 / 3 | Headless: clock rate | Headed: load, run 1 / 2 / 3 | Headed: clock rate |
|---|---|---|---|---|
| a | 62.6 / 61.6 / 70.4 (median 62.6) | 1.000 / 1.000 / 1.001 | 61.1 / 53.2 / 61.1 (61.1) | 1.000 / 1.000 / 1.000 |
| b | 59.4 / 62.6 / 61.8 (61.8) | 1.008 / 0.999 / **0.860** | 62.7 / 62.4 / 61.7 (62.4) | 1.000 / **0.941** / **0.942** |
| c | 58.6 / 62.8 / 62.3 (62.3) | 1.000 / 1.001 / 1.001 | 59.4 / 65.9 / 51.9 (59.4) | 1.001 / 1.001 / 1.000 |
| d | 59.3 / 60.8 / 63.7 (60.8) | 1.001 / 1.000 / 1.001 | 59.0 / 69.9 / 65.8 (65.8) | 1.001 / 0.999 / 0.999 |

The readouts within a run spread by about ±10 points (each run's min and
max are in the JSON). Each run counted no underruns, except one in
headed c, run 2. Note that `loadPct` is the estimator that over-reads
2 to 3×, as `cost/audioLoad.ts` explains.

### Scheduling, on the main thread

These are 16 parts × 8 lanes at 124 bpm, written by the app's 25 ms
pump, 0.12 s ahead, on the live page. The cost is the median of three
10 s runs, with each run in brackets.

| Variant | Calls per song second | Headless: ms per song second | Headed: ms per song second | Per call | Longest pump | Seek: cancel 128 lanes + refill |
|---|---|---|---|---|---|---|
| points (a point a beat) | 269 | 0.41 (0.35–0.46) | 0.28 (0.24–0.37) | 1.0–1.5 µs | 0.2 ms | ≤ 0.4 ms |
| tick, straight | 6 349 | 5.58 (5.48–6.06) | 5.09 (4.67–5.37) | 0.79–0.86 µs | 0.6 ms | ≤ 0.7 ms |
| tick, bent | 6 349 | 6.53 (6.31–6.74) | 5.85 (5.67–6.39) | 0.91–1.01 µs | 0.8 ms | ≤ 0.7 ms |

During the online case-d runs the same bent pump read 6.79 to 7.03 ms
per second of song (headless) and 5.51 to 6.08 (headed), with the song
playing. Its longest pump there was 1.1 to 1.3 ms (`online-headless.json`,
`online-headed.json`), above the table's scheduling-only 0.8 ms.

## What the numbers say

- **A declared k-rate parameter costs Chrome about 0.6 to 1.0 µs per
  quantum, whether or not the processor reads it.** The unread rows cost
  what the read rows cost, within the spread. The price is Chrome's
  handling of the parameter around the `process()` call, and the
  processor's read adds little. Today's part already declares four
  (`pitchBend`, `modWheel`, `cutoffMod`, `gain`), and those four are in
  case a. The cost scales with the declared count:
  - **b, per target:** 464 parameters across 16 parts cost 123 to
    176 ms per second of audio with every voice idle. In the song render
    they cost 159 to 210 ms (+17 to +20 %), above a in all 21 paired
    runs. That is 12 to 21 % of a core, paid by every song, with or
    without a lane.
  - **c, slots:** 128 parameters cost 29 to 40 ms per second, 3 to 4 % of
    a core. In the song render that is under the run-to-run spread on
    this machine: c was above a in 12 of 21 paired runs, with medians
    from −0.47 to +0.24 s.
- **Ramping is cheap next to declaring.** Case d over case c adds 8 to
  10 ms per second for 128 lanes moving every quantum (36.4 against
  28.7 headless, 50.0 against 40.1 headed).
- **The app's CPU meter cannot see any of it.** The meter times the inside
  of `process()` (`LoadSampler`), and Chrome's per-parameter work happens
  outside it. The four cases read the same within the meter's noise. What
  the online runs did show is the audio clock. With the light song, b was
  the only case whose clock fell behind wall time: once of three runs
  headless (0.86) and twice of three headed (0.94). a, c and d held 1.00
  in every run. So at 16 parts, per-target parameters take a song that
  plays in real time on this machine and make it miss its deadlines.
  The meter would still show the same load.
- **Scheduling is affordable either way.** 128 lanes cut into ramps at
  every tick cost the main thread 5 to 7 ms per second of song, about
  0.6 % of it. No pump exceeded 0.8 ms with the scheduling alone, or
  1.3 ms with the song playing, inside the 25 ms pump interval.
  Straight lanes written once per point cost 0.3 to 0.4 ms. A seek's
  cancel and refill cost under 1 ms. The design choice does not change
  this side: either design writes one AudioParam per lane.

## Limits

- **One machine, under load.** The load average ran from 6.7 to 16.6.
  The absolute times, the headed/headless gap and the online clock slips
  all depend on it. The paired per-parameter cost is the firmest number
  here, and it agrees across the node bench and the song render, and in
  both browsers.
- **The online measure is the app's meter, as the issue asked, and it is
  blind to this cost.** The clock-rate reading is a coarse substitute,
  not a deadline count.
- **The full song was rendered offline in headless Chrome only.** The
  headed browser rendered the light song.
- **The `performance.now()` resolution is 100 µs** on this page. A pump's
  time is a sum over 400 pumps, and the per-call figures are totals
  divided by counts, not single timings.
- **The probe's latch is a copy into a scratch array.** A real offset
  path adds the ramped value to the patch value per control block. That
  is the same order of work for either design, and it is not measured
  here.

## Recommendation for windsor#346

**Use slots: 8 k-rate parameters per FM part, each mapped to a target by
a message.** Chrome charges every declared k-rate parameter on every
quantum, used or not, so the parameter count is a fixed tax on every
song:

- **Per target:** 29 parameters a part cost 12 to 21 % of a core at
  16 parts before a single lane exists. In 3 of 6 live runs it pushed a
  real-time song past its deadlines.
- **Slots:** 8 parameters cost 3 to 4 %, and ramping all 128 of them
  adds about 1 %.

The scheduling cost, about 6 ms per second of song for 128 bent lanes,
is the same for both designs and does not weigh on the choice.
