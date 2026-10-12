# The plate's Build control: measurements

Written 2026-10-12 for windsor#761, item 2 of
`docs/research/2026-10-11-plate-reverb-upgrades/README.md`. The decision
record is `docs/log/2026-10-12-plate-build-control.md`.

Every figure was read on this branch's `reverb-processor.js` and on `main` at
509eb0c (the plate before Build), through the scripts in this folder.
Machine: Apple M1, 16 GB. Backend: Node 24.21.0 (V8) unless a section says
Chrome. No audio was written to disk.

## What was built

A multi-tap delay between the input diffusers and the tank
(`worklet/reverb/plateBuild.ts`, tables in `reverbBuildTables.ts`):

- one line, written with the diffused signal, six taps per side read back
  from it, linear between samples;
- the left sum feeds the left loop (line 4) and the right sum the right loop
  (line 8), where the diffused signal fed both before;
- the same sums go to the wet output at a direct level that falls as Build
  rises (0.6 at Build 0, 0.15 at 0.5, 0 at 1);
- tap times are seconds at Build 1, from 0 to 149 ms, the two sides
  interleaved, and every time is stretched by `0.1 + 0.9 × build`;
- tap gains blend linearly across three rows (Build 0, 0.5 and 1), each of
  unit energy per side: a first tap carrying most of it at 0, an even spread
  at 0.5, a swell rising to the last tap at 1.

`build` is smoothed per block as Size is (`SMOOTH_SECONDS`), and every tap's
time and gain and the direct level ramp across each block a sample at a
time. The reads are written out in the tank's sample loop.

## How the onset is read

`buildRig.mjs`, `onset`: one click in after the plate has settled half a
second at its Size, wet only, each figure from the end of the pre-delay.

- **First arrival:** the first sample above −40 dB of the wet peak.
- **Loudest window:** the 10 ms window of most energy (L² + R²).
- **Time to the peak:** the first 10 ms window at which the wet envelope
  comes within 1 dB of its peak. The envelope is each window's energy
  averaged with the two windows either side (50 ms in all).
- **E20, E100:** the energy in the first 20 and 100 ms.
- **RMS 1 s:** the wet RMS over the first second.

Why the time to the peak is read to within 1 dB: once a long tail has built,
its envelope stays within about ±1 dB for hundreds of milliseconds. `hall`
at Decay 6.35 s, in 10 ms windows, in dB against its loudest
(`envelope.mjs`):

```
build 0    -4 -2 0 -1 -1 -2 -3 -4 -5 -3 -2 -2 -2 -2 -2 -2 -2 -1 -2 -2 ...
build 0.1  -5 -2 0 -0 -1 -1 -2 -3 -4 -3 -1 -1 -1 -1 -1 -1 -1 -0 -0 -1 ...
build 0.5  -27 -17 -11 -9 -7 -5 -4 -3 -3 -2 -2 -2 -2 -1 -1 -1 -1 -1 -0 -0 0 ...
build 1    -366 -31 -27 -25 -22 -19 -17 -15 -13 -11 -10 -8 -6 -5 -4 -4 -2 -1 -1 ...
```

The single loudest window wanders inside that plateau, so its time is not in
order of Build (the "loudest ms" column below: 170, 220, 200, 190, 280, 230
on `hall` from Build 0.3). The first window within 1 dB of the smoothed peak
is where the swell arrives, and that is the figure the acceptance criterion
is checked on. This is a reading of the criterion, not its letter, and the
record raises it.

## `main` (509eb0c)

`onset-main.tsv`:

| Space | Rate | First arrival | Loudest window | Time to the peak | E20 | E100 | RMS 1 s |
|---|---|---|---|---|---|---|---|
| default | 48 kHz | 8.94 ms | 130 ms | 80 ms | 0.0182 | 0.2305 | 3.221e-3 |
| `plate` | 48 kHz | 4.46 ms | 70 ms | 50 ms | 0.0314 | 0.4759 | 2.922e-3 |
| `hall` | 48 kHz | 12.50 ms | 230 ms | 100 ms | 0.0098 | 0.1534 | 3.332e-3 |
| default | 44.1 kHz | 8.93 ms | 130 ms | 80 ms | 0.0174 | 0.2194 | 3.264e-3 |
| `plate` | 44.1 kHz | 4.44 ms | 60 ms | 40 ms | 0.0336 | 0.4330 | 2.912e-3 |
| `hall` | 44.1 kHz | 12.49 ms | 230 ms | 100 ms | 0.0098 | 0.1374 | 3.372e-3 |

