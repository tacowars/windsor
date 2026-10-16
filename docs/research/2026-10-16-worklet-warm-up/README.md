# Warming the worklets up before the first play (windsor#837)

The first ▶ after the power button dropped out: the device missed buffers on
the first downbeat, and a second ▶ in the same session was clean. This note
finds what was cold (decision 1), records a warm-up that was built and
measured, and why it was not adopted
(`docs/log/2026-10-16-no-worklet-warm-up.md`). **Nothing here shipped.** The
code lives only on unpushed WIP commits of the branch
`feature/837-worklet-warm-up` (the measured state is `5a31f33`, on
`origin/main` at `5d456d9`); this folder is the record.

**In short.** The first notes ran code V8 had never compiled: the first
downbeat's quantum took 8 to 12.5 ms of a 2.9 ms budget, 2.3 to 3.4 ms of it
parsing and compiling 80 to 87 functions on the audio thread, the rest the
voices and the inserts' awake paths in V8's interpreter. The warm-up built
for it (each FM part plays a short script on its own patch at construction,
each worklet insert kind's first processor renders 16 quanta of noise at its
own settings, and each then builds its state again) cut the pad bench song's
first-▶ device underruns from 3 (0–5) a run, in 11 of 12 runs, to one or two
in 3 of 22 runs, and the worst quantum from 11–12 ms to 4–5 ms. The drum song
had no first-▶ underruns before or after. It roughly doubled the build's
burst on the audio thread (device underruns during the build, in silence,
from 4–6 to 8–13; 23–35 ms of underrun to 46–76 ms), and the drum song's
steady render read 11.6 % and 15.6 % higher at 44.1 kHz in two rounds
(within noise at 48 kHz). It was not adopted.

## Setup

- **Machine:** a 14-core arm64 desktop, Node
  24.16.0 (V8 13.6). Other sessions shared it; each result row carries the
  one-minute load average (2.7 to 8.3).
- **Browser:** Chromium 155.0.8059.80, arm64, headless, launched with a
  temporary profile, no extensions and muted output
  (`../2026-10-13-performance-assessment/cdp.mjs`). The default output
  device runs at 44.1 kHz.
- **Backend:** a realtime `AudioContext` (`latencyHint: 'interactive'`), at
  the device's 44.1 kHz and at 48 kHz (resampled to the device). Chromium asked
  for 256 frames a callback with about 13.7 ms of playout delay.
- **Bundles:** "before" is `origin/main` at `5d456d9`'s generated bundles;
  "after" is the WIP commit `5a31f33`'s, built on that base. The page's
  engine code is the same in both: only the bundles changed.

## Method

