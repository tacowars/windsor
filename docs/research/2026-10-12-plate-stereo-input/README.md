# The plate's stereo input: measurements

Written 2026-10-12 for windsor#763, item 3 of
`docs/research/2026-10-11-plate-reverb-upgrades/README.md`. The decision
record is `docs/log/2026-10-12-plate-stereo-input.md`.

Every figure was read on this branch's `reverb-processor.js` and on `main` at
d627d18 (the plate with Build, its input summed to mono), through the
scripts in this folder. Machine: Apple M1, 16 GB. Backend: Node 24.21.0 (V8)
unless a section says Chrome. 48 kHz unless a table names 44.1 kHz. No audio
was written to disk.

## What was built

- **Two input chains.** L and R each have a pre-delay ring, input low and
  high cut states and four input all-passes, set by the one `preDelay`,
  `inputLowCut`, `inputHighCut`, `diffusionIn1` and `diffusionIn2`. Each
  channel enters at unity. A one-channel input feeds both chains, and no
  input feeds zeros (`worklet/reverb/plateInput.ts`).
- **Lines.** L's diffusers are lines 0 to 3, as before; the tank is still 4
  to 11; R's diffusers are lines 12 to 15, of lengths 5.312, 3.825, 11.459
  and 8.022 ms (`INPUT_DELAYS_RIGHT`), against L's 4.771, 3.595, 12.735 and
  9.307 ms. Neither follows Size.
- **Injection.** L's chain feeds the right loop (line 8) and R's the left
  loop (line 4). Each chain writes its own Build line; the left tap set reads
  L's, the right tap set R's, and each sum goes to its own side of the wet
  output at Build's direct level.
- **The hot path.** R's chain is written out in the tank's sample loop: each
  of its lines is read once a sample, linear between samples, with no call
  but `Math.floor`. Written with the plate's `_read` and `_write1` calls, as
  L's chain is, the plate cost 51.7 µs a quantum, 30 % over `main`;
  written out it costs 42.3 µs, and renders the same bits.
- **The pre-delay rings** are `MAX_PRE_DELAY` rounded up to whole quanta,
  plus one quantum, so the full second fits at any rate. The old ring held
  the longest pre-delay 68 samples short at 44.1 kHz.

## The right chain

`chains.mjs` drew 520 sets (seeds 7 and 2026, `chains-seed7.tsv` and
`chains-seed2026.tsv`), each length its L counterpart times a factor from
0.85 to 0.97 or 1.03 to 1.15. Each set was patched into the bundle and read
at the default space for the L/R correlation, the mono sum and its worst
third-octave band against `main`, the balance on centred noise, and the
mirror: the largest gap, over the 0–50, 50–200 and 200–1000 ms windows and
Size 0.25, 1 and 4, between L alone's left energy and R alone's right.

- Every set kept the mono sum within 0.4 dB of `main`'s, its worst band
  within 0.8 dB, and the correlation within ±0.02. Those don't choose.
- The mirror at Build 0 does, from 0.99 dB to over 3 dB. With both chains
  at L's lengths it reads 1.96 dB, at Size 4's first window.
- At Build 1 every set reads 8.22 dB at Size 4 (see "The mirror", below).

`select.mjs` then held each set, from the smallest mirror up, to what the
earlier records pin, each as its test reads it, with half a point to spare
(`select.tsv`): the `room` space's T30 against its T30 before windsor#748,
the other converted spaces' likewise, the Build T30s at Decay 2 and 10 s,
and Build's rise on `hall` and `plate`. The one set that met a 1 dB mirror
(0.99 dB) put `room` 11 % short: shorter R lines ring less outside the loop,
and `room`'s 0.4 s Decay is where that ring weighs most. The first set to
pass, 5.312, 3.825, 11.459 and 8.022 ms, mirrors within 1.16 dB, and ships.

The inversion of R's injection was tried on every set and on the shipped
one. It moves nothing the criteria read (below), so it was not kept.

## The side follows the input

One click on L alone, then on R alone, the default space, Size and Build
as listed. Lead is the fed side's energy over the other side's in each
window from the end of the pre-delay, dB. Mirror is L alone's left energy
over R alone's right, dB. A lead over 300 dB is a window the other side
hears nothing in.