`main`'s first arrival is the tank's earliest output tap (8.9 ms × Size).

## The onset against Build

`onset-build.tsv` has all three spaces at both rates. At 48 kHz:

| Build | `hall` first | `hall` peak | `hall` E20 | `hall` E100 | `hall` RMS 1 s | `plate` first | `plate` peak | `plate` E20 | `plate` E100 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.00 ms | 0 ms | 0.0381 | 0.2149 | 3.371e-3 | 0.00 ms | 30 ms | 0.0608 | 0.5070 |
| 0.1 | 0.00 | 10 | 0.0223 | 0.1657 | 3.113e-3 | 0.00 | 40 | 0.0379 | 0.4171 |
| 0.2 | 0.00 | 40 | 0.0093 | 0.1281 | 2.944e-3 | 0.00 | 50 | 0.0207 | 0.3208 |
| 0.3 | 0.00 | 120 | 0.0043 | 0.1072 | 2.929e-3 | 0.00 | 60 | 0.0101 | 0.2679 |
| 0.4 | 0.00 | 140 | 0.0019 | 0.0878 | 2.997e-3 | 0.00 | 80 | 0.0052 | 0.2259 |
| 0.5 | 0.00 | 160 | 0.0006 | 0.0733 | 3.212e-3 | 0.00 | 90 | 0.0019 | 0.1793 |
| 0.6 | 0.00 | 150 | 0.0004 | 0.0517 | 3.119e-3 | 0.00 | 100 | 0.0013 | 0.1202 |
| 0.7 | 0.00 | 170 | 0.0002 | 0.0343 | 3.098e-3 | 0.00 | 120 | 0.0008 | 0.0701 |
| 0.8 | 0.00 | 200 | 0.0001 | 0.0203 | 3.090e-3 | 0.00 | 140 | 0.0004 | 0.0526 |
| 0.9 | 13.13 | 220 | 0.0001 | 0.0109 | 3.100e-3 | 5.08 | 160 | 0.0002 | 0.0271 |
| 1 | 13.19 | 240 | 0.0000 | 0.0051 | 3.209e-3 | 5.15 | 170 | 0.0001 | 0.0115 |

"Peak" is the time to the peak to within 1 dB.

- **The time to the peak rises with Build.** It never falls by more than one
  10 ms window between steps of 0.1, in all three spaces at both rates. The
  one-window falls are `hall` 0.5 → 0.6 (160 → 150 ms at 48 kHz) and the
  default space 0.7 → 0.8 (160 → 150 ms at both rates).
- **Build 0 is snappier than `main`.** Its first arrival is 0 ms in every
  space (the first tap sits at 0 ms and the direct path carries it), against
  `main`'s 4.5 to 12.5 ms. Its energy in the first 20 ms is 3.9× `main`'s on
  `hall` and 1.9× on `plate`.
- **From Build 0.9 the first arrival is the tank's.** The first taps' gains
  are then under −40 dB of the peak, and the first arrival moves back to
  about `main`'s: 13.1 ms on `hall` (12.5 on `main`), 5.1 ms on `plate`.
- **No level jump.** The default space (`hall`) at Build 0, 0.5 and 1 reads
  +0.1, −0.3 and −0.3 dB against `main` over the first second at 48 kHz, and
  every space and Build stays within 1.2 dB of its `main` figure at both
  rates.

### The default, 0.1

`hall` is the default send. Build 0.1 is the highest step of 0.1 at which it
keeps at least `main`'s energy in its first 20 ms (0.0223 against 0.0098)
with its first arrival no later (0 ms against 12.5 ms). At 0.2 it falls under
(0.0093). Build 0 would add more burst than 0.1 does over the plate tacowars
has been listening to. This is chosen by measurement: the issue asks for the
ear, and tacowars's listen on the preview decides it.

## The tank's feed is coloured, and how much

Any sum of delayed copies is a comb. `colour.mjs` reads the energy response
of the two sides' tap sums together, (|H_L|² + |H_R|²) / 2, from 100 Hz to
4 kHz (`colour.tsv`):