- **`coldStart.mjs`** (Chromium; `coldPage.mjs` is its page, `coldSongs.mjs`
  its songs). Each run is a fresh browser, so a fresh audio thread and a
  cold V8. It builds the song's system as the power button does (a fresh
  context, `FmEngine.init`, `AudioSystem.init`, `initMusic`, the part meter
  bank lit, the load meter on, the 25 ms pump), waits 3 s, plays from the
  top for 4 s, stops, waits 1.5 s and plays again for 4 s. The page samples
  `playbackStats.underrunEvents` (the device's underruns, as the power
  button's title shows them) and the load sampler's underruns (the title's
  "underruns", the DSP's) every 25 ms, and each window's rise is read: the
  build (from its start to the first ▶), the first ▶ and the second ▶. With
  `--trace` it also records the audio thread (`webaudio`,
  `disabled-by-default-v8.compile`, `v8`): each quantum's render span, so
  the worst quantum of each window and the second ▶'s mean, the steady
  render. `--dump` keeps the audio thread's events from each press's first
  400 ms. `--bundles <dir>` serves another commit's generated bundles: run
  from `main`, it measures "before" only, and the "after" rows need the
  `generated/` folder of `5a31f33` passed this way.
- **The songs.** `bench` is the issue's,
  `song('8-3ins', { parts: 8, inserts: 3, sends: true })` from the
  performance assessment: eight Chord Player pads on `pad-drift`, three
  inserts a strip rotating through every kind in that song's list (the pump is
  not in it), both sends. `drums` is the
  same desk with a kit in the parts: eight drum voices (kick, snare, clap, two hats, rimshot,
  ride, tom) on fixed
  Euclidean lines at sixteenths, each strip with the inserts the bench
  song's strip in that slot has.
- **`coldProbe.mjs`** (Node, one child process a case, so each starts with
  a cold V8): evaluates one generated bundle as the scope does, constructs
  one processor (timed: the warm-up ran inside the constructor), renders
  1 000 silent quanta (the wait before ▶), then 6 000 of signal (an FM
  part's notes: sixteenths on a drum, a triad a bar on the pad; noise for
  the rest), timing each `process`. The steady cost is the median of the
  last 2 000 quanta; the cold cost is the first quanta's excess over it.
  `--twin n` first renders `n` quanta through a throwaway processor of the
  same class: an ideal warm-up of that length, which a real scope cannot
  build (a processor exists only inside a node's construction), used to
  size the real one. `--bundles <dir>` as above. Its arguments are plain
  arrays, the Node harness's shapes.
- **`argumentMaps.mjs`** (Chromium with `--js-flags=--allow-natives-syntax`)
  compares the V8 maps of what Chromium hands `process` with the warm-up's
  scratch arguments. It imports `worklet/warmUp.ts`, which exists only on
  the WIP commits.
- **`report.mjs`** prints the tables below from `results/`. The `--dump`
  files (3 to 6 MB) are not committed; their summaries are quoted below.

## What was cold (decision 1)

The first ▶ on the bench song, before (`--dump`, two runs):

- One quantum about 60 ms after ▶, when the first notes land, took **12.5
  ms** in one run and **8.2 ms** in the other, then 5.4 and 3.4 ms, then
  2–3 ms for about ten quanta. The budget is 2.9 ms at 44.1 kHz, and the
  device, asking for 256 frames with 13.7 ms of playout delay, ran dry.
- Inside the 12.5 ms quantum: **80 lazy compiles** (`V8.CompileCode`,
  3.4 ms: parsing and Ignition bytecode for functions that had never run),
  23 deoptimisations, and 11.8 ms of `process` calls, the longest one 4.0
  ms (an FM part's first notes). In the other run, 87 lazy compiles took
  2.3 ms and optimised-code installs 2.7 ms.
- The second ▶ of the same session compiled nothing and installed nothing.

Per processor (`coldProbe.mjs`, before), the first quantum of signal after
1 000 idle quanta cost: an FM part 1.5 ms on a drum and 2.1 ms on the pad
(steady 2–3 µs and 32 µs), bloom 1.1–1.4 ms, the tape 0.9–1.0 ms, the
compressor, the delay and the phaser 0.36–0.39 ms each, the filter 0.14 ms,
the plate 0.12 ms, the meter bank 0.15 ms. Eight parts' first notes in one
quantum, plus the inserts their signal wakes, is the 8–12 ms quantum.

How long a warm-up needed, from a throwaway processor run first (main's
bundles, 48 kHz; first quantum µs / ms the warm-up itself took):

| Processor | 8 quanta | 32 quanta | 128 quanta |
|---|---:|---:|---:|
| fm tr909-kick | 125 / 3.4 | 133 / 4.7 | 59 / 9.0 |
| fm tr909-hat-closed | 143 / 3.9 | 147 / 4.9 | 106 / 8.4 |
| fm tr909-snare | 126 / 3.6 | 128 / 5.1 | 57 / 9.9 |
| fm tr808-tom-mid | 129 / 3.8 | 123 / 5.1 | 60 / 9.4 |
| fm pad-drift | 220 / 6.3 | 204 / 8.5 | 205 / 16.5 |
| eq | 2 / 0.7 | 1 / 1.1 | 2 / 1.7 |
| compressor | 65 / 1.2 | 82 / 1.8 | 50 / 3.0 |
| delay | 31 / 1.8 | 21 / 2.3 | 18 / 3.9 |
| filter | 6 / 0.9 | 190 / 1.2 | 4 / 1.9 |
| phaser | 27 / 1.7 | 16 / 2.3 | 13 / 3.9 |
| tape | 181 / 6.6 | 166 / 10.9 | 174 / 27.8 |
| advanced-drive | 85 / 3.8 | 82 / 5.8 | 73 / 12.7 |
| retro-reverb | 10 / 2.9 | 11 / 4.1 | 11 / 5.6 |
| bloom | 86 / 8.1 | 87 / 11.6 | 84 / 17.2 |
| pump | 26 / 1.1 | 26 / 1.8 | 28 / 2.4 |
| plate (reverb) | 61 / 5.4 | 65 / 6.5 | 61 / 17.7 |
| output stage | 10 / 0.6 | 2 / 1.1 | 2 / 1.5 |
| part meter bank | 5 / 0.6 | 4 / 1.4 | 5 / 1.9 |

Eight quanta already took an FM part's first quantum from 1.5 ms to about
0.13: most of the cold cost is the first execution (compiling, the
interpreter), not reaching V8's top tier.

## What was built, and what was tried on the way

What was built (on the WIP commits; `worklet/warmUp.ts`,
`fm/fmWarmUp.ts`, `warmUpConstants.ts`, `fm/fmWarmUpTables.ts`):

- **At construction, on the audio thread, before any note** (decision 2).
  Each processor's constructor body moved into an `init` method (the EQ's
  into a function, since `eqDsp.test.ts` scans every prototype method for
  allocation), its fields became `declare`d, and the constructor ran
  `init`, the warm-up when due, and `init` again. The second `init` wrote
  every field the first wrote, so the processor was a fresh one: voices,
  envelopes, phases, LFOs, glides, smoothers, filters, seeds, sleep state
  and the load sampler (decisions 3 and 4). Nothing a song can hear
  advanced: the scope's `currentFrame` stands still inside a constructor,
  and the warm-up posted nothing. A test built a warmed and an unwarmed
  processor of each kind in one fresh scope and held their renders and
  posts to the bit (the FM part on `tr909-kick`, `tr909-hat-closed` and
  `pad-drift` with accented notes, a live retune and a patch message; the
  inserts on noise bursts with gaps). With the second `init` taken out, it
  failed. The goldens and every allocation test passed unchanged.
- **The FM part played its own patch**: two notes together, a note with an
  accent's mod and a slide, a whole velocity after fractions, each
  released, 16 quanta, through its own `noteOn`, `noteOffId` and `process`.
  Keyed once a scope by the patch and the lane slots it was built with
  (decision 7): a rebuild of the same song warmed nothing, a part with a new
  patch warmed what was new. It sent no message: a note message built at
  construction shares the map of the port's messages and set their `frame`
  field from the construction frame, and the FM allocation probe's runs
  past 2^31 then boxed (3.5 KB a tenth). Messages of a class of its own
  instead made all 13 FM allocation runs fail.
- **Each worklet insert kind's first processor in a scope** (all but the
  plate and the pump, below) rendered 16 quanta through its own `process`
  at its own `parameterData`: 12 of noise at a peak of 0.25 into the program
  input, then 4 of silence. The tape's run also moved Drive (to +6 at
  quantum 4, to −3 at 10): without the glide in the run, the tape's
  switching allocation run (`tapeAllocation.test.ts`) boxed 6 MB, because
  the optimised code then left the per-sample `driveGain` call out of its
  caller during a later Drive glide.
