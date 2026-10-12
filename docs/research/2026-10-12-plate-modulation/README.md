# The plate's tank modulation: four points, smoothed noise

Written 2026-10-12 for windsor#764, item 4 of
`docs/research/2026-10-11-plate-reverb-upgrades/README.md`. The decision
record is `docs/log/2026-10-12-plate-modulation.md`.

Every figure here was read in Node 24 on an Apple M1 (macOS 26), at 48 kHz
unless a table says otherwise, by the scripts in this folder. `main` is the
bundle at ca06820, before this change; `new` is this branch's. `rig.mjs`
says how to write `main-reverb.js` beside it.

## What changed

Before, one sine and one cosine (detuned 1.0007) moved two tank all-passes,
lines 4 and 8, by `modDepth × (1 + cos)`: a read up to twice `modDepth`
shorter, at `modRate`. Now all four tank all-passes (lines 4, 6, 8 and 10)
move, each read cubic, each from its own source:

- **Smoothed noise.** The point glides from one drawn knot to the next along
  `3a² − 2a³`, with zero slope at each knot. Knots alternate between the upper
  half of the range and the lower, so every knot turns the point round, and
  each segment lasts a drawn 0.5 to 1.5 half-periods. So `modRate` is the
  average rate in Hz, and `modDepth` in ms is each point's peak excursion: the
  read moves from its line's length to `modDepth` shorter.
- **Seeded.** Each point's knots and widths are drawn once, at load, from
  `fm/prng.ts`'s generator at a fixed seed of its own, into one shared table
  of 2^15 draws a point. A plate reads it through cursors that sleep resets.
- **Clamped and ramped.** Each point's depth is clamped against the shortest
  its own line reaches in the block (`MIN_LENGTH` short of it) and ramped
  across the block. The source and the excursions are written out in the
  tank's sample loop with no call and no `Math` transcendental.
- **The gains follow.** Each moving all-pass's gain point is cut for its
  line's length less the source's mean excursion ("The tail's length"), and
  the decay table was measured again for lines 6 and 10's cubic reads.
- **The default** is 3 Hz and 0.35 ms, where `main`'s was 0.5 Hz and 0.7 ms.

The candidates' figures below were read from a measurement bundle before the
gain cut and the re-measured table; the tables after them from the shipped
bundle.

## The source: two candidates

