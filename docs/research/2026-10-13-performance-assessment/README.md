# Performance assessment: a 16-part song with inserts, on the audio thread

Date: 2026-10-13. Branch `claude/performance-analysis-optimization-26r8zl`.

tacowars asked, with the product near feature-complete, whether the engine
has room to spare at 16 parts with effects inside the render quantum
(2.67 ms at 48 kHz, 2.9 ms at 44.1 kHz), and if not, where the cost is and
what would buy headroom. This is that assessment: a reading of the hot
paths against the research already on file, and a bench of the whole graph
as the app builds it, run in a headless Chromium in this session's
container. It changes nothing under `packages/`.

**Every number below names its machine.** This container is a 4-core
Intel Xeon at 2.8 GHz with no audio device, running Chromium 141 headless
with the sandbox off (`cdp.mjs`), driven from Node 22. It is slower
single-threaded than the Apple M1 and M4 Pro of the earlier records and is
not the target box. Ratios between cases on this machine, and the shape of
the cost, are the result; the absolute microseconds are this machine's.

## In short

- **The DSP is efficient; the graph at 16 parts with effects is not
  affordable, and the inserts are why.** The voices, the worklets and the
  plate are allocation-free, specialised, dormancy-aware and bit-pinned;
  the earlier records show that work paid off. What the records had not
  measured is the whole graph: here, 16 parts holding chords with no
  inserts render at 65–71 % of the quantum budget; one insert a part puts
  the audio thread at 155 % and the output falls behind real time; three a
  part at 320 %. Scaled by this machine's measured 2.3× against an M1 (the
  FM kernel in Node, 87 ns against 37 ns a voice-sample), an M1 holds the
  no-insert song at about 30 % and a one-insert-a-part song at about 70 %,
  and three a part does not fit there either. So: at 16 tracks with a
  modest rack each there is room on a fast laptop and none on a slow one;
  with the dear kinds there is none anywhere.
- **Every worklet insert but the EQ and the plate renders its full DSP on
  silence.** 48 inserts on 16 parts that play nothing cost 1 600 ms of
  render time per second of audio here, 60 % of what they cost under
  signal, and the tape, the Advanced Drive, the delay and the retro reverb
  cost the same silent as sounding. Muted and soloed-out parts render
  their chains too (the gate is after them). A sleep with a tail per kind,
  on the plate's pattern, is the largest single saving available, and it
  touches no sound while a part plays.
- **Four kinds cost 4–15× the rest**: the tape at 2× (0.48 ms of a 2.67 ms
  quantum per instance here, about 0.2 ms on an M1), the Advanced Drive,
  bloom and the plate reverb as a strip insert. These were chosen with
  research and sound right; at 16 parts their number, and whether they
  sleep, decides whether a song plays. Cheaper modes exist for two of them
  (the tape's and the drive's 1× settings) and sharing on a group or a send
  costs one instance.
- **The fixed tax is second-order**: 16 idle parts, their strips and the
  standing graph cost 17 % of a core here (about 7 % on an M1), of which
  the FM part's eleven k-rate parameters are the largest piece and the
  strip's eleven native nodes are cheap. Worth trimming only after the
  inserts.
- **The CPU meter under-reads at the point that matters**: it reads 65 %
  while the thread is at 317 % and the audio clock runs at a third of wall
  time, because it times only the inside of `process()`. The audio clock's
  rate and `playbackStats`, both free on the main thread, would say when
  the render is losing.
- **One audio-thread stall the tests do not see**: a `patch` message
  rebuilds wave sets in the worklet's `onMessage`, and an uncached set
  (each Tone step, each user-wave edit, the 2× sets of a synced patch)
  costs 2–5 ms to build here, over the quantum budget, on every step of a
  knob drag. Warming the patch's keys or building on the main thread
  removes it.
- **The main thread is fine**: a knob tick costs 1–3.5 ms on a 16-part
  song against 95 ms of scheduling slack, and the scheduler, lanes and
  envelopes were measured cheap before. Collections on the audio thread
  are rare and short after the allocation work.

The ranked strategies are at the end; the first three (insert sleep, a
budget and cheaper modes for the dear kinds, a truthful meter) are where
the headroom is.

## What was already known

The repository's own research, all on Apple M1 or M4 Pro, headless Chrome
152–155 unless said otherwise:

| Finding | Where |
|---|---|
| The FM voice kernel costs about 35–40 ns a voice-sample on an M1 in Node for a four-operator pad (`pad-drift`, 3 voices, 10 s: 53 ms), half the generic loop's cost; a synced or two-Noise voice falls back to the generic loop at 2.5–2.9× | `2026-09-23-645-voice-split-bench`, `2026-10-02-noise-operator-cost` |
| Dormant voices and the plate's sleep: a held pluck's part fell from 170 ms to 10–15 ms per 10 s; a silent plate from 600 ms to 95 ms per 60 s | `2026-09-15-547-dormant-voices-plate-sleep` |
| The adaptive control interval (32 or 128 samples a voice) saved 25–28 % on pads and nothing on drums | `2026-10-03-adaptive-control-interval` |
| Chrome charges 0.6–1.0 µs a quantum per declared k-rate AudioParam, read or not. 16 parts × 8 slots cost 3–4 % of a core; per-target parameters (29 a part) would have cost 12–21 % and pushed a 16-pad song past real time | `2026-10-01-automation-param-cost` |
| The 16-part `pad-drift` song (48 held voices, no inserts) rendered at 820–1 410 µs a quantum live on an M1, 28–49 % of the budget; the same song with the patch's `spread` 12 (96 voices) did not play in real time in headless Chrome (clock at 0.79) | `2026-10-03-always-on-part-meters`, `2026-10-01-automation-param-cost` |
| The dense song (8 parts, 20 worklet inserts) rendered at a median 1 923 µs, p99 2 445 µs, max 3 492 µs against a 2 902 µs budget on a loaded M1: a few quanta over in 20 s, before the allocation fixes | `2026-09-30-worklet-gc-in-chrome` |
| Every worklet insert and the FM part now allocate nothing per quantum while notes are held; the note-on path still allocates a few hundred bytes a note while V8 keeps it in its lower tiers; the audio thread collected 0–1.3 times a second after the fixes | `2026-09-30-worklet-gc-in-chrome` (the "after" sections), `2026-09-30-load-sampler-allocation` |
| A worklet node costs about 1.2 ms of render time per second of audio in Chrome's offline backend (the output stage's `off` mode), most of it Chrome's per-node work, not the loop | `2026-09-29-output-stage-cost`, `2026-09-30-part-strip-meters` |
| 16 part meters as one multi-input node cost 0.54–0.67 of 16 separate nodes; shipped as the part meter bank | `2026-10-03-always-on-part-meters` |
| The output stage's default limiter costs about 0.15 % of a core; the clippers about 0.4 % | `2026-09-29-output-stage-cost` |
| The main thread's scheduling is cheap: 128 bent lanes at tick resolution cost 5–7 ms a second of song; sequencer lanes 0.12 µs a tick a part; 32 roll envelopes 13 µs a tick | `2026-10-01-automation-param-cost`, `2026-10-03-seq-lane-scheduler-cost`, `2026-10-11-roll-envelope-cost` |
| The load meter is a `Date.now()` duty-cycle sampler that over-reads 2–3× and cannot see Chrome's per-node or per-parameter work outside `process()`; `underruns` is a lower bound | `2026-09-11-445-audio-bench-arm`, `cost/audioLoad.ts` |

So the DSP itself has been worked hard: the worklets are allocation-free,
bit-pinned, dormancy-aware and specialised. What had not been measured is
the **whole graph at 16 parts with inserts**, which is the question asked.

## The graph a 16-part song builds

Read from `synth/fmEngine.ts`, `mixer/channelStrip.ts`, `mixer/stripTap.ts`,
`mixer/stereoRotate.ts`, `mixer/returnBus.ts`, `system/standingGraph.ts`
and the insert factories.

**Per part, with no inserts:** one `AudioWorkletNode` (`fm-part`, 11 k-rate
parameters: `pitchBend`, `modWheel`, `gain`, `voiceSlot0`–`7`), then 11
native nodes: the low cut (`BiquadFilterNode`), the tap's head gain, the
audible gate, the rotation (a splitter, four gains, a merger) and one send
gain per return (two). The part's own fader is the worklet's `gain`
parameter, so it costs no node. The strip's peak meter is lazy and the
app meters every part through the one part meter bank instead.

**Standing:** the music bus (two gains and a highpass), the song master
(three gains and its chain), two returns (three gains and a chain each:
Send A holds a plate reverb worklet, Send B an echo of five native nodes),
the aux fader, the engine master, the output stage worklet, and the part
meter bank (one worklet, 16 inputs) once the app lights the chips.

**Per insert:** every worklet kind wraps its processor in an input and an
output gain (three nodes); the plate reverb kind adds a send, a gate and a
bypass (six); the compressor a detector input. The native kinds are larger:
the chorus is 16 nodes (two voices of an oscillator, two depth gains and two
delays, plus the splitter, merger, wet, dry, in and out), the ensemble 39
(three modulated delay lines, two quadrature oscillator pairs on constant
sources, twelve weight gains, the tone biquad and the mix), the classic
drive 7 and the echo 6 plus its five-node delay loop.

**At 16 parts, three inserts each, both sends:** 16 FM processors (176
k-rate parameters), 48 insert stages (about 150–200 nodes, 40-odd of them
worklet processors), 176 strip nodes, the standing graph: roughly
**350–400 native nodes and about 60 worklet processors**, and 28 `Voice`
objects per part (12 sounding plus a steal reserve of 16; only active
voices cost render time).

Chrome's audio thread walks that whole graph every quantum. Each native
node is cheap, each worklet call carries a fixed cost, and each declared
parameter a fixed cost, before any DSP runs.

## Method