- **The scratch arguments took the host's shapes.** Chromium hands `process`
  frozen holey arrays and one frozen parameter object built key by key in
  descriptor order; `argumentMaps.mjs` showed the scratch had exactly those
  maps in Chromium, and that literals do not. Under the Node harness (no
  `AudioWorkletGlobalScope`) the scratch was plain arrays, as the harness
  passes. A warm-up on Chromium's shapes made every allocation probe, which
  passes plain arrays, allocate 2.8 MB in its first measured tenth.

Tried and dropped:

- **One script of many patches** (a drum, a pad with every LFO, an acid
  line, a formant, hard sync, a notch) warmed every path at once, but the
  kernel's optimised code then ran slower for every patch: `pad-drift`'s
  steady cost rose from 31.9 to 37.5 µs a quantum (+17 %) and the kick's
  from 3.4 to 3.9 µs in the Node probe, and the warm-up took 47 ms. A drum
  alone left both unchanged. Warming the paths the song takes, and only
  those, keeps the feedback a subset of what the song itself gives
  (decision 6).
- **Warming at the first quantum** on copies of that quantum's own
  arguments (shapes guaranteed, messages held until the warm-up ran) broke
  every test that keeps a reference to a processor's internals across its
  first quantum (the allocation scenarios hold `processor.voices`; 75 tests
  read `.dsp`), since the second `init` replaces them.