| Build | Size | L lead 0–50 | 50–200 | 200–1000 | R lead 0–50 | 50–200 | 200–1000 | mirror 0–50 | 50–200 | 200–1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.25 | 3.9 | 0.3 | 0.0 | 3.5 | 0.3 | -0.2 | 0.03 | -0.17 | 0.03 |
| 0 | 1 | 364.2 | 0.8 | 0.7 | 358.4 | 0.7 | 0.7 | 0.19 | -0.19 | -0.56 |
| 0 | 4 | 364.0 | 360.2 | -0.0 | 360.6 | 360.5 | 0.3 | 1.16 | -0.76 | -0.42 |
| 1 | 0.25 | 5.3 | 1.4 | 0.3 | 4.5 | 1.8 | 0.1 | 2.90 | 0.45 | -0.71 |
| 1 | 1 | 339.7 | 6.5 | 0.3 | 331.5 | 6.3 | 0.8 | 2.60 | 0.48 | -1.38 |
| 1 | 4 | 333.0 | 358.5 | 1.1 | 322.5 | 355.3 | 2.0 | 8.22 | 2.83 | -1.86 |

At 44.1 kHz:

| Build | Size | L lead 0–50 | 50–200 | 200–1000 | R lead 0–50 | 50–200 | 200–1000 | mirror 0–50 | 50–200 | 200–1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.25 | 3.4 | 0.3 | 0.0 | 3.2 | 0.3 | -0.1 | -0.38 | -0.15 | 0.03 |
| 0 | 1 | 361.6 | 0.6 | 0.7 | 365.4 | 0.3 | 0.6 | -0.52 | 0.06 | -0.08 |
| 0 | 4 | 365.6 | 356.0 | 0.4 | 364.3 | 360.8 | 0.5 | 0.69 | -1.19 | -0.73 |
| 1 | 0.25 | 5.1 | 1.1 | 0.2 | 4.2 | 1.6 | 0.1 | 2.87 | 0.63 | -0.50 |
| 1 | 1 | 336.9 | 5.6 | 0.3 | 338.7 | 6.2 | 0.6 | 1.51 | 0.25 | -0.59 |
| 1 | 4 | 334.1 | 354.4 | 1.4 | 327.3 | 355.5 | 2.1 | 6.20 | 2.59 | -1.59 |

- **The lead** is 3.2 dB or more in the first window at Build 0 everywhere,
  and grows with Build.
- **The mirror** holds 1 dB at Build 0 but at Size 4: 1.16 dB in the first
  window at 48 kHz, 1.19 dB in the second at 44.1 kHz. At Size 4 the
  halves' first output taps land at 36 ms (line 9, on the left) and 47 ms
  (line 5, on the right), so a 50 ms edge splits them unevenly. Both chains
  at L's lengths read 1.96 dB there.
- **At Build 1** the direct path is 0, and the first window holds only the
  first Build tap of each side through the tank's first tap. Build's left
  and right tap times differ by design (record
  `2026-10-12-plate-build-control`), so the two sides' first windows hold
  different shares of the onset: 8.2 dB apart at Size 4. The fed side still
  leads by 4.2 dB or more. Retuning Build's tables was out of scope.

## A centred source stays central

Wet L over R in dB, the default space: one click over its first second, and
10 s of noise from its start to a second past its end. "One channel" is the
same signal handed to the plate as a one-channel input; it renders the same
bits as L = R (`mixer/reverbStereo.test.ts`).

| Build | L = R click | L = R noise | one channel, click | one channel, noise |
|---|---|---|---|---|
| 0 | 0.04 | 0.04 | 0.04 | 0.04 |
| 0.5 | -0.11 | -0.13 | -0.11 | -0.13 |
| 1 | -0.13 | -0.08 | -0.13 | -0.08 |

At 44.1 kHz the largest is 0.11 dB.

## Level

One click's wet RMS over its first second, both sides, the default space.