`bench.mjs` (from the repo root, Node 22 or later, the Chromium path in
`WINDSOR_CHROME`) bundles `page.mjs` with esbuild over the real engine and
the app's `DocumentModel`, serves the engine's generated worklet bundles
byte for byte, and drives a headless Chromium of its own over the DevTools
protocol (`cdp.mjs`). `songs.mjs` builds the load cases in the page as
version-15 documents from the shipped `pad-drift` patch: every part a
Chord Player striking one three-note chord a bar (gate 1) at 120 BPM.
The patch's operators release over 2.4 s and a bar is 2 s, so a part
carries its three new voices plus the previous chord's three in release
for most of each bar: about six voices a part at `spread` 0 (twelve at
the patch's own `spread` 12), each tail dropping out as it goes dormant.
The load is a steady one per part, not a fixed voice count, and no figure
below is a per-voice figure except the Node kernel render. `report.mjs`
prints the tables from `results/` and refuses a results file from another
machine or browser.

- **Offline** (`bench.offline`): the engine's own `renderSong` at 48 kHz,
  the export path, which builds the same parts, strips, returns and master
  as live playback on an `OfflineAudioContext` and renders as fast as the
  graph allows. Wall time per second of audio is the graph's render-thread
  cost; 10 ms a second is 1 % of a core. 8 bars at 120 BPM plus a 1 s
  tail. Cases: 16 silent parts (every voice inactive, so the graph alone)
  with and without three inserts each; 1, 4, 8 and 16 playing parts with
  no inserts; 16 parts at the patch's `spread` 12 (twice the voices);
  16 parts with sends; with one insert each; with three inserts each plus
  an EQ and a compressor on the master; and 8 parts with three each.
- **Kinds** (`bench.kind`): 16 playing parts with one insert of one kind
  each, 4 bars, and the same with the parts silent, for every registered
  kind: each kind's cost × 16, with and without signal. The baseline is
  the same 4-bar song with no insert (`none`), playing and silent; the
  first round, taken before that case existed, is read against the 8-bar
  offline cases, which is why its row ranges are wider.
- **Live** (`bench.startLive`): the song as the app plays it (`FmEngine`,
  `AudioSystem`, `initMusic`, `startMusic`, the part meter bank on, the
  load meter on, the 25 ms pump), looped, on a real-time `AudioContext`.
  After 4 s a 12 s trace of `webaudio` and `disabled-by-default-v8.gc`
  gives every `RealtimeAudioDestinationHandler::Render` on the
  `Realtime AudioWorklet thread`: one event per 128-frame render of the
  whole graph, its `dur` the quantum's wall time. The first 0.5 s is left
  out. The audio clock's rate against wall time says whether the render
  kept up.
- **Micro** (`bench.micro`): node-only cases on an offline context, 20 s
  at 48 kHz, 16 of each: a bare worklet with 0, 3, 11 and 27 k-rate
  parameters; the shipped FM part idle; the strip's native chain as shipped
  fed by a constant source; the same signal through one gain; the head,
  gate and rotation alone.
- **Main thread** (`bench.mainThread`): on the 16-part, three-insert song,
  the median of 30 calls of what one knob tick costs the console:
  `DocumentModel.merge` of a patch and of a strip level (the merge and the
  whole-document renormalise every `ctx.change` makes), `toJson` (which
  the autosave's `changed` check reads after every change), and the
  engine's `AudioSystem.apply` of the same partials.

Every case has three runs (the main-thread case five), from two
invocations: one single-round invocation per kind of case
(`--only offline`, `--only kinds`, `--only live`, `--only micro`, and
`--rounds 3 --only main`), then one two-round invocation of everything,
with the cases rotated by the round index inside each invocation. So the
runs are not three rotations of one protocol; the first run of each case
and the next two come from different sessions a few minutes apart, and
the kinds' first run predates the `none` baseline. The medians and ranges
are over those runs; the environment (the same container and Chromium
throughout; the engine code is the same under both commits the files
name, since nothing under `packages/` changed) is checked by `report.mjs`.
The machine was otherwise idle (one-minute load average in each result
row). Raw results are in `results/`.

## Results

### Offline: the whole graph, ms of render time per second of audio (median over rounds, min–max)

| Case | Parts | Runs | ms per audio second | % of one core | Peak |
|---|---:|---:|---:|---:|---:|
| 16-silent | 16 | 3 | 168.0 (151.3–182.3) | 16.8 | 0.000 |
| 16-silent-3ins | 16 | 3 | 1769.3 (1755.8–1895.8) | 176.9 | 0.000 |
| 1-none | 1 | 3 | 86.9 (83.2–100.0) | 8.7 | 0.707 |
| 4-none | 4 | 3 | 189.8 (178.0–210.5) | 19.0 | 0.891 |
| 8-none | 8 | 3 | 334.1 (326.2–347.6) | 33.4 | 0.891 |
| 16-none | 16 | 3 | 651.5 (624.9–679.9) | 65.2 | 0.891 |
| 16-spread | 16 | 3 | 1034.5 (1027.3–1186.0) | 103.4 | 0.891 |
| 16-sends | 16 | 3 | 693.2 (673.5–693.4) | 69.3 | 0.891 |
| 16-1ins | 16 | 3 | 1549.6 (1468.5–1568.8) | 155.0 | 0.891 |
| 16-3ins | 16 | 3 | 3236.4 (3126.5–3318.1) | 323.6 | 0.891 |
| 8-3ins | 8 | 3 | 1658.6 (1581.7–1734.5) | 165.9 | 0.822 |

### Kinds: 16 parts with one insert of the kind each, ms per audio second; the per-insert column subtracts the 16-part song without inserts and divides by 16

| Kind | Playing, ms/s | Per insert, ms/s | Per insert, µs a quantum | Silent input, ms/s | Per silent insert, ms/s |
|---|---:|---:|---:|---:|---:|
| tape | 3642 (3459–3787) | 180.3 | 481 | 2318 (2133–2426) | 131.7 |
| advanced-drive | 2824 (2743–2833) | 129.2 | 344 | 2290 (2212–2372) | 130.0 |
| bloom | 2646 (2469–2957) | 118.0 | 315 | 406 (355–528) | 12.2 |
| reverb | 1925 (1839–2112) | 73.0 | 195 | 577 (558–604) | 23.0 |
| ensemble | 1188 (1095–1271) | 26.9 | 72 | 539 (507–563) | 20.6 |
| phaser | 1148 (1097–1152) | 24.4 | 65 | 549 (544–602) | 21.2 |
| eq | 1083 (941–1105) | 20.3 | 54 | 447 (436–473) | 14.8 |
| retro-reverb | 1065 (997–1127) | 19.2 | 51 | 518 (485–552) | 19.3 |
| compressor | 970 (900–1089) | 13.3 | 35 | 391 (364–400) | 11.3 |
| filter | 946 (914–958) | 11.8 | 31 | 248 (228–253) | 2.4 |
| delay | 930 (929–1115) | 10.8 | 29 | 405 (403–439) | 12.2 |
| echo | 928 (860–942) | 10.7 | 28 | 372 (325–489) | 10.1 |
| drive | 878 (798–981) | 7.5 | 20 | 357 (355–357) | 9.2 |
| chorus | 847 (845–908) | 5.6 | 15 | 334 (306–375) | 7.8 |

### Live: one render of the whole graph per quantum on the realtime audio thread, µs (median over rounds)

| Case | Runs | Rate | Budget µs | Mean | p50 | p95 | p99 | Max | Over budget / quanta | GC / s | Clock rate | Meter load % | Meter underruns |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 16-none | 3 | 44100 | 2902 | 2061 (1964–2111) | 1873 (1719–1957) | 3377 (3297–3421) | 4133 (3952–4592) | 10049 (7485–12054) | 1119 / 11916 | 0.0 (0.0–0.0) | 1.000 (0.999–1.000) | 50 (37–60) | 6 |
| 16-sends | 3 | 44100 | 2902 | 2134 (2054–2161) | 1926 (1891–1964) | 3423 (3048–3683) | 4275 (3908–4507) | 10400 (6976–22530) | 1160 / 11916 | 0.6 (0.5–0.6) | 1.000 (1.000–1.001) | 54 (53–57) | 5 |
| 16-1ins | 3 | 44100 | 2902 | 4403 (3982–4635) | 4019 (3579–4124) | 6510 (6340–6993) | 7960 (7901–9838) | 37308 (34543–38020) | 7686 / 7722 | 3.7 (3.0–5.3) | 0.639 (0.610–0.715) | 66 (64–67) | 19 |
| 16-3ins | 3 | 44100 | 2902 | 9199 (8293–9528) | 8364 (7621–8558) | 13638 (11820–13792) | 16487 (15936–17541) | 49258 (46501–55103) | 3777 / 3777 | 7.9 (4.8–8.5) | 0.311 (0.299–0.343) | 65 (64–68) | 23 |
| 8-3ins | 3 | 44100 | 2902 | 4672 (4221–4717) | 4161 (3966–4236) | 7030 (6255–7097) | 8401 (7380–8735) | 37257 (32933–44431) | 7383 / 7383 | 5.5 (4.3–9.0) | 0.603 (0.600–0.668) | 67 (67–68) | 23 |

### Micro: 16 of each on an offline context, ms per audio second (median over rounds)

| Case | ms per audio second | Per node, ms/s | Per node, µs a quantum |
|---|---:|---:|---:|
| empty | 0.5 (0.5–3.3) | 0.00 | 0.00 |
| fmIdle | 56.2 (44.3–56.5) | 3.48 | 9.29 |
| worklet0p | 10.4 (10.3–11.1) | 0.62 | 1.65 |
| worklet3p | 21.7 (19.0–33.6) | 1.32 | 3.53 |
| worklet11p | 49.7 (40.8–56.3) | 3.08 | 8.20 |
| worklet27p | 109.3 (90.8–110.2) | 6.80 | 18.15 |
| stripChain | 29.9 (27.4–36.8) | 1.84 | 4.90 |
| oneGain | 4.7 (3.6–6.1) | 0.26 | 0.71 |
| rotationOnly | 19.8 (18.1–24.3) | 1.21 | 3.23 |

### Main thread: one knob tick on the 16-part, three-insert song, ms (median of 30 calls, median over rounds)

| Call | ms |
|---|---:|
| mergeMs | 1.20 (1.10–1.70) |
| stripMergeMs | 0.60 (0.60–0.90) |
| toJsonMs | 0.10 (0.10–0.20) |
| applyPatchMs | 2.30 (2.10–3.80) |
| applyStripMs | 0.50 (0.50–0.80) |

Document: 52316 bytes of export text, 16 parts.


Notes on the tables:

- **Offline.** `16-silent` is the standing graph plus 16 idle parts and
  strips: 168 ms a second, 17 % of a core here, before a voice sounds.
  Each `pad-drift` part (a chord struck a bar over the last one's release,
  about six voices) adds about 32 ms a second over it, and `spread` 12
  (twice the voices) takes the song past real time on this machine.
  The 48 inserts of `16-3ins` add about 2 580 ms a second under signal and
  1 600 on silent parts; the cheap `16-1ins` rotation (an EQ, a compressor,
  a delay, a filter, a phaser, a tape… one each) adds 860. The peak column
  is the output stage's limiter ceiling (0.891, −1 dBFS): the summed song
  sits on the limiter throughout, as a loud mix would.
- **Kinds.** Per instance, under signal, with its wrapper nodes and
  parameters: the tape 180 ms a second (0.48 ms of a 2.67 ms quantum, one
  instance), the Advanced Drive 129, bloom 118, the plate reverb 73, then
  a step down to the ensemble, the phaser, the EQ and the retro reverb at
  19–27, and the compressor, filter, delay, echo, classic drive and chorus
  at 6–13. On a silent input the tape keeps 73 % of its cost, the Advanced
  Drive, the retro reverb and the delay all of it, the phaser 87 %, the
  compressor 85 %, the EQ 73 %; bloom and the filter drop to a tenth. The
  silent cost of the cheap kinds is mostly their fixed tax: two or three
  wrapper nodes, the worklet call and the declared parameters (the EQ's 51
  parameters are about 33 µs of its 40 µs a quantum silent).
- **Live.** The realtime context opened at 44.1 kHz (2 902 µs a quantum).
  With no inserts the 16-part song renders at a mean of 2 061 µs, 71 % of
  the budget, and keeps up (clock 1.000) although 9 % of its quanta run
  over: Chrome asks for two quanta a callback, and the long ones here are
  the container's scheduling (the thread's CPU time per quantum is within
  2 % of its wall time at the median, and the worst wall quanta are two to
  three times their CPU time). One insert a part puts the mean at 4 403 µs
  and the clock at 0.64: the render falls behind and the output is
  dropouts. Three a part reads 9 199 µs and 0.31. Collections stay rare
  (0–8 a second, 0.5 ms a second at most, the longest 0.6 ms) and are not
  what moves the mean. The app's own meter reads 50 % for the song that
  renders at 71 %, and 65 % for the one at 317 %: it counts only the
  processors' own `process()` time and saturates.
- **Micro.** Chrome's price list on this machine, per quantum: a worklet
  call about 1.7 µs, a declared k-rate parameter about 0.6 µs, a native
  node about 0.4 µs (with signal), the strip's chain of 11 native nodes
  4.9 µs, the FM part idle 9.3 µs (its 11 parameters are most of it). At 16
  parts: about 105 µs a quantum for the `voiceSlot` parameters alone, 80
  for the strips, 27 for the worklet calls.
- **Main thread.** One knob tick on a 16-part song: the document merge and
  whole-document renormalise 1.2 ms for a patch and 0.6 for a strip level,
  the export text 0.1 ms, the engine's live apply 0.5 ms for a strip and
  2.3 ms for a patch that all 16 parts share (one `setPatch` and one
  structured clone per part). Against the 120 ms look-ahead and the 25 ms
  pump, none of it threatens a note's timing.

## Reading of the hot paths

What the source says, checked against the numbers above.

**The DSP is in good shape, and that is not where the headroom is.** The
FM part, every worklet insert and the plate allocate nothing per quantum
while notes are held (the GC research's "after" traces, and the allocation
tests under `synth/` and `inserts/` pin it on V8). The kernel is
specialised, bit-pinned, skips silent operators, drops dormant voices and
lengthens its control interval when nothing is fast. The plate sleeps. No
double crosses a call on a render path. The remaining per-quantum garbage
is the note-on path, a few hundred bytes a note in V8's lower tiers, and
the load sampler's two `Date.now()` heap numbers; the audio thread
collects about once a second in a playing song and every collection lands
between renders. There is little left to win inside a voice-sample short
of a different algorithm.

**The cost at 16 parts is the graph, and above all the inserts.** Three
findings carry the assessment:

1. **An insert costs its full price on silence.** Of the ten worklet
   kinds, only the EQ (a bit-exact copy when flat, zeros when input and
   state are silent) and the plate reverb (sleep after its tail) look at
   their input before rendering; the tape, the Advanced Drive, bloom, the
   retro reverb, the phaser, the delay, the compressor and the filter run
   their whole DSP on zeros (`process()` in each `worklet/*/…Processor.ts`
   reads `inputs[0]` straight into the render). In the bench, 48 inserts
   on 16 parts that never play cost 1 600 ms of render time per second of
   audio, about 60 % of what the same inserts cost under signal. In a
   real song most parts rest most of the time: a drum part between hits,
   a pad between regions, a muted or soloed-out part (the gate closes
   after the inserts, so a muted part's chain still renders). A Chrome
   native node, by contrast, propagates silence and skips its work; a
   worklet is always called.

2. **The oversampled kinds are the dear ones.** The per-kind table below
   ranks them. The tape's magnetic core (an RK4 Jiles–Atherton step per
   sample at 2×, `TAPE_DEFAULTS.oversampling: 2`), bloom's 48-band
   analysis plus synthesis, the Advanced Drive at 2× and the two reverbs
   each cost many times a strip's whole native chain. These are product
   choices made on the M1 with their own research (four tapes in under half
   a quantum was the epic's target); the question at 16 parts is how many
   of them a song carries at once, and whether they stay awake on silence.

3. **The fixed tax of the graph is real but second-order.** Before any
   voice sounds, 16 idle FM parts with their strips and the standing graph
   cost 168 ms a second here (about 17 % of a core; about 7 % on an M1 by
   this machine's 2.3× factor). The micro cases put it in pieces: Chrome's
   per-worklet call about 1.7 µs a quantum, each declared k-rate parameter
   about 0.6 µs (the FM part's 11 parameters are most of its idle 9.3 µs),
   each native node about 0.4 µs, so the strip's 11 native nodes about
   4.9 µs a quantum and the 16 FM parts' 176 parameters about 105 µs. That
   is the price of the slot
   design windsor#346 chose, and it was the cheaper of the two designs
   measured; the parameters are the one piece of the fixed tax worth
   revisiting, the native nodes are not.

**The voices scale as expected.** 1, 4, 8 and 16 playing parts with no
inserts read 87, 190, 334 and 652 ms a second: about 32 ms a second (3 %
of a core here) per part over the idle graph, a chord struck a bar over
the last chord's 2.4 s release (about six voices sounding, three of them
in their tails), and `spread` 12 adds 376 ms for twice the voices. These
are per-part figures of that load, not per-voice ones. In Node on this
same machine the kernel renders held `pad-drift` voices at 87 ns a
voice-sample (4.2 ms a second per voice), against 37 ns on the M1 record,
so this container is about 2.3× slower than the M1 on the kernel; that
Node pair is the one per-voice figure here, and the M1 scaling rests on
it.

**Two main-thread paths can stall the pump.** The console's one change
path renormalises the whole document and re-serialises it after every knob
tick (`DocumentModel.merge` runs `makeArrangement` over the document, and
the autosave's `changed` check calls `toJson`); the bench's main-thread
table gives the cost on a 16-part song. The scheduler keeps 120 ms queued
and the pump runs every 25 ms, so a single main-thread task has about
95 ms of slack before a note posts late; the figures below are well
inside that on an idle page, and the gesture coalescing (`beginGesture`)
keeps the undo snapshot off the per-tick path. The other is on the
**audio thread**: a `patch` message is normalised, its macros compiled
and its wave sets rebuilt in the worklet's `onMessage`, between renders.
A cached wave set is a map hit, but `Tone` is quantised to twenty steps
and each new step, each new user-wave partial list and each new sample
rate is a fresh build: 2–5 ms a set on this machine in Node (a saw at a
new tone 3.1 ms, at the synced 2× rate 5.3 ms; a user wave of 32 partials
1.5 ms), one set per operator wave, on the thread that has 2.7 ms per
quantum. A Tone drag on a saw patch or a user-wave edit therefore pays a
build longer than the budget on every step, and `tapeAllocation`-style
tests do not see it because it is not a render. The load-time warm-up
covers only the four common waves at Tone 1.

**Latency and the device callback.** Chrome asks the graph for two quanta
per device callback at `latencyHint: 'interactive'` (256 frames, 5.3 ms at
48 kHz, `baseLatency` 5.3–5.8 ms in the records). A quantum over budget
is therefore not yet a glitch if its neighbour is short, which is why the
dense song's few quanta over 2.9 ms on the M1 produced no underrun; a
sustained mean over budget, or a long collection landing on a long
quantum, is. The app cannot raise the quantum: `renderSizeHint` is
accepted and ignored by this Chromium (Chromium 141) (128 frames whatever the hint,
probed), and `renderCapacity` is absent, so the duty-cycle sampler stays
the only in-app readout, and it is blind to the per-node and per-parameter
tax.

## Strategies, ranked

Ordered by what each buys at 16 parts with effects, against what it
costs to build and what it risks. The first three are where the headroom
is; the rest are smaller or conditional.

### 1. Let every worklet insert sleep on silence, with its tail (largest)

The one change that moves the 16-part case most. Every worklet kind
except the EQ and the plate renders its full DSP on zeros, and the bench
puts 70–100 % of most kinds' cost on a silent input (the tape 132 of 180 ms a
second per instance, the Advanced Drive 130 of 129, the phaser 21 of 24,
the compressor 11 of 13). A real 16-part song has most strips silent most
of the time: drum parts between hits, pads between regions, every muted
or soloed-out part (the gate closes after the chain), every part before
and after its regions.

The plate already has the pattern (`reverb/reverbProcessor.ts`,
`2026-09-15-547-dormant-voices-plate-sleep`): a per-block input floor
check, a tail span after the last audible input during which it keeps
rendering (the longest line plus the pre-delay), then a sleep that writes
silence and skips the DSP, and a dispatch that keeps the sleeping quantum
out of the hot render so V8 keeps its optimised loop. Each kind needs its
own tail rule, from its state:

- **Tape**: the transport delay plus the core's 48 samples and the DC
  blockers' settle: tens of milliseconds. The hiss and dropouts are
  generated from noise, so a sleeping tape must still emit its hiss when
  `noise` is on; sleep only the magnetic core and EQ when the input is
  silent and let a cheap noise path run, or treat noise above 0 as awake.
- **Advanced Drive**: stateless but for its filters and oversampler: a few
  milliseconds.
- **Bloom**: Sustain and Freeze hold sound with no input, so it sleeps only
  once its envelope reports silence; it already idles its synthesis on a
  silent input (12 ms a second silent against 118 awake), so it is nearly
  there.
- **Delay, retro reverb, phaser, compressor, filter**: the delay's feedback
  tail at its longest setting, the reverb's RT60, the phaser's lattice
  settle, the compressor's release and the filter's ring; each a span the
  kind already knows from its parameters.

A generic form fits the worklet rules: a block-level peak over the input
(`SLEEP_INPUT_FLOOR` as the plate's), a countdown in frames, the asleep
quantum dispatched from a separate method so the awake render never sees
it, no allocation, and a golden that pins the awake render unchanged and
a test that the sleep engages after the tail and never before. The
`inserts/*Allocation.test.ts` scenarios cover the switch. Payoff on the
bench's 16-part three-insert song: of its 2 600 ms a second of insert cost,
the silent share is about 1 600, so a song whose parts rest half the time
saves on the order of 800 ms a second here (about 350 on an M1), which is
the difference between that song playing and not on an M1.

### 2. Budget the dear kinds, and offer their cheaper modes (large)

The tape (180 ms a second an instance here, about 78 on an M1: 0.48 ms of
a 2.67 ms quantum at 48 kHz per instance), the Advanced Drive (129), bloom
(118) and the plate reverb insert (73) cost 4–15× a cheap kind. Three of
them on one part already cost more than the part's voices. Options, in
increasing ambition:

- **Say so in the product.** A cost figure per kind in the insert picker
  (the kinds table, divided by the M1 factor, is a reasonable first table)
  and a running estimate on the CPU button that counts the inserts, since
  the duty-cycle meter cannot see the cost (below). Zero engine risk.
- **Ship the cheaper setting where one exists.** The tape's
  `oversampling` is a product setting at 2; the Advanced Drive's
  `oversample` is 2. Each halves the core's cost at 1×, and the research
  that chose 2× (`2026-10-01-tape-control-domain-2x`,
  `2026-09-30-advanced-drive-performance`) names what it buys in aliasing.
  A per-instance "quality" field, or 1× on a strip insert and 2× on a bus
  insert by default, is a format question (an additive field with the
  current default bumps nothing).
- **Share one instance.** A tape or a plate on a group bus or a send
  processes the sum once. The product already has groups and sends; a
  hint in the picker ("Tape on a group costs one tape") is a UI change,
  not an engine one.
- **Cap it.** A song-wide budget that refuses the N+1th dear insert, with
  N from the table, is the blunt instrument; it needs a decision from
  tacowars on what the app promises.

### 3. Make the CPU meter tell the truth near the limit (medium, cheap)

The duty-cycle sampler reads only inside `process()`, so it cannot see
Chrome's per-node, per-parameter or scheduling work, and it saturates:
in the live table the 16-part three-insert song reads 68 % on the meter
while the thread is at 286 % of real time (the audio clock at 0.34 of
wall time) and the 16-part song with no inserts reads 37 % at a true
68 %. The app shows a number that stops rising at the point where the
user needs it most. Two cheap readouts fix that without touching the
worklets:

- **The audio clock against the wall clock** on the main thread: `ctx.currentTime` advanced over `performance.now()` over the last second.
  Below 0.99 the render is losing, whatever the meter says; it is the
  one measure the research used to see the slot-design song fall behind,
  and it costs nothing.
- **`AudioContext.playbackStats`** (`underrunEvents`, `underrunDuration`;
  the #275 probe found it on the target box's Chrome), the device-level
  glitch count, where the browser has it.

Show those two on the CPU button beside the estimate, and the meter's
own figure can stay as the per-processor breakdown.

### 4. Build wave tables off the audio thread, or ahead of it (medium)

A `patch` message rebuilds the part's wave sets in the worklet's
`onMessage`, on the audio thread, and a set that is not cached costs 2–5 ms
to build here, one per operator wave: a Tone step on a saw-like wave, a
user-wave partial edit, a patch whose tone the warm-up never saw, and the
2× sets a synced patch adds. That is one to two quanta of the thread's
time between renders, during a knob drag at pointer rate. Three ways
down, cheapest first:

- **Warm the patch's own keys at load**: when a part is created or a
  patch set, build every Tone step (20) for each of its waves from the
  main thread's side by posting a `warm` message that the worklet builds
  while the part has nothing to render, or at `addModule` time for the
  library's tone values. A drag then hits the cache.
- **Build on the main thread, post the tables.** The build is pure
  arithmetic over the partials; the main thread can run the same code
  (the modules compile in both projects) and post the `Float32Array`s as
  transferables, so the worklet only installs them. The cache then lives
  on the main thread and the audio thread never builds.
- **Coalesce patch messages** during a drag: the console posts a patch
  per pointer move, and each costs the audio thread a normalise, a macro
  compile and a cache lookup per part playing that preset; the bench's
  main-thread figure shows the shared-preset case posting to 16 parts a
  tick. A one-per-animation-frame coalesce in `PartsSession.push` is a
  console change.

### 5. Fewer declared parameters on the FM part (small, format-neutral)

The eight `voiceSlot` parameters cost 16 parts about 80 µs a quantum on
this machine (about 35 on an M1, 1.3 % of the budget), idle or not, and the
EQ's 51 parameters are most of its silent cost (15 ms a second an instance
here: about 40 µs a quantum, of which the parameters are about 33). The
lanes are tick-resolution ramps already, so the slots could be carried as
port messages (a `Float64Array` of targets per tick, read by the render at
the quantum, ramped by the voice) at no audible difference, dropping the
part to three parameters; the EQ could carry its band table the same way
and keep `scale`, `output` and `enabled` as parameters. Each is a worklet
change with a golden and an allocation test; the payoff is a few percent,
so it sits behind 1–3.

### 6. Leave alone

- **The strip's native nodes.** Eleven nodes a strip cost about 4.9 µs a
  quantum here (about 2 on an M1); folding the gate, head, rotation and sends
  into the FM worklet would change the insert order (pan before inserts),
  cost the sends their post-insert point, and save under 2 % of the
  budget at 16 parts. Native nodes propagate silence and cost 0.5 µs each.
- **The render quantum.** `renderSizeHint` is ignored by this Chromium
  (128 at every hint, probed in `probe.mjs`'s method), so the per-quantum
  taxes cannot be halved from the app. Worth re-probing on a future
  Chrome, since a 256-frame quantum would halve every fixed cost here.
- **The voice kernel.** Already specialised, allocation-free and
  bit-pinned; the research's remaining ideas (a cheaper feedback path, a
  table-driven envelope) are single-digit percent each and change the
  bits.
- **The main thread.** A knob tick on a 16-part song costs 1–3.5 ms here
  (the merge and renormalise 1.1 ms, the engine apply 0.5 ms for a strip
  and 2.2 ms for a patch shared by all 16 parts), against 95 ms of
  look-ahead slack; the scheduler, the lanes and the roll envelopes were
  measured cheap before. Nothing here reaches the audio thread's deadline
  short of a long synchronous task, which the console does not have.

## Limits

- One container, one browser, no audio device: Chromium's fake output
  stream paces the real-time context, and the thread is a Xeon core shared
  with the driver. Absolute times are this machine's; the ratios and the
  cost's shape are what to take.
- Node 22 drives the bench (Node 24 was not installable offline); only the
  page's Chromium runs engine code, so the Node version does not touch the
  numbers.
- The load cases strike chords of one pad patch a bar over its 2.4 s
  release, so a part's voice count moves between three and six (and
  twelve at `spread` 12, where the part's 12-voice limit means the
  release tails are stolen) inside each bar; no active-voice count was
  read, so the no-insert rows are a cost per part at that load, not per
  voice. Drums, synced voices, Acid or Formant voices and dense roll parts
  cost differently per voice; the kernel's own research covers those.
- The main-thread figures are a cost per call on an idle page, not a
  profile of the console under a drag.
- The M1 scaling is one number, the FM kernel's Node render on both
  machines (87 against 37 ns a voice-sample, `../2026-09-23-645-voice-split-bench`);
  Chrome's per-node and per-parameter work may scale differently. The
  tape's per-instance figure cross-checks it: 180 ms a second here against
  the tape record's four instances in 31 % of a quantum on the M1, about
  207 µs each, a factor of 2.3.
- The realtime traces carry the trace's own cost and the container's
  scheduling jitter in their maxima; the means and medians are the
  readings.