- **The plate** did not warm. Its tank render is one large function with
  a sample loop, and 16 quanta left it mid-way through V8's tiering: at
  48 kHz the first loud quantum after the silence took 66 µs where an
  unwarmed plate took 121, but at 44.1 kHz it took 520 µs against 118, a
  deoptimisation on the wake (three runs each). Sending it to sleep and
  waking it inside the run (`clear`) did not help; 48 quanta helped in one
  run of two at 44.1 kHz; 96 helped at both rates but cost 17 ms of build
  for one processor. Unwarmed, its cold cost is spread thin (about 0.12 ms
  on the first loud quantum, about 6 ms over the first 100).
- **The pump** did not warm. Its allocation probe sits at 16 320 of its
  16 384-byte bound on main, and every warm-up tried moved 120 bytes into
  one tenth. It is in neither bench song.
- **32 quanta instead of 16** (FM and inserts, with the plate then still
  warming): first-▶ underruns in 2 of 10 bench runs against 0 of 10 at 16,
  and a larger build burst (12 against 10 device underruns).

## Results

The cold-start table (`report.mjs`). Medians (min–max); "runs with a device
underrun" counts runs. `after` and `more` are the measured state `5a31f33`;
`length16` and `length32` the earlier state `0582ec7` (the plate also
warming) at the two run lengths.

| Song | Rate | Bundles | Runs | Build: device | Build: DSP | Build: device ms | First ▶: device | First ▶: DSP | First ▶: runs with a device underrun | First ▶: worst quantum, ms | Second ▶: device | Second ▶: DSP |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bench | 44100 | before | 6 | 4 (4–5) | 0 (0–0) | 23 (23–29) | 3 (0–5) | 1 (0–1) | 5/6 | 11.0 (6.5–12.5) | 0 (0–0) | 0 (0–0) |
| bench | 44100 | after | 6 | 10 (9–10) | 0 (0–0) | 58 (52–58) | 0 (0–2) | 0 (0–0) | 1/6 | 4.1 (2.5–7.0) | 0 (0–0) | 0 (0–0) |
| bench | 44100 | more | 10 | 9 (8–9) | 0 (0–0) | 49 (46–52) | 0 (0–2) | 0 (0–0) | 1/10 | – | 0 (0–0) | 0 (0–0) |
| bench | 44100 | length16 | 10 | 10 (9–11) | 0 (0–1) | 58 (52–64) | 0 (0–0) | 0 (0–0) | 0/10 | – | 0 (0–0) | 0 (0–0) |
| bench | 44100 | length32 | 10 | 12 (11–13) | 0 (0–0) | 70 (64–76) | 0 (0–1) | 0 (0–0) | 2/10 | – | 0 (0–0) | 0 (0–0) |
| bench | 48000 | before | 6 | 5 (4–5) | 0 (0–0) | 29 (23–29) | 5 (3–5) | 1 (0–1) | 6/6 | 12.3 (10.3–13.0) | 0 (0–0) | 0 (0–0) |
| bench | 48000 | after | 6 | 11 (9–11) | 0 (0–0) | 61 (52–64) | 0 (0–1) | 0 (0–0) | 1/6 | 5.1 (4.1–6.5) | 0 (0–0) | 0 (0–0) |
| drums | 44100 | before | 6 | 5 (4–5) | 0 (0–0) | 29 (23–29) | 0 (0–0) | 0 (0–1) | 0/6 | 4.2 (2.8–6.7) | 0 (0–0) | 0 (0–0) |
| drums | 44100 | after | 6 | 11 (10–12) | 0 (0–0) | 64 (58–70) | 0 (0–0) | 0 (0–0) | 0/6 | 2.0 (1.7–3.0) | 0 (0–0) | 0 (0–0) |
| drums | 48000 | before | 6 | 5 (4–6) | 0 (0–0) | 29 (23–35) | 0 (0–0) | 0 (0–0) | 0/6 | 6.0 (2.7–6.5) | 0 (0–0) | 0 (0–0) |
| drums | 48000 | after | 6 | 12 (11–13) | 0 (0–0) | 70 (64–76) | 0 (0–0) | 0 (0–0) | 0/6 | 2.3 (1.6–2.8) | 0 (0–0) | 0 (0–0) |