| Build | Input | `main` | new | new − `main`, dB |
|---|---|---|---|---|
| 0 | L = R | 0.00326 | 0.00336 | 0.27 |
| 0 | L alone | 0.00163 | 0.00233 | 3.10 |
| 0.5 | L = R | 0.00315 | 0.00320 | 0.14 |
| 0.5 | L alone | 0.00158 | 0.00219 | 2.86 |
| 1 | L = R | 0.00315 | 0.00324 | 0.23 |
| 1 | L alone | 0.00158 | 0.00217 | 2.80 |

A hard-panned source is about 3 dB louder in the wet than on `main`, where
the mono sum halved it; it now enters its chain at unity. At 44.1 kHz the
centred rows read 0.01 to 0.17 dB, the hard-left rows 2.88 to 3.07 dB.

## Mono-compatible

10 s of centred noise, the default space: the wet's mono sum, (L + R) / 2,
against `main`'s, and the wet's L/R correlation.

| Plate | total, dB | lowest band, dB | at | L/R correlation | `main`'s |
|---|---|---|---|---|---|
| new | 0.26 | -0.40 | 315 Hz | 0.006 | 0.004 |
| new, R's injection inverted | 0.20 | -0.33 | 315 Hz | 0.004 | 0.004 |

Each third-octave band of the mono sum against `main`'s, dB:

| Plate | 100 | 125 | 160 | 200 | 250 | 315 | 400 | 500 | 630 | 800 | 1k | 1.25k | 1.6k | 2k | 2.5k | 3.15k | 4k | 5k | 6.3k | 8k | 10k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| new | 0.1 | 0.1 | 0.1 | -0.0 | -0.3 | -0.4 | -0.3 | -0.0 | 0.1 | 0.1 | 0.2 | 0.2 | 0.1 | 0.1 | 0.1 | 0.2 | 0.3 | 0.3 | 0.3 | 0.5 | 0.8 |
| inverted | 0.8 | 0.7 | 0.2 | -0.0 | -0.2 | -0.3 | -0.2 | -0.0 | -0.1 | -0.1 | -0.0 | -0.0 | -0.1 | -0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.4 | 0.5 | 0.8 |

At 44.1 kHz: total 0.14 dB, lowest band −0.34 dB at 400 Hz, correlation
0.003 against `main`'s 0.002. The tank's output taps already decorrelate the
sides, on `main` too, so the inversion has nothing to add.

## Anti-phase

One click with L = −R, the default space, wet RMS over the first second.
`main` cancelled it before the tank and rendered silence.

| Build | `main` | new L | new R | new mono sum | against L = R, dB | mono sum, inverted |
|---|---|---|---|---|---|---|
| 0 | 0 | 0.00334 | 0.00334 | 0.00236 | -0.0 | 0.00238 |
| 0.5 | 0 | 0.00320 | 0.00319 | 0.00228 | -0.0 | 0.00226 |
| 1 | 0 | 0.00320 | 0.00330 | 0.00229 | 0.0 | 0.00229 |

It rings as loud as a centred click. Its wet mono sum sits 3 dB under each
side, as any decorrelated pair's does.

## The tail's length

T30 in seconds (and against Decay), one click, the default Build, tank
filters open and no modulation, as `mixer/reverbDecay.test.ts` reads it.

| Decay | Size | `main` | new, L = R | new, L alone |
|---|---|---|---|---|
| 2 | 0.25 | 2.00 (-0.2 %) | 1.99 (-0.5 %) | 1.99 (-0.3 %) |
| 2 | 1 | 2.03 (1.5 %) | 2.02 (1.0 %) | 2.03 (1.4 %) |
| 2 | 4 | 1.81 (-9.4 %) | 1.80 (-9.9 %) | 1.92 (-4.1 %) |
| 10 | 0.25 | 9.97 (-0.3 %) | 9.95 (-0.5 %) | 9.99 (-0.1 %) |
| 10 | 1 | 10.00 (0.0 %) | 9.99 (-0.1 %) | 10.01 (0.1 %) |
| 10 | 4 | 10.15 (1.5 %) | 10.12 (1.2 %) | 10.13 (1.3 %) |