| Build | raw min | raw max | raw sd | third-octave min | third-octave max |
|---|---|---|---|---|---|
| 0 | −8.1 dB | 2.8 dB | 1.9 dB | −2.4 dB | 0.9 dB |
| 0.1 | −11.0 | 4.2 | 2.7 | −3.6 | 0.7 |
| 0.3 | −13.7 | 4.5 | 3.4 | −2.7 | 0.2 |
| 0.5 | −19.6 | 5.9 | 3.2 | −0.3 | 0.7 |
| 1 | −13.3 | 3.6 | 2.6 | −0.8 | 0.3 |

A first draft of the Build 0 row spread its energy over six taps falling
gently (0.71 to 0.14). Inside 15 ms that combs the feed in wide notches: a
third-octave band 7.2 dB down at Build 0.1, and a 220 Hz tone through the
Size sweep below peaked 8 dB lower at Build 0 than at 0.1. With the first tap carrying
most of the energy (0.905, the other five 0.27 to 0.11) the band dips are
2.4 dB at Build 0 and 3.6 dB at 0.1. Higher up the taps spread over tens of
milliseconds, the ripple is fine, and in third octaves it stays within 3 dB.

## The tail is unchanged in length

`t30.mjs`, damping open and modulation off (`t30-48.tsv`, `t30-44.tsv`):

| Decay | Size | Build 0 | Build 0.5 | Build 1 | `main` |
|---|---|---|---|---|---|
| 2 s | 0.25 | +0.0 % | +0.4 % | +0.2 % | +0.1 % |
| 2 s | 1 | +1.3 | +1.7 | +1.6 | +1.3 |
| 2 s | 4 | −9.8 | −8.5 | −8.1 | −9.1 |
| 10 s | 0.25 | −0.2 | −0.1 | +0.1 | +0.2 |
| 10 s | 1 | −0.1 | +0.4 | +0.4 | 0.0 |
| 10 s | 4 | +1.4 | +1.8 | +1.5 | +1.2 |

At 44.1 kHz the same cells read −9.6 to +2.3 %. Every cell holds ±10 %. Size 4
at Decay 2 s is `main`'s own corner (−9.1 %): Build moves it by under one
point. `mixer/reverbBuild.test.ts` pins all eighteen cells.

## Live moves

`liveMoves.mjs`, the no-step test of record
`2026-08-31-dattorro-reverb-not-plateau` §3. With a steady 220 Hz tone the
ceiling is the tone's slew at the render's peak times 3. With a drum loop (a
0.4 s noise burst for a tail, a kick every 0.5 s, a hat every 0.25 s) it is
the loop's largest step through the plate held still at Build 0, 0.25, 0.5,
0.75 and 1, read from 1 s on.

| Move | tone, 48 kHz | drums, 48 kHz | tone, 44.1 kHz | drums, 44.1 kHz |
|---|---|---|---|---|
| Build 0 → 1 → 0 over 1 s each way | 0.32 | 0.81 | 0.32 | **1.01** |
| over 4 s each way | 0.34 | 0.85 | 0.34 | 0.96 |
| over 8 s each way | 0.34 | 0.79 | 0.34 | 0.92 |
| 0 → 1 in one block, and back | 0.38 | 0.83 | 0.33 | 0.91 |
| HOLD on and off at Build 0 | 0.34 | 0.83 | 0.35 | 0.91 |
| HOLD on and off at Build 1 | 0.36 | 1.00 | 0.34 | 1.00 |

Each figure is the largest step over its ceiling. One cell is over: the
fastest sweep with the drum loop at 44.1 kHz, 0.5 % over the still loop's
largest step. A swept tap read is Doppler: moving 135 ms in a second, the
last tap plays the signal up to about 14 % fast, and a hat's step grows with
it. There is no discontinuity: the same sweep's tone ratio is 0.32. The HOLD
rows at Build 1 read 1.00 because their largest step is a hat's, the same
one the still render has.

A held tail keeps ringing: in the whole-box sweep below, the held tail from
2.5 to 3 s sits 1.0 to 3.2 dB under its level from 0.5 to 1 s at every Build,
Size, diffusion, pre-delay and Decay, as it did at Build 0.

### The Size sweep at `lowDecay` 4

`mixer/reverbLowBand.test.ts` sweeps Size from 0.05 to 4 and back over 8 s
each way under a 220 Hz tone. On `main` the `lowDecay` 4 case reads 0.92 of
its ceiling. `sizeSweep.mjs` reads it against Build:

| Build | 0 | 0.1 | 0.2 | 0.3 | 0.5 | 0.7 | 1 |
|---|---|---|---|---|---|---|---|
| `lowDecay` 4 | 0.91 | 0.96 | 0.83 | **1.04** | 0.86 | 0.99 | 0.97 |
| `lowDecay` 1 | 0.76 | 0.85 | | | 0.78 | | 0.82 |

`main` at `lowDecay` 1 reads 0.77. This is the Doppler of a long, swept tail
that record `2026-10-12-plate-decay-in-seconds` (decision 5) accepted, and
Build moves it because it changes how much 220 Hz the tank holds, which the
ceiling scales with. The pinned test runs at the default Build and passes.
Build 0.3 is 4 % over.

## The whole box

`sweep.mjs`: Build 0, 0.5 and 1 × Size 0.05, 1 and 4 × `diffusionIn1` 0
and 1 × `diffusionIn2` 0 and 1 × pre-delay 0 and 1 s × Decay 0.2 and 60 s
× HOLD off and on, one click in, 288 renders a rate (`sweep48.tsv`,
`sweep44.tsv`).

- **Nothing runs away.** No sample is non-finite, and the largest peak is
  0.237 at 48 kHz and 0.268 at 44.1 kHz, both at Build 0, Size 0.05, both
  input diffusions 1, Decay 0.2 s (the burst at its densest).
- **HOLD** holds at every corner (above).
- **The time to the peak follows Build** in 91 of 96 corners at 48 kHz and
  92 at 44.1 kHz (each corner read across Build 0, 0.5 and 1). The rest are
  all at Size 4, Decay 60 s and `diffusionIn1` 1. There the tank's own lines
  run to 0.6 s, its build dominates the first second, and the figure reads
  300 to 340 ms at Build 0.5 against 160 to 180 ms at Build 1. That is the
  tank's onset, not Build's.
- **Pre-delay** shifts everything by its own length and changes nothing
  else: the figures are read from its end.

## Sample rates

`mixer/reverbBuild.test.ts` loads the bundle at 44.1, 48 and 96 kHz, sets
Build 1, and checks every tap's time in samples against its time in seconds
to within one sample. It also checks that the Build line holds the longest
tap plus the interpolator's reach. The line is sized at construction from the
running rate, 149 ms rounded up to a power of two: 8 192 samples at 44.1 and
48 kHz, 16 384 at 96 kHz.

## CPU

The plate's render cost per quantum, noise in, sleep off, the default space,
in Node (`bench.mjs`) and in headless Chrome 155 on the page's main thread
(`benchPage.html`, the same loop; it was served from the app's dev server).
Each figure is the median of three runs, each run the median of seven runs
of 20 000 quanta, alternating the bundles.

| Backend | `main` | Build 0 | Build 1 |
|---|---|---|---|
| Node 24.21.0 (V8) | 39.6 µs | 43.8 µs (+11 %) | 44.3 µs (+12 %) |
| Headless Chrome 155, main thread | 37.8 µs | 42.4 µs (+12 %) | 42.5 µs (+12 %) |

An earlier Node run on a quieter machine read 36.0 µs for `main` and
40.2 to 40.4 µs at both ends of Build, the same +12 %. Twelve linear reads a
sample cost about 4.5 µs a quantum, about 2.9 ns a read. Splitting the tap
loop per side, which drops its branch, measured no faster (41.1 and 40.7 µs
against 40.4), so it stays one loop.

## The cards

In the project's headless Chrome at its default window (1200 px wide), the
`room` return (Send A) and a Plate insert on the master each show `Build`,
reading 0.10, on the Diffusion page: in a column of its own between `Diff 1`
/ `Diff 2` and `Tank 1` / `Tank 2`. Neither page overflows its card (scroll
width equal to client width). `room-return-diffusion.png` and
`plate-insert-diffusion.png`.

## Files

- `buildRig.mjs`: loads a bundle at any rate, renders, reads the onset and T30.
- `onset.mjs`, `onset-main.tsv`, `onset-build.tsv`: the onset tables.
- `envelope.mjs`: the wet envelope in 10 ms windows.
- `colour.mjs`, `colour.tsv`: the tank feed's colour against Build.
- `t30.mjs`, `t30-48.tsv`, `t30-44.tsv`: the tail's length.
- `liveMoves.mjs`, `sizeSweep.mjs`: the no-step checks.
- `sweep.mjs`, `sweep48.tsv`, `sweep44.tsv`: the whole box.
- `bench.mjs`, `benchPage.html`: the CPU figures.