So the first ▶ was not yet as clean as the second (the issue's acceptance
criterion): 3 of 22 bench runs at the measured state still had one or two
device underruns on it, where the second ▶ had none in any run. The drum song had
none at its first ▶ before the warm-up either.

**Build cost.** On the audio thread the warm-ups added, per processor
(`coldProbe.mjs`, construction before → after, 44.1 kHz): an FM part 1.3 →
4.8–5.4 ms on a drum and 7.8 ms on the pad (once per patch a scope, about
1–2.6 ms for each further drum patch once the code was warm), the tape
2.7 → 9.4, bloom 3.4 → 10.6, the Advanced Drive 0.6 → 5.1, the retro reverb
1.0 → 4.0, the delay, the compressor and the phaser about +2, the EQ and the
filter about +1.1 (once per kind a scope). The bench song's build burst went
from 23–29 to 46–58 ms of device underrun, the drum song's (eight patches)
from 23–35 to 58–76 ms.

**Steady render.** Two ways (decision 6):

- The second ▶'s mean render span a quantum in Chromium (whole graph, µs),
  two rounds of six runs: round 1 at `0582ec7`, round 2 at `5a31f33`.

  | Song | Rate | Before | After, round 1 | After, round 2 |
  |---|---|---:|---:|---:|
  | bench | 44100 | 1305 (1205–1378) | 1374 (1285–1393), +5.3 % | 1362 (1350–1383), +4.4 % |
  | bench | 48000 | 1330 (1270–1344) | 1346 (1332–1358), +1.2 % | 1317 (1310–1329), −1.0 % |
  | drums | 44100 | 1011 (873–1098) | 1168 (1080–1197), +15.6 % | 1127 (1089–1158), +11.6 % |
  | drums | 48000 | 1114 (821–1130) | 1110 (1078–1122), −0.4 % | 1095 (1037–1116), −1.7 % |

  The runs are bimodal (the before drums at 44.1 kHz read 873, 875, 999,
  1022, 1088 and 1098 µs), so the noise is of the order of the change; but
  the drum song read higher at 44.1 kHz in both rounds and in no round
  lower.
- Each processor alone in Node (median of three runs, µs a quantum, before
  → after, 44.1 kHz): the FM part 3.4 → 3.4 (kick), 2.0 → 2.0 (hat), 3.1 →
  3.1 (snare), 3.0 → 3.0 (tom), 32.8 → 32.8 (pad); the compressor 3.6 → 3.8,
  the delay 11.1 → 12.1 (11.7 → 11.5 at 48 kHz), the tape 166.0 → 164.7,
  bloom 29.9 → 29.7, the rest within 0.5 µs. No processor alone was slower
  beyond its run-to-run spread.

Per processor in full, before → after, medians of three runs
(`coldProbe.mjs`):

44.1 kHz

| Processor | Construct, ms | First quantum of signal, µs | Excess over steady, first 10 quanta, ms | First 100, ms | Steady, µs a quantum |
|---|---:|---:|---:|---:|---:|
| fm tr909-kick | 1.29 → 4.78 | 1540 → 181 | 2.07 → 0.55 | 5.66 → 3.10 | 3.4 → 3.4 |
| fm tr909-hat-closed | 1.37 → 5.35 | 1605 → 187 | 2.40 → 0.88 | 5.83 → 3.89 | 2.0 → 2.0 |
| fm tr909-snare | 1.25 → 4.96 | 1568 → 176 | 2.27 → 0.63 | 6.97 → 4.42 | 3.1 → 3.1 |
| fm tr808-tom-mid | 1.53 → 5.25 | 1582 → 177 | 2.27 → 0.62 | 6.38 → 4.45 | 3.0 → 3.0 |
| fm pad-drift | 1.27 → 7.80 | 2129 → 212 | 4.67 → 0.82 | 9.81 → 5.53 | 32.8 → 32.8 |
| eq | 0.22 → 1.39 | 2 → 2 | 0.01 → 0.01 | 0.03 → 0.03 | 0.5 → 0.5 |
| compressor | 0.17 → 1.97 | 390 → 53 | 0.73 → 0.38 | 1.52 → 1.13 | 3.6 → 3.8 |
| delay | 0.15 → 2.31 | 379 → 32 | 0.99 → 0.14 | 1.60 → 0.68 | 11.1 → 12.1 |
| filter | 0.18 → 1.32 | 140 → 5 | 0.32 → 0.02 | 0.82 → 0.20 | 1.4 → 1.4 |
| phaser | 0.14 → 2.20 | 372 → 28 | 1.02 → 0.14 | 1.72 → 0.72 | 11.3 → 11.3 |
| tape | 2.65 → 9.37 | 940 → 196 | 1.31 → 0.03 | 1.97 → 0.19 | 166.0 → 164.7 |
| advanced-drive | 0.62 → 5.06 | 124 → 84 | 0.49 → 0.14 | 1.42 → 0.95 | 58.3 → 58.8 |
| retro-reverb | 1.03 → 4.02 | 29 → 13 | 0.09 → 0.02 | 0.68 → 0.09 | 7.3 → 7.3 |
| bloom | 3.44 → 10.61 | 1102 → 73 | 2.78 → 0.80 | 7.50 → 3.26 | 29.9 → 29.7 |
| pump | 0.38 → 0.40 | 81 → 89 | 0.57 → 0.60 | 0.99 → 0.96 | 1.3 → 1.3 |
| plate (reverb) | 0.41 → 0.40 | 118 → 114 | 0.67 → 0.70 | 6.28 → 6.07 | 21.4 → 21.4 |
| output stage | 0.22 → 0.21 | 40 → 41 | 0.12 → 0.11 | 0.17 → 0.16 | 0.9 → 0.9 |
| part meter bank | 0.08 → 0.08 | 149 → 144 | 0.43 → 0.42 | 1.18 → 1.12 | 3.6 → 3.6 |

