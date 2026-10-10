# RV-6: Retro Reverb's gain-ranging converter, measured

Converter is a new switch on the card: Linear (today's 12-bit truncating
quantiser) or Gain-ranging. Gain-ranging puts the same 12-bit quantiser behind
a gain of 0 to 30 dB in 6 dB steps and scales the result back down, the way
the Lexicon 224 and EMT 250 era converters ranged their gain. A quiet tail
keeps its grain, and its noise floor steps down with it instead of truncating
to zero at -66 dBFS. The converter runs at both conversion points: once on
the input each internal tick, and on each wet output. Character still blends
the clean and converted samples, and at Character 0 both converters are the
clean signal to the bit.

The code is `packages/engine/src/worklet/retro/retroConverter.ts`; the
tunables are `rangingSteps`, `rangingCeiling` and `rangingHoldSeconds` in
`packages/engine/src/inserts/retroReverbConstants.ts`.

All figures below: Apple M1, macOS (Darwin 25.6.0), arm64. Backend: Node
v24.21.0 / V8 13.6.233.17-node.53, offline, running the shipped
`retro-reverb-processor.js` (the scripts load it as
`__fixtures__/retroReverbHarness.ts` does). No browser was involved.

## The numbers, and how each was chosen

All are Windsor's own.

| Tunable | Value | Why |
|---|---|---|
| Bit depth | 12 bits (`converterSteps` 2048, shared with Linear) | At unity gain the ranging quantiser is Linear's, to the bit, so a switch to Gain-ranging starts seamlessly and the two modes differ only in the ranging. |
| Gain steps | 5 steps of 6 dB (gains 1, 2, 4, 8, 16, 32) | 30 dB more range: the tail keeps its grain down to -96 dBFS, about 17 bits of range, the quiet end of a 16-bit converter. Each step is one bit, so scaling up and back down is exact in floating point. |
| Hysteresis | `rangingCeiling` 0.5: a step up only while the window's peak would sit at least 6 dB under the next range's full scale | The step down comes on the sample that would clip; a 6 dB gap between the two thresholds means a signal must grow by a whole step to undo a step up. |
| Window (hold) | `rangingHoldSeconds` 0.01 s, then the next zero crossing | The window's peak reads at least sin(π × 0.01 × 20) = 0.59 of a 20 Hz wave's peak wherever the window falls, so with the 6 dB above, a step up never clips the next peak (0.5 / 0.59 = 0.85 of full scale) and the range cannot flap on a low note. A longer window trails a fast tail: Decay 0.2 s falls 3 dB in 10 ms. |
| Where a step up lands | The first zero crossing after the window | Truncation towards zero makes the error at most the sample itself, so at a crossing the error is near zero in both ranges and the step hides. |
| Step down | At once, as many steps as the sample needs | The sample that would clip the range never clips. |
| Dither | None | Zero in is zero out: a tail still ends in exact zeros (now under -96 dBFS), so the tank's silence floors work as before and nothing hisses after the tail. |
| Switching | The ranging share is smoothed per block like the mode (`smoothSeconds` 0.05 s), so a switch crossfades the quantised value | At exactly 0 the converters take the Linear path alone; a switch away from 0 starts the detectors at unity gain. |

## Linear is today's path, bit for bit

`retroReverbNeutralPin.test.ts` stays green. Beyond the pin, a scratch
script rendered this branch's bundle against main's (`65830f8`) with Linear
at defaults, gated, reverse, and three settings with Early, Drift and Density
on (Size 0.25 to 10, Decay 0.2 to 20, Tone 800 to 9000, pre-delay 0 and 0.1 s,
Character 0.4 to 1), plus one render that moves Early, Density, Drift, Size,
Character, pre-delay and the mode live: 0 differing samples in 1.68 million.

## Boundary sweep

Every combination of Character 0, 0.65 and 1; input -90, -70, -60, -40, -20
and 0 dBFS; a 220 Hz sine, uniform noise, and a 50 ms noise burst followed by
its decaying tail; reverb, gated and reverse; Size 0.25 and 10; Decay 0.2 and
20 s; Tone 800 and 9000 Hz. That is 432 settings, 1.2 s each at 48 kHz, Mix 1,
rendered with Character 0 (clean) in both converters and with Character 0.65
and 1 in each.