The issue named two: a triangle whose direction flips at irregular intervals,
and smoothed noise. Both were built in one measurement bundle, behind a
switch, with the same knots (the triangle ran at constant speed from knot to
knot, so its segment's length followed its span), and read on the default
space for a steady 1 kHz sine's spread and for the strongest 0.1–10 Hz
component of the same sine held under HOLD (both described under "The
default" below).

| rate, depth | triangle: spread Hz | held dB | smoothed noise: spread Hz | held dB |
|---|---|---|---|---|
| 1 Hz, 0.4 ms | 0.92 | −9.3 | 0.92 | −15.2 |
| 2 Hz, 0.4 ms | 0.98 | −14.7 | 1.21 | −18.3 |
| 1 Hz, 0.5 ms | 1.17 | −11.6 | 1.30 | −19.3 |
| 2 Hz, 0.5 ms | 1.35 | −16.6 | 2.39 | −19.9 |
| 1.5 Hz, 0.5 ms | 1.23 | −16.4 | 1.69 | −19.8 |
| 1 Hz, 0.7 ms | 1.73 | −19.8 | 2.28 | −18.9 |
| 3 Hz, 0.5 ms | 2.06 | −20.5 | 3.22 | −21.1 |

At the same knob values the triangle spreads a little less, but what matters
is how much a held note still beats for a given spread. Under about 1.5 Hz of
spread smoothed noise reaches −19 dB where the triangle stays above −17: at
1.30 Hz it reads −19.3 dB, and the triangle needs 1.73 Hz for −19.8. The
triangle's pitch is always one of two (up or down at one speed), a pair of
lines either side of the note; smoothed noise passes through every pitch
between, and spends time at none. **Smoothed noise ships.**

## The default

Read on the default space (Size 1, Decay 3.35 s, Build 0.1) at 48 kHz:

- **Spread:** a 1 kHz sine at 0.3, steadily, 12 s; the RMS width in Hz of the
  left wet channel's Welch spectrum (Hann, 32 768 points, half overlapped)
  from 4 s to 12 s, within ±250 Hz of 1 kHz. A still tank reads 0.85 Hz, the
  window's own width.
- **Held beat:** the same sine for 2 s, HOLD from 1.9 s; the wet's envelope
  (RMS over 10 ms) from 3 s to 33 s; Welch over 10 s Hann segments, half
  overlapped; the strongest component between 0.1 and 10 Hz, in dB re the
  envelope's mean, the louder side. A still tank reads −5.6 dB: under HOLD the
  tank's own modes near 1 kHz beat at their spacing, about 1.3 Hz, the ringing
  at the tank's resonances the modulation is there to break.
- **Fed beat:** the same reading with the sine fed throughout, a held note.
- **Held at four tones:** the held beat at 250, 500, 1 000 and 2 000 Hz.

| | spread Hz | held beat dB | fed beat dB | held at 250 / 500 / 1k / 2k |
|---|---|---|---|---|
| `main`, its default (0.5 Hz, 0.7 ms) | 2.12 | −18.5 | −10.9 (at 1.00 Hz, twice the rate) | −13.3 / −14.9 / −18.5 / −22.0 |
| new, 1 Hz, 0.5 ms (as shipped) | 1.30 | −19.3 | −13.0 | −10.0 / −11.3 / −19.3 / −20.2 |
| new, 1.5 Hz, 0.5 ms | 1.69 | −19.8 | −15.3 | −7.7 / −14.2 / −19.8 / −22.0 |
| new, 2 Hz, 0.4 ms | 1.21 | −18.3 | −18.0 | −9.6 / −16.3 / −18.3 / −21.6 |
| new, 2.5 Hz, 0.4 ms | 1.53 | −18.4 | −20.3 | −11.4 / −15.5 / −18.4 / −21.6 |
| new, 3 Hz, 0.3 ms | 1.12 | −16.3 | −23.3 | −8.9 / −16.3 / −16.3 / −21.5 |
| **new, 3 Hz, 0.35 ms** | **1.34** | **−19.8** | **−21.7** | −11.8 / −17.0 / −19.8 / −21.2 |
| **the same, as shipped** | **1.33** | **−19.9** | **−21.7** | −11.8 / −17.0 / −19.9 / −21.2 |
| new, 3 Hz, 0.4 ms | 1.75 | −19.7 | −20.3 | −10.4 / −15.8 / −19.7 / −22.3 |
| new, 3.5 Hz, 0.35 ms | 1.46 | −18.6 | −23.4 | −10.3 / −16.7 / −18.6 / −21.2 |

**The default is 3 Hz and 0.35 ms.** Of the cells measured whose held 1 kHz beat falls
below `main`'s, two spread a 1 kHz sine less than 1.4 Hz: 1 Hz at 0.5 ms
(1.30 Hz) and 3 Hz at 0.35 ms (1.33 Hz). The second beats far less on a fed
note (−21.7 against −13.0 dB) and on a held 500 Hz one (−17.0 against
−11.3 dB), for 0.03 Hz more spread, so it ships. It spreads a 1 kHz sine 37 % less than
`main`'s default (1.33 against 2.12 Hz), a held 1 kHz note beats 1.4 dB less
(−19.9 against −18.5 dB), and a fed one 10.8 dB less with no line at the rate:
`main`'s fed note beats at 1.00, 3.00 and 5.00 Hz, multiples of its rate, where
the new one's strongest component wanders. At 250 Hz the held beat is 1.5 dB
stronger than `main`'s (−11.8 against −13.3 dB): a 0.35 ms excursion turns a
250 Hz wave by under a third of a cycle, so the low modes break up less. The
ear decides on the preview.

A cell's held beat scatters by a couple of dB from its neighbours: the beat
is a sum of many partials with random phases, and one 30 s reading is one
draw of it. The default's neighbours sit between −16.2 and −19.7 dB.

The cells above were read before the last two changes (the re-measured decay
table and the moving all-passes' gains, under "The tail's length"); the
shipped default reads the row marked "as shipped".

## The spread over the whole of `modRate` and `modDepth`

RMS width in Hz, as above. A still tank reads 0.85 Hz.

`main`:

| depth \ rate | 0.25 | 0.5 | 1 | 2 | 3 | 4 | 8 |
|---|---|---|---|---|---|---|---|
| 0 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 |
| 0.1 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.88 | 1.30 |
| 0.25 | 0.89 | 1.02 | 1.55 | 1.74 | 5.24 | 4.18 | 4.70 |
| 0.35 | 0.98 | 1.60 | 2.53 | 5.92 | 9.14 | 8.20 | 6.44 |
| 0.5 | 1.08 | 1.85 | 3.16 | 5.96 | 8.96 | 6.87 | 6.36 |
| 0.7 | 1.16 | 2.12 | 4.38 | 7.26 | 12.21 | 10.87 | 15.64 |
| 1 | 1.85 | 3.72 | 6.26 | 12.22 | 17.00 | 13.58 | 19.96 |
| 2 | 3.84 | 7.45 | 15.28 | 23.75 | 31.74 | 40.21 | 45.18 |
| 4 | 7.34 | 14.55 | 27.08 | 47.84 | 59.12 | 56.72 | 93.00 |

new:

| depth \ rate | 0.25 | 0.5 | 1 | 2 | 3 | 4 | 8 |
|---|---|---|---|---|---|---|---|
| 0 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 | 0.85 |
| 0.1 | 0.85 | 0.85 | 0.85 | 0.86 | 0.87 | 0.88 | 0.98 |
| 0.25 | 0.85 | 0.86 | 0.87 | 0.91 | 1.00 | 1.09 | 1.77 |
| 0.35 | 0.86 | 0.87 | 0.89 | 1.02 | 1.33 | 1.64 | 2.98 |
| 0.5 | 0.90 | 1.02 | 1.30 | 2.39 | 3.21 | 4.01 | 5.69 |
| 0.7 | 0.97 | 1.48 | 2.28 | 4.40 | 5.29 | 6.46 | 9.60 |
| 1 | 1.20 | 1.81 | 2.97 | 5.49 | 7.45 | 8.31 | 12.32 |
| 2 | 1.37 | 2.78 | 6.08 | 9.66 | 14.78 | 17.74 | 28.79 |
| 4 | 2.62 | 5.86 | 10.98 | 20.22 | 30.46 | 33.46 | 56.82 |

At any one setting the new plate spreads less, by about half at the top:
`modDepth` is now the peak excursion, where `main` moved twice it, and the
noise's speed averages less than a sine's peak. The `SPACES` rows keep their
numbers (item 8 re-voices the bank), so each now modulates more lightly.

## The held beat beside `main`'s

The held and fed beats at 1 kHz, as above, at the same knob values:

| rate, depth | `main` held | new held | `main` fed | new fed |
|---|---|---|---|---|
| 0.5 Hz, 0.35 ms | −14.5 | −10.8 | −8.8 | −13.1 |
| 1 Hz, 0.35 ms | −17.7 | −13.4 | −7.1 | −20.1 |
| 3 Hz, 0.35 ms | −21.9 | −19.9 | −8.2 | −21.7 |
| 8 Hz, 0.35 ms | −14.2 | −20.9 | −5.1 | −27.8 |
| 0.5 Hz, 0.7 ms | −18.5 | −17.1 | −10.9 | −11.6 |
| 0.5 Hz, 2 ms | −24.3 | −21.4 | −12.3 | −11.8 |
| 1 Hz, 2 ms | −29.2 | −22.9 | −14.7 | −16.5 |
| 3 Hz, 2 ms | −31.6 | −29.3 | −19.6 | −19.5 |
| 8 Hz, 2 ms | −29.1 | −31.0 | −12.8 | −22.8 |
| 0.5 Hz, 4 ms | −27.7 | −24.8 | −15.4 | −15.4 |
| 3 Hz, 4 ms | −33.5 | −31.8 | −25.8 | −22.2 |
| 8 Hz, 4 ms | −30.5 | −34.2 | −16.5 | −25.2 |

At the same slow, light setting a held note beats more on the new plate than
on `main`, because the same knob now moves it about half as far: under HOLD
the beat comes from the tank's modes, and only enough movement breaks them.
A fed note beats less at almost every setting, because nothing in the new
source repeats. The criterion is read at each plate's default, where the new
held beat is the lower.

## The sequence never comes round within ten minutes

A point takes two draws a segment and averages two segments a cycle. At the
top rate, 8 Hz, its 2^15 draws last the sum of their widths over 16 s:
1 025.4, 1 023.1, 1 019.9 and 1 027.1 s for lines 4, 6, 8 and 10.
`mixer/reverbModulation.test.ts` sums them. Below 8 Hz they last longer in
proportion; at `modRate` 0 the points hold still.

## A held tank (HOLD)

A tone for 2 s, HOLD from 1.9 s, 64 s rendered (`hold.mjs`). Two readings:
the tank's stored energy (every tank line's samples inside its length),
sampled every 0.5 s from 3 s, min..max in dB re the first and its value at
63 s; and the wet level in 5 s windows from 3 s, min..max re the first.

| plate, setting, tone | tank energy dB (at 60 s) | wet level dB |
|---|---|---|
| `main`, still, 40 Hz | −0.46..0.19 (−0.30) | −0.33..0.00 |
| `main`, still, 220 Hz | −0.81..0.23 (−0.50) | −0.47..0.06 |
| `main`, still, 1 kHz | −6.78..0.13 (−6.77) | −6.18..0.00 |
| `main`, 0.5 Hz 0.7 ms, 40 Hz | −0.42..0.15 (−0.29) | −0.35..0.00 |
| `main`, 0.5 Hz 0.7 ms, 220 Hz | −1.01..0.00 (−0.98) | −0.77..0.00 |
| `main`, 0.5 Hz 0.7 ms, 1 kHz | −6.21..0.23 (−6.10) | −6.51..0.00 |
| `main`, 8 Hz 4 ms, 40 Hz | −1.19..**36.17** (36.17) | −0.51..**29.50** |
| `main`, 8 Hz 4 ms, 220 Hz | −1.58..**20.90** (20.90) | −1.05..**13.51** |
| `main`, 8 Hz 4 ms, 1 kHz | −5.39..0.02 (−3.18) | −5.17..0.00 |
| new, still, 40 Hz | −0.46..0.19 (−0.30) | −0.32..0.00 |
| new, still, 220 Hz | −0.71..0.23 (−0.39) | −0.39..0.07 |
| new, still, 1 kHz | −4.31..0.15 (−4.24) | −3.89..0.00 |
| new, 3 Hz 0.35 ms, 40 Hz | −0.53..0.11 (−0.53) | −0.67..0.00 |
| new, 3 Hz 0.35 ms, 220 Hz | −0.96..0.59 (−0.86) | 0.00..**2.04** |
| new, 3 Hz 0.35 ms, 1 kHz | −4.34..0.06 (−4.34) | −4.24..0.00 |
| new, 8 Hz 4 ms, 40 Hz | **−1.39**..0.44 (−1.09) | −0.82..0.00 |
| new, 8 Hz 4 ms, 220 Hz | −0.89..0.19 (−0.75) | −0.67..0.01 |
| new, 8 Hz 4 ms, 1 kHz | −3.63..0.20 (−3.63) | −3.39..0.00 |

- **The four moving reads neither drain the loop nor feed it.** At 40 and
  220 Hz the tank's energy holds within ±1 dB at the default and within
  1.4 dB at the deepest, fastest corner, of which HOLD's own decay
  (`HOLD_DECAY` at the long lines) is 0.3 dB a minute. On `main` that corner
  ran away: its sine and cosine at 8 Hz and up to 8 ms grew a held 40 Hz tank
  by 36 dB in a minute.
- **At 1 kHz every held tank drains, still or moving, on `main` too.** The
  long lines (5, 7, 9 and 11) are read linearly between samples, and a linear
  read at a fractional length is a gentle lowpass taken on every pass. With
  them read cubic as well (`cubiclong` in `rig.mjs`), the held 1 kHz tank
  holds: −0.38..0.29 dB still, −0.33..0.34 at the default, −0.16..0.24 at the
  deepest corner. That is outside this ticket (the record's deviation 1).
  Here the moving tank drains no more than the still one: −4.34 and −3.63 dB
  against −4.24, where `main`'s still tank drained 6.77 dB (lines 6 and 10 are
  now cubic).
- **The wet level at 220 Hz at the default rises 2 dB** while the tank's
  energy holds (−0.96..0.59). Under light modulation the phases between the
  fourteen output taps drift slowly, so a held note's level wanders by a few
  dB over tens of seconds; at the deepest corner it averages out within the
  5 s windows. The record's deviation 2.

## Live moves

The no-step test of `2026-08-31-dattorro-reverb-not-plateau` §3, as
`mixer/reverbBuild.test.ts` runs it (`moves.mjs`): the largest left-channel
step from 1 s on, under a steady 220 Hz tone against three times its slew at
the render's peak, and under a drum loop (a 0.4 s noise burst for a tail,
then a kick every 0.5 s and a hat every 0.25 s) against the largest step of
the loop through the plate held still at either end of the move.

| move | 48 kHz tone | 48 kHz drums | 44.1 kHz tone | 44.1 kHz drums | `main` 48 kHz drums |
|---|---|---|---|---|---|
| `modDepth` 0 → 4 → 0, 1 s each way, 8 Hz | 0.33 | 0.956 | 0.33 | 0.961 | **1.086** |
| `modDepth` 0 → 4 → 0, 8 s each way, 8 Hz | 0.33 | 0.993 | 0.33 | 0.967 | 0.974 |
| `modRate` 0 → 8 → 0, 1 s each way, 4 ms | 0.33 | 1.000 | 0.33 | 0.957 | 0.933 |
| `modRate` 0 → 8 → 0, 8 s each way, 4 ms | 0.33 | 1.000 | 0.33 | 0.957 | **1.028** |
| Size 0.05 → 4 → 0.05, 8 s each way, 8 Hz 4 ms | 0.59 | 0.960 | 0.60 | 0.874 | 0.975 |

Each figure is the step over its ceiling; a pass is under 1 (tone) or at most
1 (drums). Every move passes at both rates. `main` failed two: its depth was
set once a block, unramped, so a fast depth move stepped the reads at each
block's edge. The drums' 1.000 cells are the still plate's own loudest step, a
kick, reached at the same sample; the moving tail under it lifts it by a hair
(1.0001 and 1.0002), so `mixer/reverbModulation.test.ts` allows 1 %.

## Sample rates

At Size 1, 8 Hz and 4 ms, each point's depth after a second is 4 ms at 44.1,
48 and 96 kHz to within a sample (`mixer/reverbModulation.test.ts`); the
source runs in seconds, its leftover time carried across each knot, so its
course does not depend on the rate. At 96 kHz and Size 0.05, where the clamp
binds hardest (line 4 is 108 samples there), every read stays more than three
samples behind its write head on every block. Where the clamp binds, a
point's depth is its line's length less `MIN_LENGTH`, 8 samples, which is
0.18 ms at 44.1 kHz and 0.08 ms at 96 kHz: at Size 0.05 the four points'
depths differ by that much between rates.

## The tail's length

`t30.mjs`: an impulse after 0.5 s at the asked Size, damping open (10 Hz,
20 kHz), `lowDecay` 1; T30 from the Schroeder integral of L² + R², −5 to
−35 dB, against Decay. "Deepest" is 8 Hz and 4 ms.

### Before the decay table was measured again

The table in `reverbDecayTables.ts` was measured with modulation off and lines
6 and 10 read linearly. With them cubic and the old table, at modulation off:

| Decay | Size 0.05 | 0.08 | 0.1 | 0.15 | `main` at 0.05 / 0.08 |
|---|---|---|---|---|---|
| 2 s | +0.3 % | +0.5 % | +0.4 % | +1.1 % | −1.3 / −0.6 % |
| 10 s | −0.2 % | +1.7 % | +1.8 % | +1.9 % | −2.6 / +0.1 % |
| 30 s | +5.2 % | +5.6 % | +3.9 % | +3.9 % | −1.6 / +2.4 % |
| 60 s | **+17.1 %** | **+12.5 %** | +5.8 % | +6.1 % | +0.7 / +4.2 % |

A cubic read loses less on each pass than a linear one, and a small tank is
passed many times a second, so its long tail ran long; the low band's 60 s
target at Size 0.05 (`mixer/reverbLowBand.test.ts`) read 20 % off. The table
was measured again with
`docs/research/2026-10-12-plate-decay-seconds/decayTable.mjs`, unchanged, on
the new bundle with every factor 1, each row in its own process. The factors
moved by up to 3 % from Size 1 up and up to 7 % from 0.3 to 0.7, and the
tank's ceilings rose: 92.8 s at Size 0.05 (73.9 before), 120.3 s at 0.075
(102.4), 168.7 s at 0.1 (141.6), 241.7 s at 0.15 (196.9). After it, at
modulation off:

| Decay | Size 0.05 | 0.08 | 0.1 | 0.15 |
|---|---|---|---|---|
| 2 s | −0.0 % | −0.1 % | −0.0 % | +0.0 % |
| 10 s | −0.0 % | +0.6 % | −0.0 % | −0.0 % |
| 30 s | −1.0 % | +2.7 % | −0.1 % | −0.0 % |
| 60 s | −0.8 % | +4.4 % | −0.5 % | −0.4 % |

The same script run on `main`'s own bundle, Size 1, reproduced its row to
within 0.2 %: the table predates Build and the stereo input, which moved it
that little.

### The criterion: Decay 2, 10 and 60 s at Size 0.25, 1 and 4

| Decay, Size | 48 kHz: still | default | deepest | 44.1 kHz: still | default | deepest | `main`: still | its default | deepest |
|---|---|---|---|---|---|---|---|---|---|
| 2 s, 0.25 | −0.1 | 0.0 | +0.1 | +0.7 | +0.8 | +1.0 | −0.5 | −0.6 | −3.0 |
| 2 s, 1 | +1.1 | +1.4 | +1.3 | +1.8 | +2.2 | +2.0 | +1.0 | +0.7 | +0.6 |
| 2 s, 4 | **−10.0** | −9.3 | −9.8 | **−10.3** | −9.8 | −10.0 | −9.9 | −9.5 | **−10.5** |
| 10 s, 0.25 | −0.6 | −0.6 | −0.7 | −0.3 | −0.3 | +2.8 | −0.5 | −1.0 | −3.3 |
| 10 s, 1 | 0.0 | +0.1 | +0.2 | +0.4 | +0.5 | +0.4 | −0.1 | −0.4 | −0.6 |
| 10 s, 4 | +1.2 | +1.3 | +1.5 | +1.5 | +1.6 | +1.7 | +1.2 | +1.2 | +1.4 |
| 60 s, 0.25 | −0.1 | −0.6 | −8.3 | −0.6 | −1.2 | −7.6 | +1.6 | +0.4 | **−24.6** |
| 60 s, 1 | −0.0 | −0.4 | +0.5 | −0.1 | −0.6 | +0.2 | 0.0 | −0.0 | −1.7 |
| 60 s, 4 | −0.0 | −0.2 | +0.1 | −0.0 | −0.2 | +0.4 | −0.1 | −0.2 | +0.7 |

`main`'s columns are at 48 kHz. In percent. Every cell holds ±10 % but Decay 2 s at Size 4, which sits on the
edge still as well as moving: its 0.6 s lines lose 18 dB a pass, so few passes
span the fit. `2026-10-12-plate-stereo-input` reported the same corner at
−9.4 to −10.4 %, and `mixer/reverbBuild.test.ts` holds it to 11 %.

At the deepest setting a long tail in a small tank runs short: each moving
read is up to its depth shorter than its line, half of it on average. Each
moving all-pass's gain point is therefore cut for its line's length less the
source's excursion (`tankGains.ts`): half the depth while the sources move,
and where each source rests at `modRate` 0. Without it Decay 60 s at Size 0.25
read −11.2 %, with it −8.3 %; what remains is the cubic reads' loss at a moving
fraction. Cutting for half the depth at rest too left Size 0.05 at 4 ms and
0 Hz +12.7 % long at Decay 10 s, where it now reads −0.0 %. Cutting for each
source's place at every block's start moved all eight gains every block, and
the tank's per-sample ramp of them cost 5 % a quantum.

## The whole box

`box.mjs` sweeps `modRate` (0, 3, 8 Hz) × `modDepth` (0, 0.35, 4 ms) × Size
(0.05, 0.25, 1, 4) × Decay (0.2, 10, 60 s) × Build (0, 1) × HOLD (off, on) ×
44.1 and 48 kHz: 576 cells, damping open. With HOLD off it reads the T30 of an
impulse; with HOLD on (Decay plays no part there, so once per cell) a 220 Hz
tone for 2 s, held from 1.9 s for 30 s, its wet level in 5 s windows and the
tank's energy at 33 s against 3 s. `boxSummary.mjs` reads a table;
`box-main.tsv` and `box-new.tsv` are the two runs.

Across all 576 cells no sample is non-finite.

- **Decay 10 and 60 s hold ±10 % from Size 0.25 up** in every cell, at both
  rates, every `modRate`, `modDepth` and Build (T30 error −8.7 to +2.2 %;
  `main` −23.8 to +2.3 %, its 8 Hz 4 ms cells at Size 0.25 out).
- **Size 0.05 at Decay 60 s runs short.** At 44.1 kHz it did on `main` too
  (−22.9 % still here, −22.6 % on `main`: the decay table is measured at
  48 kHz, record `2026-10-12-plate-decay-in-seconds` decision 5), and moving
  deepens it: −29.9 % at 3 Hz and −34.9 % at 8 Hz, 4 ms. At 48 kHz the still
  and default cells hold, and 4 ms reads −10.2 to −14.1 % at 3 Hz and −17.8 to
  −20.8 % at 8 Hz, where `main` read −1.3 to +1.2 %. A 36 ms tank is passed
  some 1 600 times a minute, and every pass takes four cubic reads at a
  moving fraction, whose loss the table (read with the tank still) does not
  hold. Decay 10 s at Size 0.05 holds but for one cell, 44.1 kHz at 8 Hz,
  4 ms, Build 1: −11.4 %.
- **Decay 0.2 s** reads +10 to +244 %, as on `main` (+8.5 to +246 %): a fifth
  of a second is shorter than the input stage's own ring and, from Size 1 up,
  than a trip round the tank.
- **HOLD feeds nothing**: the tank's energy at 33 s is at most +0.21 dB over
  its 3 s level (`main`: +0.67 dB, at 8 Hz 4 ms and Size 4). It drains
  wherever the tank is small, still or moving, as on `main`: Size 0.05 loses
  4.3 to 8.0 dB in 30 s (`main` 4.6 to 10.0), Size 0.25 1.2 to 3.5 dB
  (`main` 0.4 to 9.6), Size 1 at most 0.9 dB (`main` 1.8), Size 4 at most
  0.3 dB (`main` 1.0); the long lines' linear reads, as under "A held
  tank".
- **A held 220 Hz tone at Size 0.05 and 4 ms peaks up to 14.0** (48 kHz,
  8 Hz, Build 1) where `main` peaked 3.0. A steady tone fed to a tank this
  small meets its sharp modes as they sweep past; still, it sits between
  them. Broadband, the level holds: white noise at 0.3 through Size 0.05,
  Build 1, reads 0.70 RMS at 8 Hz 4 ms, 0.69 still and 0.58 on `main`
  (`peak.mjs`).

## CPU

The plate's render per 128-frame quantum, noise in at 0.25, sleep off, 48 kHz,
after two warm-up runs: the median of seven runs of 20 000 quanta in Node 24
(`bench.mjs`, a fresh process per figure), and of five in headless Chrome 155
on the page's main thread (`benchPage.html`, the same loop, each bundle
evaluated once). Apple M1, macOS 26, with other sessions sharing the machine
(load average 3 to 6). Both bundles ran interleaved three times each, and
each figure is the median of the three; the runs spread by up to 1.3 µs in
Node and 3.7 µs in Chrome.