48 kHz

| Processor | Construct, ms | First quantum of signal, µs | Excess over steady, first 10 quanta, ms | First 100, ms | Steady, µs a quantum |
|---|---:|---:|---:|---:|---:|
| fm tr909-kick | 1.33 → 4.89 | 1530 → 194 | 2.05 → 0.56 | 6.14 → 3.06 | 3.4 → 3.3 |
| fm tr909-hat-closed | 1.27 → 5.23 | 1550 → 187 | 2.38 → 0.93 | 5.99 → 3.59 | 1.8 → 1.9 |
| fm tr909-snare | 1.27 → 5.08 | 1542 → 186 | 2.24 → 0.66 | 7.42 → 4.30 | 3.0 → 3.0 |
| fm tr808-tom-mid | 1.42 → 5.29 | 1580 → 180 | 2.27 → 0.62 | 6.28 → 4.41 | 3.0 → 3.0 |
| fm pad-drift | 1.24 → 7.76 | 2139 → 215 | 4.70 → 0.84 | 9.80 → 5.57 | 32.1 → 31.9 |
| eq | 0.21 → 1.36 | 2 → 2 | 0.01 → 0.00 | 0.03 → 0.03 | 0.5 → 0.5 |
| compressor | 0.16 → 1.94 | 364 → 63 | 0.71 → 0.38 | 1.47 → 1.17 | 3.9 → 3.8 |
| delay | 0.15 → 2.24 | 377 → 29 | 0.98 → 0.13 | 1.53 → 0.62 | 11.7 → 11.5 |
| filter | 0.18 → 1.28 | 140 → 6 | 0.32 → 0.02 | 0.80 → 0.19 | 1.4 → 1.4 |
| phaser | 0.14 → 2.22 | 373 → 27 | 1.05 → 0.14 | 1.79 → 0.73 | 11.5 → 11.3 |
| tape | 2.71 → 9.31 | 983 → 183 | 1.39 → 0.03 | 1.85 → 0.36 | 165.5 → 164.9 |
| advanced-drive | 0.62 → 5.09 | 130 → 97 | 0.51 → 0.16 | 1.57 → 0.92 | 57.5 → 58.3 |
| retro-reverb | 1.06 → 3.95 | 31 → 11 | 0.09 → 0.01 | 0.68 → 0.07 | 6.9 → 7.0 |
| bloom | 3.54 → 10.28 | 1401 → 83 | 3.12 → 0.79 | 8.76 → 4.60 | 27.5 → 27.6 |
| pump | 0.38 → 0.38 | 82 → 80 | 0.58 → 0.62 | 1.00 → 1.00 | 1.3 → 1.3 |
| plate (reverb) | 0.41 → 0.42 | 121 → 116 | 0.68 → 0.66 | 6.17 → 6.26 | 21.4 → 21.3 |
| output stage | 0.22 → 0.22 | 47 → 46 | 0.11 → 0.11 | 0.16 → 0.14 | 0.9 → 0.9 |
| part meter bank | 0.08 → 0.07 | 148 → 143 | 0.44 → 0.41 | 1.19 → 1.14 | 3.3 → 3.3 |

