# RV-2: Retro Reverb tank drift, measured

Drift moves the four tank-line reads with one triangle LFO at `driftRate`, each
line by its signed share of a 0.5 ms excursion scaled by `driftDepth`, and
sweeps a short delay on each wet output (0 to 2 ms at depth 1), L and R in
opposite directions. The tunables are `driftExcursion`, `driftLineDepths` and
`detuneExcursion` in `packages/engine/src/inserts/retroReverbConstants.ts`.

All figures below: Apple M1, macOS (Darwin 25.6.0), arm64. Backend: Node
v24.21.0 / V8 13.6.233.17-node.53, offline, running the shipped
`retro-reverb-processor.js`. No browser was involved. These numbers are for
complete worklet callbacks on a warm JIT, not real-time load in Chrome.

## CPU

`rv2-bench.mjs` (beside this file) is the 2026-09-24 bench
(`../2026-09-24-682-retro-reverb/bench.mjs`) with three changes: today's
bundle path, a bundle argument so a copy of the main bundle can run too, and
Drift settings. It runs reverb mode, Mix 1 and a 0.25 sine input. Each value
is the median of three runs, interleaved with the other cases, and each run is
the median of six timed passes of 1,500 quanta. The unit is microseconds per
128-frame quantum per instance at 48 kHz.

| Case | 1 instance | 8 | 16 |
|---|---|---|---|
| before (main `0b43b7b`), depth 0 | 9.31 | 9.23 | 9.25 |
| after, depth 0 | 9.34 | 9.28 | 9.27 |
| after, depth 1, 0.5 Hz | 12.07 | 11.84 | 11.78 |
| after, depth 1, 5 Hz | 12.01 | 11.82 | 11.80 |

At depth 0 the cost is unchanged, within about 0.05 µs. While the depth is 0,
the LFO holds, the line reads use today's expression and the output delays are
skipped. A first version that always ran the LFO and always wrote the output
delays cost about 0.45 µs (5 %) more at depth 0, so the depth-0 path now skips
them.

Drift on adds about 2.6 µs a quantum (28 %), and the rate does not change it.
Moving the four line reads costs about 0.6 µs of that. The other 2 µs is the
two output delays, two writes and two reads a sample. That matches what a
delay read and write costs elsewhere in the tank.

## Decay: RT60 by band

Settings: an impulse, Decay 2 s, Tone 9 kHz (the least line damping),
Character 0, Mix 1, L+R. Each band runs through two 2-pole Butterworth
sections, and the RT60 is a least-squares slope of the backward-integrated
energy from −5 to −25 dB, scaled to 60 dB.

| Size | Depth | Rate | < 3 kHz | 250 Hz–3 kHz | broadband | 3–9 kHz |
|---|---|---|---|---|---|---|
| 0.25 | 0 | – | 1.78 | 1.67 | 1.75 | 0.68 |
| 0.25 | 1 | 0.3 | 1.73 | 1.63 | 1.70 | 0.66 |
| 0.25 | 1 | 2 | 1.76 | 1.64 | 1.74 | 0.71 |
| 0.25 | 1 | 5 | 1.77 | 1.66 | 1.75 | 0.69 |
| 1 | 0 | – | 1.86 | 1.82 | 1.80 | 1.19 |
| 1 | 1 | 0.3 | 1.80 | 1.78 | 1.76 | 1.23 |
| 1 | 1 | 2 | 1.84 | 1.80 | 1.79 | 1.20 |
| 1 | 1 | 5 | 1.84 | 1.80 | 1.78 | 1.19 |
| 3 | 0 | – | 1.94 | 1.91 | 1.85 | 1.44 |
| 3 | 1 | 0.3 | 1.88 | 1.87 | 1.84 | 1.61 |
| 3 | 1 | 2 | 1.95 | 1.93 | 1.88 | 1.55 |
| 3 | 1 | 5 | 1.94 | 1.93 | 1.87 | 1.53 |

Below 3 kHz, full depth stays within 3.1 % of the depth-0 RT60 and within
14 % of the set decay. Today's path is already 3 to 11 % short of the set
decay. At depth 0, Tone's one-pole and the fractional read each line already
makes take away the difference.

The broadband shortfall at full depth is 6 to 15 % against the set decay
(1.70 to 1.88 s for 2 s), and −3 % to +2 % against depth 0. The interpolated
read does lose high end on each pass. But the line delays were already
fractional at depth 0, each at its own fixed fraction, and a moving read
sweeps every fraction, losing more at some and less at others. So the 3–9 kHz
decay moves by −3 % to +12 %, with no consistent loss. The behaviour test in
`inserts/retroReverbDsp.test.ts` asserts the RT60 below 3 kHz at full depth,
2 Hz and Size 1. Its own one-pole measure reads 1.96 s, against a 10 %
tolerance of the set 2 s.

## Ringing and width

The tail from 0.5 s, Decay 3 s, left channel: the FFT's peak bin over its
median bin, in dB, averaged over third-octave bands from 200 Hz to 3 kHz.
Lower means fewer standing modes. The second figure is the L/R correlation of
the same stretch.

| Size | Depth | Rate | peak over median | L/R correlation |
|---|---|---|---|---|
| 0.25 | 0 | – | 50.2 dB | −0.09 |
| 0.25 | 0.5 | 0.3 | 43.2 dB | −0.09 |
| 0.25 | 1 | 0.3 | 34.9 dB | −0.04 |
| 0.25 | 1 | 2 | 15.9 dB | −0.01 |
| 1 | 0 | – | 30.4 dB | −0.18 |
| 1 | 0.5 | 0.3 | 26.4 dB | −0.06 |
| 1 | 1 | 0.3 | 22.2 dB | −0.03 |
| 1 | 1 | 2 | 11.6 dB | +0.03 |

## Depth 0 is today's sound

Six settings, an impulse and a 100 ms noise burst each, 3 s at 48 kHz: the
settings are reverb at defaults, Size 3 with Decay 8, Size 0.25 with Decay
0.5, gated, reverse, and Mix 0.3 with pre-delay. Every one of the 3.4 million
output samples from the RV-2 bundle equals main's bit for bit.
`retroReverbNeutralPin.test.ts` is unchanged and green.

## Gated and reverse skip Drift

Drift's depth is scaled by the tank's share of the wet output, `1 - finite`,
and is off once that share is under the floor. In reverb mode the share is 1
exactly, so reverb mode is unchanged: renders at depth 0.5 and 1 (rates 0.7
and 3 Hz) hash the same as before. In gated and reverse Drift costs nothing,
and their output at depth 1 equals depth 0 (`retroReverbDsp.test.ts`).