- **NaN:** none, in any of the 2,160 renders.
- **Character 0:** Gain-ranging equals Linear to the bit in all 432 settings.
- **Level:** in 20 ms windows where the clean output is above -40 dBFS, the
  largest level difference between Gain-ranging and Linear is 0.22 dB
  (inside ±0.5 dB), and Gain-ranging sits within 0.05 dB of the clean signal.

Error-to-signal over 20 ms windows of the output, against the Character 0
render, by the clean output's level (worst window across every setting):

| Character | Clean output, dBFS | Windows | Worst error-to-signal, Linear | Gain-ranging | Largest \|ranging − linear\| level | Largest \|ranging − clean\| level |
|---|---|---|---|---|---|---|
| 0.65 | -40 to 0 | 9341 | 32.1 dB | 43.4 dB | 0.14 dB | 0.03 dB |
| 0.65 | -60 to -40 | 6513 | 13.5 dB | 24.3 dB | 1.77 dB | 0.28 dB |
| 0.65 | -80 to -60 | 7630 | 1.1 dB | 7.3 dB | 19.84 dB | 3.82 dB |
| 0.65 | -96 to -80 | 6576 | 1.1 dB | 1.2 dB | 21.72 dB | 10.16 dB |
| 1 | -40 to 0 | 9341 | 28.4 dB | 39.6 dB | 0.22 dB | 0.05 dB |
| 1 | -60 to -40 | 6513 | 9.8 dB | 20.6 dB | 2.92 dB | 0.43 dB |
| 1 | -80 to -60 | 7630 | 0.0 dB | 3.7 dB | (Linear silent) | 6.33 dB |
| 1 | -96 to -80 | 6576 | 0.0 dB | -2.3 dB | (Linear silent) | (ranging silent) |

Below -40 dBFS the two are meant to differ: Linear truncates the signal and
Gain-ranging keeps it, so their levels part by up to 22 dB until Linear is
silent. The worst windows from -60 to -40 dBFS are the gated field's abrupt
end (-20 dBFS noise, every Size and Decay): the output falls by tens of dB
within a few milliseconds, and the range trails the fall by up to one window
(10 ms), so those windows read only about 3 dB better than Linear.

**Noise floor.** At each converter the error is at most one step of the
current range, 2^-11 / gain of full scale: never more than Linear's
(-66 dBFS), and at most -96 dBFS at the top gain. Truncation towards zero
also keeps it under the sample itself. Zero in gives exactly zero out, so
there is no floor without a signal, and a tail ends in exact zeros once it
falls under -96 dBFS (Linear: -66 dBFS). As a tail falls, its peak moves from
6 dB to 12 dB under its range's full scale while the error stays put, then
the range steps up: the error-to-signal ratio saws over 6 dB a step, the floor
that breathes.

## Clicks at a range change

The converter alone at the internal clock (Character 1, fully ranging), on
signals that walk every range: the largest sample-to-sample step of the
error (output minus clean) on a sample where the range changed, against the
largest anywhere else.

| Signal | Steps up | Steps down | Largest error step at a step up | At a step down | Elsewhere | Steps down within 10 ms of a step up |
|---|---|---|---|---|---|---|
| sine tail, Decay 0.2 | 5 | 0 | -68.4 dBFS | — | -60.7 dBFS | 0 |
| sine tail, Decay 4 | 5 | 0 | -69.5 dBFS | — | -60.4 dBFS | 0 |
| sine tail, Decay 20 | 2 | 0 | -66.3 dBFS | — | -60.4 dBFS | 0 |
| noise tail, Decay 0.2 | 5 | 0 | -70.6 dBFS | — | -60.6 dBFS | 0 |
| noise tail, Decay 4 | 5 | 0 | -72.2 dBFS | — | -60.3 dBFS | 0 |
| 20 Hz swell, -100 to 0 to -100 dBFS | 6 | 5 | -70.6 dBFS | -84.1 dBFS | -62.8 dBFS | 0 |
| 40 Hz bursts over silence | 20 | 76 | −∞ (no error change) | -78.3 dBFS | -66.4 dBFS | 0 |

A range change never steps the error further than the quantiser steps it
anyway, and no range flapped (a step up undone within 10 ms). The step
counts are samples on which the range moved; after silence or a fast fall one
such sample can move several steps.

## Switching the converter live