Across Build 0, 0.5 and 1 the centred click at Decay 2 s, Size 4 reads
−10.0, −9.4 and −10.4 %, against `main`'s −9.8 % at Build 0: its 0.6 s lines
lose 18 dB a pass, and few passes span the fit. At 44.1 kHz it reads −9.5 %
(`main` −9.2 %), and every other cell is within 2 %. The converted spaces:
`room` reads −9.5 % against its old T30 (`main` −7.0 %), and a hard-left
click into it −8.8 %; `plate` −3.8 % (`main` −4.1 %).

## Through the whole graph

`mixer/plateStereoGraph.test.ts`: two parts, one hard left, one hard right,
each playing a 50 ms noise hit into a group carrying a fully wet Plate in
the `hall` space (the insert's default), on the headless graph. The fake
graph already carried both channels into the plate's worklet; no fixture
changed.

| Case | `main` | new |
|---|---|---|
| Left part alone, left over right, first 200 ms | 0.48 dB | 3.67 dB |
| Left part alone, whole render | 0.09 dB | 1.31 dB |
| Right part alone, right over left, first 200 ms | −0.48 dB | 3.04 dB |
| Right part alone, whole render | −0.09 dB | 1.38 dB |
| Both, left over right | 0.09 dB | −0.07 dB |

A 330 Hz tone as the hit read a lead of about 0 dB for the right part alone: on
one frequency the direct path and the tank's first taps sum with whatever
phase their lengths give it. The test uses noise.

## Live moves

`liveMoves.mjs`: the largest sample-to-sample step on either side from 1 s
on, under a stereo loop (L and R different), against the same loop's largest
step through a still plate (Size 0.05 and 4, Build 0 and 1). A ratio at or
under 1 passes the no-step test of record
`2026-08-31-dattorro-reverb-not-plateau` §3.

| Move | 48 kHz | 44.1 kHz | `main`, 48 kHz |
|---|---|---|---|
| Size 0.05 → 4 → 0.05, 1 s each way | 0.68 | 0.76 | 0.72 |
| Size 0.05 → 4 → 0.05, 8 s each way | 0.69 | 0.79 | 0.70 |
| Build 0 → 1 → 0, 1 s each way | 0.58 | 0.54 | 0.48 |
| Build 0 → 1 → 0, 8 s each way | 0.56 | 0.60 | 0.49 |
| HOLD on at 2 s, off at 4 s | 0.48 | 0.59 | 0.46 |

All pass, and `mixer/reverbStereo.test.ts` pins each at 48 kHz. A stereo
loop held from 1 s keeps, at 9–10 s, over a quarter of its 2–3 s energy on
each side.

## The whole box

`sweep.mjs`: 4,320 cells at each rate, every combination of the input case
(L alone, R alone, L = R, L = −R, a one-channel input), Size 0.05, 0.25, 1
and 4, Build 0, 0.5 and 1, each input diffusion at 0, 0.5 and 1, pre-delay
0 and 1 s, Decay 0.2 and 60 s, and HOLD off or engaged 0.1 s after the
pre-delay. One click per cell. Every row is in `sweep48k.tsv` and
`sweep44.1k.tsv`.

- **No non-finite sample** at either rate. The largest wet peak is 0.27 at
  48 kHz and 0.28 at 44.1 kHz.
- **A centred and a one-channel input stay central** in every cell: the
  worst L/R over the first second is 0.76 dB (48 kHz) and 0.65 dB
  (44.1 kHz).
- **Anti-phase rings in every cell**, at least −1.3 dB against the centred
  click in the same cell.
- **HOLD holds both sides**: the least either side keeps from 0.6–1.1 s to
  2.0–2.5 s is 0.45 (48 kHz) and 0.42 (44.1 kHz) of its energy, an
  anti-phase click at Size 0.05.
- **The lead in the first 50 ms** (`summary.mjs`), by Size, counting apart
  the cells whose fed side has heard under 1/1000 of its first second there
  ("empty": at Build 1 the input chain's own delay at diffusion 0, Build's
  spread and the pre-tank path put the first arrival past 50 ms):

| Build | Size | L alone under 3 dB, 48 kHz | R alone | L alone, 44.1 kHz | R alone |
|---|---|---|---|---|---|
| 0 | 0.05 | 72 of 72 (least 0.3) | 72 of 72 (0.5) | 72 of 72 (0.2) | 72 of 72 (0.7) |
| 0 | 0.25 | 12 of 72 (1.9) | 24 of 72 (2.2) | 16 of 72 (0.9) | 24 of 72 (2.0) |
| 0 | 1, 4 | 0 of 144 | 0 of 144 | 0 of 144 | 0 of 144 |
| 0.5 | 0.05 | 72 of 72 (0.4) | 72 of 72 (0.4) | 72 of 72 (0.4) | 70 of 72 (0.6) |
| 0.5 | 0.25 | 0 of 72 | 0 of 72 | 6 of 72 (2.2) | 0 of 72 |
| 0.5 | 1, 4 | 0 of 144 | 0 of 144 | 0 of 144 | 0 of 144 |
| 1 | 0.05 | 26 of 28 (0.6), 44 empty | 22 of 24 (0.3), 48 empty | 29 of 31 (0.7), 41 empty | 24 of 26 (0.7), 46 empty |
| 1 | 0.25 | 4 of 26 (1.4), 46 empty | 2 of 12 (2.1), 60 empty | 4 of 26 (1.2), 46 empty | 8 of 18 (0.1), 54 empty |
| 1 | 1, 4 | 0 of 34, 110 empty | 0 of 8, 136 empty | 0 of 26, 118 empty | 0 of 22, 122 empty |

  - **Size 0.05** almost never leads by 3 dB: its whole figure-of-eight is
    36 ms round, so both halves fill inside the first window whatever side
    fed it. Its least lead is 0.2 to 0.7 dB.
  - **Size 0.25** at Build 0 and 0.5 misses 3 dB only where an input
    diffusion is at 1, which smears the click past the window. At Build 1 it
    misses too where the first arrival lands near the window's end: at
    diffusion 0 the chain is a plain 29 ms delay, and Build's spread adds
    to it.
  - **Size 1 and 4** lead in every cell that has heard anything.

## Sample rates

Both chains' lengths are seconds: at 44.1, 48 and 96 kHz every diffuser is
its 48 kHz length in seconds within a sample, every line holds its length
with the read's reach to spare, both pre-delay rings hold `MAX_PRE_DELAY`
plus a quantum, and both Build lines are one length
(`mixer/reverbStereo.test.ts`; Build's own test holds its taps).

## CPU

The plate's render cost per quantum: stereo noise in (L and R apart),
the default space, sleep off (`bench.mjs` in Node, `benchPage.html` in
Chrome on the page's main thread, the same loop; the page and both bundles
were served from a local static server). Each figure is the median of
three runs, each run the median of seven runs of 20 000 quanta,
alternating the bundles. In Chrome six runs were made of each; about one
in four, of either bundle, stalled the page's thread and read over 200 µs,
and the figure is the median of the runs that did not (three to six).

| Backend | `main` Build 0 | new Build 0 | `main` Build 1 | new Build 1 |
|---|---|---|---|---|
| Node 24.21.0 (V8) | 39.9 µs | 42.3 µs (+6 %) | 40.0 µs | 42.4 µs (+6 %) |
| Headless Chrome 155, main thread | 40.6 µs | 42.9 µs (+6 %) | 41.0 µs | 42.8 µs (+4 %) |

L's chain still reads its lines through `_read` and `_write1`, twice each.
Written with those calls, R's chain cost 11.8 µs; written out, 2.4 µs. The
same rewrite of L's chain would render the same bits and save about as
much, but it was not this ticket's.

## Scripts

- `rig.mjs`: loads a bundle under a stand-in worklet scope at any rate and
  renders it with a stereo, one-channel or empty input.
- `measure.mjs`: the windows, third-octave bands, T30 and rise the criteria
  read.
- `chains.mjs`, `select.mjs`: the right chain's choice; `chains-seed*.tsv`
  and `select.tsv` their output.
- `criteria.mjs`: the tables above, `node criteria.mjs <new> <main> [rate]`.
- `sweep.mjs`, `summary.mjs`: the whole box, and its lead by Size.
- `liveMoves.mjs`, `bench.mjs`, `benchPage.html`.

`main`'s bundle is `git show d627d18:packages/engine/src/worklet/generated/reverb-processor.js`.
