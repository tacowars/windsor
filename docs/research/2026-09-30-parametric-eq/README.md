# Parametric EQ: accuracy, clicks, cost and allocation

2026-09-30 · windsor#198 · record `2026-09-30-parametric-eq-insert`

This is the engine half of the Parametric EQ: the coefficient module
(`packages/engine/src/inserts/eqCoefficients.ts` over `eqSectionDesign.ts`),
the worklet (`packages/engine/src/worklet/eq/`) and its tests. Nothing is
registered yet, so nothing here can be heard in the app; the Chrome
load-meter reading comes with windsor#199, once the kind is registered.

Reproduce the accuracy and cost numbers below from the repository root:

```sh
node docs/research/2026-09-30-parametric-eq/bench.mjs
```

It writes [bench.json](bench.json) (the environment, the throughput and the
full accuracy grid, one row per rate, type, centre, Q and gain) and prints
the tables. The allocation numbers come from `eqAllocation.test.ts` and

```sh
node --expose-gc --min-semi-space-size=64 --max-semi-space-size=64 \
  docs/research/2026-09-30-parametric-eq/coldSwitch.mjs [bundle]
```

## Which form each band type uses

Decision 5 of the issue: bells and cuts use matched second-order sections
(M. Vicanek, *Matched Second Order Digital Filters*, 2016,
https://vicanek.de/articles/BiquadFits.pdf); the notch and shelves start
from the prewarped bilinear (cookbook) form and switch to a matched form only
if the bilinear error is audible, over 0.5 dB below 16 kHz.

**Both switched.** The bilinear notch is already 0.75 – 0.89 dB off below
16 kHz with its centre at 5 kHz, and the bilinear shelves 2.6 – 3.0 dB; at
10 kHz and above they are 3 – 15 dB off. Every type now uses a matched form:

| Type | Form |
| --- | --- |
| Bell | Vicanek's peaking EQ: poles mapped exactly (Q × A), DC matched, the value and slope matched at the centre |
| Low / high cut, 12 dB/oct and each section of 24 / 48 | Vicanek's lowpass (DC and the corner's gain matched, b2 = 0) and highpass (a double zero at DC, the corner's gain matched) |
| Low / high cut, 6 dB/oct | the same two forms at first order: the pole mapped exactly, −3 dB matched at the corner |
| Notch | poles mapped exactly, zeros exactly on the unit circle at the centre, DC matched |
| Low / high shelf | poles mapped exactly; the numerator fitted to the prototype at DC, the corner and the prototype's zero frequency (capped at Nyquist, and at least 2 % above the corner). A cut is designed as the inverse of the boost, so the mapped poles always lie below the corner and are never aliased. If no realisable minimum-phase numerator fits, the third point moves to Nyquist, and if that fails too the cookbook shelf is used |

The cuts' corner matching is the paper's; a first try that matched Nyquist
instead left 0.88 – 1.15 dB of error in a high cut centred from 5 kHz up,
against 0.05 – 0.44 dB now. A scan of the shelves over 10 Hz –
0.49 × fs, ±0.01 – ±48 dB and Q 0.1 – 18 at 44.1, 48 and 96 kHz (68 040
designs) was stable at every point and never reached the cookbook fallback;
516 of them (0.8 %, all at ±12 dB or more with Q 8 or more, corners between
0.08 and 0.3 × fs) took the Nyquist fitting point. The test
(`eqCoefficients.test.ts`, "stability") checks every type and slope at the
corners of every range, ±48 dB included (a gain at scale 200 %).

## Accuracy against the analog prototype

The error is the largest |digital − analog| in dB at 401 log-spaced points
from 20 Hz to 16 kHz (the decision's limit), and in brackets to 20 kHz,
skipping points where the prototype is below −30 dB (the notch's floor and a
cut's stopband). Each cell is the worst over Q 0.7, 2 and 8 and ±12 dB; cuts
at 12 dB/oct (one section at the band's Q); gain is heard on the bell and
shelves only. Matched / bilinear.

44.1 kHz:

| Type | 1 kHz | 5 kHz | 10 kHz | 15 kHz | 18 kHz |
| --- | ---: | ---: | ---: | ---: | ---: |
| Low cut | 0.01 / 0.03 (0.01 / 0.03) | 0.11 / 0.76 (0.21 / 0.76) | 0.35 / 3.34 (0.80 / 3.34) | 1.14 / 9.23 (1.50 / 9.23) | 3.18 / 16.71 (3.18 / 16.71) |
| Low shelf | 0.01 / 0.12 (0.01 / 0.12) | 0.21 / 3.01 (0.36 / 3.02) | 2.12 / 10.08 (2.56 / 10.04) | 0.27 / 13.03 (1.94 / 15.50) | 1.02 / 13.42 (1.02 / 16.87) |
| Bell | 0.02 / 0.10 (0.03 / 0.10) | 0.39 / 1.79 (0.70 / 1.81) | 0.82 / 3.91 (1.78 / 5.23) | 0.49 / 4.75 (1.64 / 7.91) | 1.00 / 6.34 (1.25 / 8.43) |
| Notch | 0.01 / 0.04 (0.01 / 0.04) | 0.13 / 0.89 (0.23 / 0.89) | 0.59 / 3.63 (1.11 / 3.63) | 1.67 / 8.61 (3.27 / 8.81) | 2.85 / 10.31 (5.82 / 14.24) |
| High shelf | 0.01 / 0.12 (0.01 / 0.12) | 0.21 / 3.01 (0.36 / 3.02) | 2.12 / 10.08 (2.56 / 10.04) | 0.27 / 13.03 (1.94 / 15.50) | 1.02 / 13.42 (1.02 / 16.87) |
| High cut | 0.00 / 0.98 (0.00 / 0.98) | 0.44 / 11.10 (1.72 / 26.92) | 0.34 / 10.63 (1.60 / 26.13) | 0.09 / 7.45 (1.22 / 24.23) | 0.25 / 7.89 (0.64 / 21.07) |

48 kHz:

| Type | 1 kHz | 5 kHz | 10 kHz | 15 kHz | 18 kHz |
| --- | ---: | ---: | ---: | ---: | ---: |
| Low cut | 0.00 / 0.03 (0.01 / 0.03) | 0.08 / 0.64 (0.14 / 0.64) | 0.23 / 2.76 (0.51 / 2.76) | 0.75 / 7.30 (0.88 / 7.30) | 1.93 / 12.42 (1.92 / 12.42) |
| Low shelf | 0.01 / 0.10 (0.01 / 0.10) | 0.14 / 2.56 (0.24 / 2.56) | 1.34 / 8.87 (1.55 / 8.88) | 0.26 / 11.28 (5.17 / 13.79) | 0.59 / 15.03 (0.59 / 17.07) |
| Bell | 0.01 / 0.09 (0.02 / 0.09) | 0.27 / 1.52 (0.48 / 1.57) | 0.60 / 3.15 (1.28 / 4.47) | 0.36 / 3.98 (0.99 / 5.89) | 0.70 / 5.07 (0.76 / 6.70) |
| Notch | 0.00 / 0.03 (0.01 / 0.03) | 0.09 / 0.75 (0.15 / 0.75) | 0.39 / 3.05 (0.71 / 3.05) | 1.06 / 6.98 (1.96 / 7.23) | 1.75 / 8.38 (3.32 / 11.23) |
| High shelf | 0.01 / 0.10 (0.01 / 0.10) | 0.14 / 2.56 (0.24 / 2.56) | 1.34 / 8.87 (1.55 / 8.88) | 0.26 / 11.28 (5.17 / 13.79) | 0.59 / 15.03 (0.59 / 17.07) |
| High cut | 0.00 / 0.83 (0.00 / 0.82) | 0.27 / 8.65 (1.03 / 18.05) | 0.21 / 8.33 (0.91 / 17.53) | 0.05 / 5.68 (0.61 / 16.35) | 0.15 / 6.35 (0.29 / 14.23) |

The two shelves measure the same because the cookbook shelves mirror each
other. The largest matched errors are where the prototype is still changing
at Nyquist and one section cannot follow all of it: a wide notch (Q 0.7,
2.85 dB) or a resonant low cut (Q 8, 3.18 dB) centred at 18 kHz, and a
resonant shelf (Q 8, 2.12 dB) at 10 kHz, whose bump and dip lie half an
octave either side of the corner. `eqCoefficients.test.ts` pins the matched
16 kHz bounds above per type, centre and rate, and checks that every matched
form beats its bilinear one from 5 kHz up.

Also pinned there: a bell reaches its set gain at its centre within 0.01 dB
from 20 Hz to 0.45 × fs (the largest error found over Q 0.1 – 18 and
±0.5 – ±48 dB at 44.1, 48 and 96 kHz was 0.00015 dB); at Q 0.71 every cut is
−3 dB at its corner within 0.1 dB and falls at its slope within 1 dB/oct over
the octave centred two octaves past it; and the shipped processor, driven by
sines at 20 log-spaced frequencies, plays the mockup's "Pad clean-up" state
within 0.05 dB of `eqResponseDb`.

## Clicks

`eqDsp.test.ts` plays a 150 Hz sine at −6 dBFS through the shipped processor
and reads what passes an eighth-order highpass at 4 kHz. The sine sits more
than four octaves below it and is taken down by over 190 dB. The filter's own
changes move the sine's level and phase at most a few hundred times a second,
which puts their sidebands within a few hundred Hz of 150 Hz, just as far out
of reach. A click is a step or a corner in the waveform, and its energy
reaches the top of the spectrum, so what passes the highpass is the click.
The limit is 1e-4 (−80 dBFS), measured at 48 kHz:

| Signal | Peak past the highpass |
| --- | ---: |
| the steady sine through a static EQ (float32 rounding) | 5.3e-8 |
| a +12 dB Q 4 bell swept 20 Hz → 20 kHz in one second | 3.1e-6 |
| 19 type, slope and on changes, one every 40 ms | 6.5e-5 |
| the sine with a −60 dB step added (the detector's calibration) | 4.3e-4 |
| a +9 dB bell's output cut over to a +9 dB low shelf's at one sample | 0.30 |

The sweep first measured 5.4e-4: coefficients recomputed every 16 samples
stepped the filter each time, a small buzz at 3 kHz. Each gliding piece now
ramps every coefficient linearly from the last refresh to the new one across
its 16 samples (a line between two stable sections stays in the stability
triangle), which took the sweep down to 3.1e-6.

## Cost

Node throughput of the shipped `generated/eq-processor.js`, run as the
harness runs it: offline render quanta of 128 frames at 48 kHz, the median of
five runs of 20 000 quanta after a warm-up of the same. Machine: Apple M1
(MacBookAir10,1), Darwin 25.5.0; Node v24.21.0 (V8 13.6.233.17-node.53).
Backend: the bundle in Node, no browser and no audio device. A quantum is
2667 µs of audio.

| Case | µs per quantum | % of a quantum |
| --- | ---: | ---: |
| flat (a new EQ: bit-exact copy) | 1.45 | 0.05 |
| 4 bands active (a 12 dB low cut, two bells, a high shelf) | 3.80 | 0.14 |
| all 8 active, 48 dB cuts at both ends | 9.28 | 0.35 |
| all 8 moving (never settling) | 20.93 | 0.78 |
| all 8 active, silent input (zeros, no filtering) | 2.38 | 0.09 |
| disabled (bypassed: bit-exact copy) | 2.66 | 0.10 |
| 16 instances, 4 bands active each | 97.56 | 3.66 |

These are offline Node timings, not a load-meter percentage; the Chrome
reading on the load meter follows with windsor#199.

## Allocation

Measured on the machine above (Apple M1, Node v24.21.0, V8
13.6.233.17-node.53) with the shipped bundle.

`eqDsp.test.ts` checks worklet rule 2 in the source: nothing `process`
reaches builds an array, object, closure, string or spread, or calls a
method that returns a new one. V8 also boxes a double that crosses a call it
does not inline, which no source syntax shows, so the section forms pass
their working values through fields instead of arguments.

Rule 7 is checked with `--trace-generalization`. V8 types a field by its
first value, so a double first written as 0 or 1 is a small-integer field
until its first fraction, and that write generalises it: the object's map is
deprecated and the code that reads it deoptimised, and until V8 optimises
that code again it boxes every double. The first build first wrote its
doubles as integers, and the run in `eqAllocation.test.ts` traced 42 such
changes after the constructors: the band's and the DSP's doubles, the
section forms' working values (`v`), the band's `design` and the load
report's times. `fade` changed at the first type, slope or on change, and
`--trace-deopt` showed it deoptimising `runSections`, `flush` and
`configure` for a wrong map. Every double field is now first written as a
double (NaN until the first block snaps it; a first-order cut's held Q
starts at √½) and the trace shows none. Renders are bit for bit what they
were: eight seeded scripts of 4 000 quanta, with type, slope, on, frequency,
gain, Q, output and enable changes and silences, matched the first build to
the sample.

`eqAllocation.test.ts` reads the heap in a Node of its own (a reading inside
Vitest was not repeatable). After 48 000 quanta that run every path (glides,
toggles, the output and enable fades, silence, a load report), 40 000 quanta
that toggle type, slope and on on all eight bands every 8 quanta grew the
heap by 6 752 bytes, the same in every run: the eleven readings' own result
objects. One boxed double per band switch would read about 480 KB. The first
build reads the same 6 752 bytes here: once warm, its switch did not box per
switch either. The earlier reading of about 100 bytes per band per switch was
code V8 had not yet optimised.

What still allocates, so rule 2 is not met in full:

- **A switch's first runs.** V8 runs a function in its interpreter or
  baseline tier until it is hot, and those tiers box every double result. A
  change runs code that steady playing does not (the band's fade and its mix,
  the coefficient glide, the new type's section design), and its first runs
  also deoptimise `process`, `piece` and `band`, which have no type feedback
  for that branch yet. `coldSwitch.mjs` measures it: a fresh EQ plays eight
  audible bands for 20 000 quanta, then takes sixteen single changes (one
  band's type, slope or on in turn), each followed by 1 000 quanta. Bytes per
  change, the reading's own taken off:

  | Build | 1st | 2nd | 3rd | 4th | 5th–16th |
  | --- | ---: | ---: | ---: | ---: | --- |
  | first build, cold | 2 798 416 | 548 024 | 347 000 | 546 688 | 2 808 – 1 275 928 |
  | this build, cold (three runs) | 1 761 136 – 1 884 504 | 477 960 – 533 144 | 352 824 – 362 336 | 257 128 – 560 008 | 2 808 – 1 332 744 |
  | this build, after 48 000 quanta of all-band toggles | 280 – 5 768 | 5 608 – 17 736 | 361 512 – 377 128 | 21 368 – 24 072 | 248 – 408 |

  The source cannot remove this: it is how V8 runs any rarely taken path, in
  every worklet. Only keeping the path hot would, for example by rehearsing
  every change on a scratch EQ when the module loads; that costs audio-thread
  time at load and is not done here.
- **The load report.** While the load meter reads, `process` calls
  `Date.now()` twice a quantum, and V8 returns each reading as a new heap
  number: 32 bytes a quantum, measured. Every insert processor reports load
  the same way.