Reverb, gated and reverse; a 300 Hz sine with noise at -60, -30 and
0 dBFS, on for 250 ms and off for 250 ms, so tails and onsets both cross a
switch; Character 0.65 and 1; Decay 2. The converter switched four times
(blocks 140, 390, 600 and 900) in each direction. The table compares the
largest sample-to-sample step of the switched render minus an all-Linear
render with the same for an all-Gain-ranging render.

| Mode | Input | Character | Largest step, switched L→R→L | Switched R→L→R | All ranging |
|---|---|---|---|---|---|
| reverb | -60 dBFS | 0.65 | -92.4 | -91.9 | -91.9 |
| reverb | -60 dBFS | 1 | -90.2 | -89.7 | -89.5 |
| reverb | -30 dBFS | 0.65 | -72.6 | -71.9 | -71.8 |
| reverb | -30 dBFS | 1 | -68.2 | -68.3 | -68.2 |
| reverb | 0 dBFS | 0.65 | -72.5 | -73.1 | -72.3 |
| reverb | 0 dBFS | 1 | -68.7 | -68.7 | -68.2 |
| gated | -60 dBFS | 0.65 | -75.7 | -77.0 | -76.3 |
| gated | -60 dBFS | 1 | -72.5 | -72.8 | -85.3 |
| gated | -30 dBFS | 0.65 | -71.2 | -71.0 | -71.0 |
| gated | -30 dBFS | 1 | -67.5 | -67.2 | -67.2 |
| gated | 0 dBFS | 0.65 | -73.2 | -72.7 | -72.6 |
| gated | 0 dBFS | 1 | -69.5 | -69.0 | -68.8 |
| reverse | -60 dBFS | 0.65 | -87.6 | -87.8 | -87.6 |
| reverse | -60 dBFS | 1 | -83.8 | -84.3 | -85.1 |
| reverse | -30 dBFS | 0.65 | -72.3 | -71.6 | -71.6 |
| reverse | -30 dBFS | 1 | -68.1 | -67.2 | -67.2 |
| reverse | 0 dBFS | 0.65 | -72.5 | -72.4 | -71.4 |
| reverse | 0 dBFS | 1 | -68.7 | -68.6 | -67.7 |

All values dBFS; no NaN. Every step is under one Linear step (-66.2 dBFS at
Character 1), so a switch is never louder than the Linear quantiser's own
grain. The one row above the all-ranging reference (gated, -60 dBFS,
Character 1) is not the switch: it falls in the crossfade back to Linear,
where the Linear converter truncates a gated tail that ranging had kept in the
tank, and the all-Linear reference never had that tail to truncate.

## CPU

`rv6-bench.mjs` (beside this file) is `rv4-bench.mjs` with a converter
argument in place of Size, at Character 1 and Mix 1, fed a sine falling 60 dB
a second from 0.25 and restarting every 2 s, so the ranging detector walks
every range. Seven interleaved rounds of the three cases; each value is the
median round (range in brackets), each round the median of six timed passes
of 1,500 quanta. CPU microseconds per 128-frame quantum per instance at
48 kHz. Other sessions kept the machine busy (load average 4.4 to 7.5).

| Case | 1 instance | 8 | 16 |
|---|---|---|---|
| main (`65830f8`) | 11.45 (11.14–13.68) | 11.21 (10.74–12.27) | 11.05 (10.86–12.02) |
| this branch, Linear | 12.05 (11.40–13.70) | 11.73 (10.94–12.93) | 11.40 (11.26–12.88) |
| this branch, Gain-ranging | 13.43 (12.27–13.96) | 12.49 (11.99–13.60) | 12.15 (11.90–13.72) |

Linear costs about 0.4–0.6 µs a quantum more than main (the converters are
now objects of their own, three calls a tick, and the ranging share is
checked each call), within the rounds' spread. Gain-ranging adds about 0.8–1.4
µs over Linear: the detector runs about 190 times a quantum at the three
conversion points.

## Listening

Renders in `~/Desktop/retro-reverb/rv6/` (not in the repo), wet only (Mix 1),
Decay 4, Linear and Gain-ranging at Character 0.65 and 1: a synthetic snare, a
4 s pad fading from -12 dBFS to silence, and a -30 dBFS chord held 2 s. At
Character 1 the tail runs on to exact zero about 2 s longer in Gain-ranging
(snare 3.37 → 5.31 s, pad 2.60 → 4.57 s, quiet chord 4.19 → 6.08 s), which is
30 dB at Decay 4's 15 dB a second. At Character 0.65 neither reaches zero:
the clean share carries the tail.
