# Load sampler allocation (windsor#214)

windsor#198 measured 32 bytes of heap per render quantum from the EQ's load
sampler (#445) while the load meter reads: two `Date.now()` calls, each a new
heap number. This measures it in all ten worklet processors, finds whether a
source change removes it, and records what the change on this branch did.

Measured on an Apple M1 (16 GB), macOS 26.5.1, Node v24.21.0 (V8
13.6.233.17-node.53), the Node the repo pins (`.nvmrc`). The console check
used the project's headless Chrome 154 on the same machine.

## Method

`packages/engine/src/__fixtures__/workletAllocationProbe.ts`, windsor#198's
EQ probe generalised to any bundle, runs one shipped
`worklet/generated/*.js` in a Node of its own with `--expose-gc`, a 64 MB young
generation and `--trace-generalization`. It warms for 16 000 quanta (the meter
reporting every 64 quanta for the first half, so its path is hot either way),
forces two collections, then reads `used_heap_size` across the measured run in
ten windows and counts the collections in it (none, or the reading is
discarded). An insert renders stereo noise at its parameters' defaults; the
FM part renders a held four-note chord of `pad-drift`. Each case ran three
times; every run of a case read the same bytes to the byte, except where a
cell gives a range.

`measure.mjs` in this folder reproduces the tables. The "before" column ran
it on `origin/main`'s bundles (`git archive`), "after" on this branch's.

Each heap reading makes its own result object, about 600 bytes a window, so
a render that allocates nothing reads about 3 bytes a quantum over 2 000
quanta. Two runs read at 500 quanta: the drive and the plate collect sooner
at 2 000.

## Heap growth per quantum, bytes

| Processor | Quanta | Before, off | Before, on | After, off | After, on | On − off |
|---|---:|---:|---:|---:|---:|---:|
| FM part (`fm-processor.js`) | 2 000 | 3 587.62 | 3 622.92–3 622.96 | 3 587.62 | 3 621.17–3 623.00 | 33.6–35.4 |
| Advanced Drive | 500 | 103 565.66 | 103 597.66 | 103 565.66 | 103 597.66 | 32.0 |
| Compressor | 2 000 | 10 244.30–10 244.45 | 10 275.42–10 276.45 | 10 244.42 | 10 276.42 | 31.0–32.0 |
| Delay (`dub-delay`) | 2 000 | 6 183.82 | 6 215.82 | 6 184.07 | 6 216.00 | 32.0 |
| Parametric EQ | 2 000 | 3.38 | 35.38 | 3.38 | 35.38 | 32.0 |
| Output stage | 2 000 | 3.38 | 35.38 | 6.08 | 38.08 | 32.0 |
| Phaser | 2 000 | 8 243.42 | 8 275.42 | 8 243.42 | 8 275.42 | 32.0 |
| Retro reverb | 2 000 | 8 102.59 | 8 134.59 | 8 102.64 | 8 134.64 | 32.0 |
| Plate (`reverb-processor.js`) | 500 | 41 021.63 | 41 055.39 | 41 021.63 | 41 053.63–41 057.98 | 32.0–36.4 |
| Tape | 2 000 | 12 303.28 | 12 335.28 | 12 299.36 | 12 331.36 | 32.0 |

The meter costs 32 bytes a quantum in every processor, before and after:
two heap numbers. The FM part and the plate read up to 4 bytes over it, in
one run of three for the plate; before this change both also built a new
report object at each post (one post in 64 quanta, under a byte a quantum).

The after output stage's 2.7 extra bytes a quantum are one step of about
5.4 KB in one window, meter on and off alike, and not a rate: over 8 000
quanta it reads 1.77 off and 33.77 on, against 1.08 and 33.08 before, and
before shows one step of about 2 KB of its own. The step is in both runs, so
it is not the sampler's; a tier-up allocating code is the likely cause, not
traced further.

## Where the 32 bytes come from, and why no source change removes them

`dateNow.mjs` here stores each reading straight into a preallocated
`Float64Array`, the form the issue proposed, in loops optimised by
TurboFan:

| Loop, stored into a `Float64Array` | Bytes per iteration |
|---|---:|
| nothing (a control) | 0.01 |
| `Date.now()` | 16.01 |
| `Date.now()` twice, differenced | 32.01 |
| `date.getTime()` on a stored `Date` | 0.13 |
| `Math.random()` | 16.01 |

With `--turbo-filter=twoReadings --trace-turbo-graph` the reading is
`DateNow` in the graph, lowered to
`Call(...)[Code:DateCurrentTime:r1s0i4f0]` with
`Constant()[external: <DateCurrentTime.entry>]`: optimised code calls V8's
runtime function `DateCurrentTime`, which returns a tagged number. Wall-clock
milliseconds are about 1.8 × 10¹², far outside a small integer, so the
runtime returns a new 16-byte heap number, and it has allocated it before any
code of ours sees the value. Where the double is stored afterwards (a local, a
double field, a typed array) makes no difference. `performance.now()` does
not exist in `AudioWorkletGlobalScope` (`cost/audioLoad.ts`), `currentTime`
is the audio clock and not wall time, and a stored `Date` has no way to
refresh itself without another `Date.now()`. So no source form reads the
wall clock on the audio thread without the heap number.

What the branch changed instead:

- **One sampler, not ten copies.** `worklet/loadSampler.ts` (`LoadSampler`)
  is bundled into every processor, with `begin()` before the render and
  `end(frames)` after it. The readings live in its own fields, so no reading
  is passed across a call. The FM part and the plate now post one reused
  report, as the inserts did; the FM and plate harnesses clone what they
  post, as the real port does.
- **No representation change.** Nine of the ten samplers wrote their time
  fields first as the small integer 0, and the first `Date.now()` then
  generalised them to doubles (worklet rule 7), deprecating the map and
  deoptimising the code that reads it. With the meter on, every processor but
  the EQ showed three:

  | | FM | Drive | Comp. | Delay | EQ | Output | Phaser | Retro | Plate | Tape |
  |---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
  | Changes before | 25 | 45 | 29 | 15 | 0 | 19 | 17 | 18 | 9 | 52 |
  | From the sampler | 3 | 3 | 3 | 3 | 0 | 3 | 3 | 3 | 3 | 3 |
  | Changes after | 22 | 42 | 26 | 12 | 0 | 16 | 14 | 15 | 6 | 49 |

  For example `wallStart:s{Any;const}->d{Any;mutable}`,
  `busyMs:s->d` and `wallMs:s->d` in each insert, and `loadWallStart`,
  `loadBusyMs` and `loadPeakMs` in the FM part. `LoadSampler` writes every
  time field first as NaN, as windsor#198's EQ did, and none remain.

`cost/loadSamplerAllocation.test.ts` pins both: in each of the ten bundles
the meter-on run reads 32 ± 8 bytes a quantum over the meter-off run, no
generalisation falls on the bundle's `LoadSampler` lines, and the EQ and
output stage allocate nothing with the meter off. A build whose sampler
writes `wallStartMs` first as 0 fails it
(`wallStartMs:s{Any;const}->d{Any;mutable} … [~start+63 at tape-processor.js:182]`).

## The least costly alternative, not shipped

Sampling one quantum in N reads the clock on only one quantum in N: at N = 8,
4 bytes a quantum on average instead of 32. The busy fraction stays an
unbiased estimate if the sampled quanta do not beat against the load (every
Nth quantum with nothing periodic at N quanta; a random phase if that
matters), at N times the variance per report. But `peakMs` and `underruns`
would see one quantum in N, so the underrun count, the readout's firmest
number (`cost/audioLoad.ts`), would miss seven deadline misses in eight. The
cost it saves is about 11 KB a second per processor at 44.1 kHz (344.5 quanta
× 32 bytes) of short-lived young-generation garbage while the meter reads;
what that costs in scavenge time on the audio thread was not measured. Not
shipped, as the issue directs: it trades the underrun count for an unmeasured
saving.

## What else allocates: the DSP, with the meter off

The table's off column is the larger finding. Eight of the ten renders
allocate every quantum with the meter off, from their DSP, outside this
ticket (which must not edit it): from 3.6 KB (the FM part) to 104 KB (Advanced
Drive) a quantum, against worklet rule 2. Only the EQ and the output stage
allocate nothing. Their traces also show representation changes outside the
sampler (the "after" row above): fields first written as small integers or
heap objects and later as doubles, including `h{…}->t{…}` fields in the
drive's `DriveFilter`, which box every later write.

Where, from V8's sampling heap profiler with collected objects kept (an
inspector session in the same process, which itself changes what V8
optimises, so a lead and not a measurement), the top allocating functions
by bundle line:

| Bundle | Top allocating functions |
|---|---|
| FM part | `advance` (two, the envelope's and the LFO's), `renderVoiceKernel` |
| Advanced Drive | `channel`, `configure` (two), `tick` (two) |
| Compressor | `process`, `tick` |
| Delay | `process`, `read` |
| Phaser | `channel`, `process` |
| Retro reverb | `process`, `tick` (two), `internal` |
| Plate | `_read`, `_readCubic`, `_renderBlock` |
| Tape | `channel`, `tick`, `process` |

The pattern windsor#198 found in the EQ fits: a double passed across a call V8
does not inline (a `tick` returning a sample, a `channel` step), and fields
generalised after their first write. Whether Chrome's audio thread allocates
the same was not measured here; the V8 in Chrome 154 is newer than Node's.
Each processor wants its own ticket, with the allocation probe as its test,
as the EQ had.

## The console

In the headless Chrome, a song with one chord part and Advanced Drive, Tape,
the bus compressor, Phaser, Dub delay and Retro reverb on the master, played
for nine seconds on this branch's bundles and then on `origin/main`'s, served
by the same dev server. Every processor (the output stage, the plate, the FM
part and the six inserts) posted nine reports in the nine seconds, each
`quanta: 345` over a `wallMs` of 1 003 to 1 004, every field finite. The
meter read 11 % to 16 % on this branch and 10 % to 14 % on main, peak 0 %,
the same underrun count. The readout is an estimator that over-reads by 2–3×
(`cost/audioLoad.ts`), and these ranges are the same within its noise.

## The trace parser

Codex's P2 on windsor#208: when V8 interleaves another `[generalizing]`
record between the halves of a real `s{…}->d{…}` pair, cutting at each marker
left neither piece a whole pair, and the change went uncounted.
`__fixtures__/generalizationTrace.ts` now collects the halves of cut pairs (a
head `x{` that never reaches `}->`, a tail `}->y{` with no `x{`) and counts
them as a failure unless every way of joining heads to tails keeps the
representation: each head is a birth (`v`) or has the one side every tail
has. A head or tail with no counterpart fails. The Linux CI record windsor#198
met (`type:s{` cut by a `freq:d->d` record, its tail `->s{`) still passes;
`inserts/eqGeneralizationTrace.test.ts` adds the interleaved `s->d`, a lost
head, a lost tail, a cut birth and two cuts that could join into a change.
None of the ten bundles' real traces here contain a cut pair.