At the first ▶ after the warm-up (`--dump`, bench, two runs at `0582ec7`):
one quantum over budget at about 60 ms (3.5 ms; 5.0 and 3.3 ms in the other
run), 4 lazy compiles (0.1 ms), about 2 ms of optimised-code installs. What
was left is the render's message reads and the voices' first notes in eight
parts at once, which the warm-up did not reach.

## Reach (decision 8)

| Path | Warmed? | Why |
|---|---|---|
| FM: every algorithm, operator wave (table, Noise, Saw D, Square D, Pulse, User), feedback, operator filters, sync (at 1× and at 2×), the Adv fields, the drive shapes, every filter mode and slope, the LFOs, the envelope loops | When a part's patch used it | The part played its own patch, so the warm-up reached exactly what that patch's notes take, the kernel or the generic loop as the patch decides; a 2× synced patch's sets are built at construction, so its warm-up ran at 2× too |
| FM: mono (a cut, a slide's handover, glide) and poly (two notes at once, a release under a held note) | Yes | The script overlapped its notes and slid one; a mono patch took the handover, a poly one an ordinary note |
| FM: a song lane's slot | When the part was built with one | Its slot map is in the part's options; the warm-up ran with it and the slot at 0 |
| FM: the render's message reads (admitting, taking, a note-off overtaking its note-on) and a note-on inside a quantum | No | The warm-up sent no message (above); one function, `renderBlock`, ran in V8's baseline tier for the first few hundred quanta of the first ▶ |
| FM: a step's offsets, a stolen voice (a full pool), stop and panic | No | Not in the script: a step lane moves targets the song may never move, and a steal needs a full pool |
| FM: a patch sent by message after construction (a knob, a preset swap) | No | A live edit, not the first ▶ |
| Each worklet insert kind but the plate and the pump (EQ, compressor, delay, filter, phaser, tape, Advanced Drive, retro reverb, bloom) | Yes, the first of each kind in a scope, at its own settings | Once a kind (decision 7); a later instance of the kind at other settings (another filter mode, drive route, delay mode, EQ bands on) ran those branches cold on its first loud quantum |
| The plate (the Reverb insert and Send A) | No | Above: no run length tried left it reliably faster on its first loud quantum |
| An insert's wake from sleep | No | A fresh insert starts awake, and the warm-up did not run long enough to sleep; the asleep path is warm from the idle quanta before ▶ |
| The pump | No | Above: its allocation probe |
| The output stage, the part meter bank, the peak meter | No | Their `process` posts telemetry on a timer, so a warm-up would post readings from a scratch signal; each is one instance, and their cold cost is the smallest (tables above) |
| 44.1 and 48 kHz | Yes | Nothing in a warm-up depends on the rate; both are measured above |

## Why it was not adopted

tacowars's decision, after the numbers above
(`docs/log/2026-10-16-no-worklet-warm-up.md`):

- **The gain is on the pad bench only.** Its first-▶ underruns fell from 3
  (0–5) a run in 11 of 12 runs to one or two in 3 of 22; the drum song,
  the music Windsor is for, had none to remove (0 of 12 runs before).
- **It costs the drum song.** Its steady render read +15.6 % and +11.6 % at
  44.1 kHz in two rounds (−0.4 % and −1.7 % at 48 kHz), within a bimodal
  noise but never lower; and its build burst more than doubled (23–35 ms of
  device underrun to 58–76 ms; 4–6 underruns to 10–13).
- **Upkeep.** Every processor would have to keep an `init`-twice rule, with
  `declare`d fields, so the compiler no longer checks that a field is
  assigned; the same constructor block was pasted into 11 processors; the
  shipped scratch shapes branch on whether the scope is real, so the Node
  tests do not run the path Chromium runs; and it carries special cases tuned
  to V8 (the tape's Drive moves, the excluded pump and plate).
- **The false alarm is handled elsewhere.** windsor#835's settling window
  already stops the CPU meter's toast about the first ▶.