| | Node 24 | Chrome 155 |
|---|---|---|
| `main`, its default (0.5 Hz, 0.7 ms) | 43.76 µs | 45.27 µs |
| new, its default (3 Hz, 0.35 ms) | 44.56 µs (+1.8 %) | 46.13 µs (+1.9 %) |
| `main`, 8 Hz 4 ms | 43.46 µs | 45.65 µs |
| new, 8 Hz 4 ms | 44.63 µs (+2.7 %) | 46.85 µs (+2.6 %) |

The four sources are a few multiplies a sample each, and two of the four
cubic reads replace linear ones. The gain cut is held still while the knobs
are: cut for each source's place every block, it moved all eight gain points
every block, and the tank's per-sample ramp of them cost about 5 % more
(41.7 against 43.6 µs in one Node session).

A first Chrome run re-evaluated each bundle for every figure: from about its
eighth evaluation in one page either bundle's render fell to 350 µs a quantum
(`main`'s fell from 41 to 277 µs by its tenth in one Node process), so the
page now evaluates each bundle once, as a worklet scope does.

## Scripts

All run from the repository root with Node 24; `rig.mjs` says how to write
`main-reverb.js`.

- `rig.mjs`: the loader, the render, the Welch spectrum, the envelope, T30.
- `spread.mjs <variants> <rates> <depths>`: the spread grid.
- `beat.mjs <variant> <rate:depth,...> [tones]`: spread, held beat at each
  tone, fed beat at 1 kHz (`envlib.mjs` reads the envelope's spectrum).
- `hold.mjs <variants> <rate:depth,...> [tones]`: HOLD over 60 s.
- `t30.mjs <variants> <decays> <sizes> <depths> [rate]`: T30 against Decay.
- `moves.mjs <variant> [rate]`: the live moves.
- `box.mjs <variant> [rates]`, `boxSummary.mjs <tsv>...`: the whole box.
- `period.mjs`: how long each point's draws last at 8 Hz.
- `peak.mjs <variant> <size> <rate> <depth> <hz, 0 for noise> <build>`: a fed
  tone's or noise's wet level and peak.
- `bench.mjs <variant> '<params>'`, `benchPage.html`: the CPU.
