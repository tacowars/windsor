# RV-3: Retro Reverb Density, measured

Density reads four taps inside each of the tank's four lines, 16 in all, and
sums them into the outputs beside the line ends: two taps of every line to
each channel, one early and one late, so L and R share none. Each tap is
weighted by its line's gain to the power `f - 1`, where `f` is how far along
the line it sits, which puts it on the line end's decay envelope (the line's
whole loss is applied on write). Each channel is scaled by
`1 / sqrt(1 + Σ (d × weight)² / E)`, with `E` its line-end sum's energy in
taps, so Density 1 plays at the level of Density 0. The tunables are
`densityFractions`, `densityLeft`, `densityRight` and `densityMaxBoost` in
`packages/engine/src/inserts/retroReverbConstants.ts`; `E` is a measured
table over Tone, Size and Decay in `retroReverbDensityTables.ts` (fix round 2,
below), where the first version had one value per channel.

All figures below: Apple M1, macOS (Darwin 25.6.0), arm64. Backend: Node
v24.21.0 / V8 13.6.233.17-node.53, offline, running the shipped
`retro-reverb-processor.js`. No browser was involved.

## How the numbers were chosen

- **Tap positions.** A random search over four fractions per line, one in
  each fifth of 0.12 to 0.88, kept the set with the widest smallest gap
  between the arrival times (at Size 1) of the 16 taps, the 4 line ends, the
  ends' pairwise sums and each tap after one more full line, up to 110 ms.
  The kept set's smallest gap is 0.13 ms (3 samples of the internal clock).
  Any fraction within 0.012 of a ratio with a denominator up to 8 was refused,
  so no tap's later echoes (one line length apart) fall in step with its
  line's own. The fractions run from 0.219 to 0.818; Drift moves a line's
  read at most 0.5 ms, which is under 0.07 of the shortest line at the
  smallest Size (7.8 ms), so no tap reaches past the moving end. The taps are
  fractions of the line's current length, so they scale with any Size,
  including RV-4's larger range.
- **Signs.** Each channel takes two taps of every line. In the left channel
  both of line 0's taps carry the end's sign and the other three lines take
  one of each; in the right, line 1 is the one with both. Low notes add up
  across a line's taps, so a line whose two taps cancel adds no bass while
  the normalisation still turns its end down. Measured before the loudness
  constant below was set (`E = 4`), an all-alternating set (each line's two
  taps opposite) left the left channel 0.2 to 4.8 dB short below 250 Hz
  against Density 0; this set, 0 to 3.4 dB. The final figures are in the
  table below.
- **Loudness.** With taps and ends at ±1 and unrelated, the ends' energy
  would be 4 lines. Measured, the left end sum carries more (its signs line up
  with the feedback matrix) and the right less: with `E = 4` on both, Density
  1 played the left 0.2 to 1.3 dB quieter than Density 0 and the right 0.4 to
  0.7 dB louder. `E = 5.2` (left) and `3.3` (right) bring both within 0.4 dB
  for most settings.

## Decay, level and echoes

Impulse, Tone 9 kHz, Character 0, Mix 1, Diffusion 0.7 (default). RT60 is a
least-squares slope of the backward-integrated energy from −5 to −25 dB of
the left channel below 3 kHz (four one-poles), scaled to 60 dB. Level is the
whole response's energy at Density 1 over Density 0. Echoes are counted in
the left channel's first 50 ms at Diffusion 0 (each path one click).

| Size | Decay | level L, R (dB) | < 250 Hz L, R (dB) | > 3 kHz L (dB) | RT60 d0 → d1 (s) | L/R corr. d0 → d1 | echoes d0 → d1 |
|---|---|---|---|---|---|---|---|
| 0.25 | 0.5 | −0.35, −0.07 | −2.68, −1.41 | −0.22 | 0.48 → 0.47 | −0.16 → −0.11 | 22 → 47 |
| 0.5 | 1 | −0.24, +0.06 | −1.55, −0.28 | −0.09 | 0.95 → 0.94 | −0.18 → −0.10 | 5 → 27 |
| 1 | 0.3 | +0.80, −0.31 | +0.50, 0.00 | +0.89 | 0.30 → 0.29 | +0.04 → 0.00 | 1 → 8 |
| 1 | 1.4 | −0.08, −0.02 | −0.96, +0.07 | +0.06 | 1.36 → 1.35 | −0.11 → −0.04 | 1 → 8 |
| 1 | 4 | −0.30, +0.07 | −0.89, +0.08 | −0.17 | 3.75 → 3.74 | −0.14 → −0.06 | 1 → 8 |
| 3 | 0.5 | +1.18, −0.37 | +1.09, −0.35 | +1.21 | 0.56 → 0.54 | 0.00 → 0.00 | 0 → 2 |
| 3 | 2 | +0.25, −0.12 | −0.13, −0.24 | +0.31 | 1.95 → 1.96 | −0.03 → −0.01 | 0 → 2 |
| 3 | 8 | −0.24, +0.05 | −0.58, −0.13 | −0.17 | 7.54 → 7.54 | −0.11 → −0.04 | 0 → 2 |

At Size 1 and above the first 50 ms hold only the paths through the input
diffusers (18 ms at Diffusion 0), so the counts start late; at Size 1 the
seven left taps under 50 ms and the first line end make the 8. Density 0.5
sits between: at Size 1, Decay 1.4 its level is −0.04 / −0.03 dB.

The RT60 holds within 4 % at every setting, since the taps only read. The
level stays within 0.4 dB except where a short decay at a large Size leaves
the first pass most of the energy (up to +1.2 dB on the left at Size 3,
Decay 0.5): there the taps' weights, which rise as the line's gain falls,
favour the early taps. The behaviour test in `inserts/retroReverbDsp.test.ts`
asserts the RT60 below 3 kHz at Density 1 within 5 % of Density 0 at Decay
2 s and Size 1, and at least six more echoes in the first 50 ms.

## The boost cap (fix round 1)

A tap's envelope weight `gain^(f - 1)` grows without bound with a pass's
loss: at Size 10, Decay 0.2 line 3's first tap would sit 126 dB over its
line end. The loudness match then turned the ends down to nothing at any
Density above 0, so the knob played as off or full. Each weight is now held
at `densityMaxBoost`, 6 dB over the end.

- **Why 6 dB.** The largest weight at the auditioned settings (Size 0.5 to
  3, Decay 1.4 and 2 s) is 5.4 dB (Size 3, Decay 1.4, line 3's first tap),
  so 6 dB holds none of them. Where every tap is held (Size 10, Decay 0.2),
  Density 0.25 moves the output 52 % as far as Density 1, against 62 % with a
  9 dB cap, 71 % with 12 dB, and 38 to 45 % at settings where no tap is
  held.
- **Auditioned settings unchanged.** Size 0.5, 1 and 3 × Decay 1.4 and 2 s ×
  Density 0, 0.5 and 1 × Mix 0.5 and 1 × an impulse and a 100 ms noise
  burst, 3 s each: 20,736,000 of 20,736,000 output samples equal the
  previous head's (`08eb9a7`). Their Density 1 levels and RT60s are the
  previous head's: for example Size 1, Decay 1.4 at −0.08 / −0.02 dB and
  1.36 → 1.35 s.

Distance from Density 0: the RMS of the difference over both channels,
relative to Density 0's RMS (impulse, Tone 9 kHz, Character 0, Mix 1, 3 s).

| Size | Decay | before: 0.01 / 0.25 / 0.5 / 0.75 / 1 | after |
|---|---|---|---|
| 10 | 0.2 | 1.439 / 1.440 / 1.440 / 1.440 / 1.440 | 0.029 / 0.618 / 0.942 / 1.099 / 1.186 |
| 3 | 0.5 | 0.040 / 0.777 / 1.078 / 1.204 / 1.269 | 0.027 / 0.590 / 0.919 / 1.085 / 1.178 |
| 10 | 6 | 0.018 / 0.410 / 0.702 / 0.886 / 1.002 | unchanged (no tap held) |
| 0.25 | 20 | 0.013 / 0.322 / 0.584 / 0.771 / 0.902 | unchanged (no tap held) |

**Where taps are held.** A held tap still decays at the tank's rate; it sits
up to (its weight − 6 dB) under the line end's envelope, so its share of the
tail is smaller. The level at Density 1 stays within 1.3 dB of Density 0
(L / R: +1.14 / −0.58 dB at Size 10, Decay 0.2; +1.25 / −0.40 at Size 3,
Decay 0.3; +1.02 / −0.70 at Size 5, Decay 0.5). RT60 below 3 kHz, Density 0
→ 1, after (before):

| Size | Decay | RT60 d0 → d1 (s) |
|---|---|---|
| 3 | 0.5 | 0.47 → 0.53 (0.53) |
| 5 | 0.5 | 0.52 → 0.47 (0.49) |
| 5 | 1 | 1.05 → 1.05 (1.07) |
| 10 | 1 | 1.10 → 0.95 (0.96) |
| 10 | 2 | 1.98 → 2.09 (2.17) |
| 10 | 0.2 and 0.5 | 0.38 → 0.79 (0.43 and 0.18) |

At Size 10 with Decay 0.5 s or less a line loses 65 dB or more in a pass,
so the response is its first pass alone: Density 0 is the four line ends'
echoes at 0.31 to 0.54 s, and the −5 to −25 dB fit reads a handful of
echoes rather than a decay. Held at 6 dB, the taps fill that window evenly
instead of front-loading it, so the fit reads longer; nothing sounds later
(the last sample within 60 dB of the peak is at 0.625 s against Density 0's
0.635 s at Decay 0.2).

The Density test in `inserts/retroReverbDsp.test.ts` now also renders the
box's corners (Size 10 with Decay 0.2, Size 0.25 with Decay 20) at Density
0.25, 0.5, 0.75 and 1, and asserts that each step moves further from
Density 0 by at least 5 % of Density 1's distance and that 0.25 stays under
75 % of it. It fails on `08eb9a7`'s bundle (1.440 against a limit of 1.080).

## The loudness match across Tone (fix round 2)

One `E` per channel (5.2 left, 3.3 right), set at Tone 9 kHz, did not hold
at a dark Tone. A tap reads its line before the line's Tone lowpass and the
end after it, so the darker the Tone, the more top a tap keeps over its end;
and over many passes the feedback lines up the left sum's signs on the low
notes a small Size and a dark Tone leave in the tail. At Tone 800, Size 10,
Decay 0.2 s an impulse played 3.02 / 1.26 dB (L / R) louder at Density 1.

`E` is now read per block from a table of nodes at Tone 800, 1500, 2500,
4200 and 9000 Hz, Size 0.25, 0.5, 1, 3 and 10 and Decay 0.2, 0.5, 1.4, 2, 6
and 20 s, trilinear in their logs on `1 / E`
(`worklet/retro/retroDensityLevel.ts`). `rv3-density-level.mjs fit`
(beside this file) wrote it from `c97b098`'s bundle. For each node and
channel it renders Density 0 and 1 for two probes, an impulse (whose
response energy is the expected energy for any white input) and three
seeded 100 ms white-noise bursts with their energies summed, at Mix 1,
Character 0 and Diffusion 0.7. From the two renders and the tank's own
gains it separates the ends' energy from the taps', so the measure holds
whatever match the bundle used. Each node keeps the old value unless it
leaves a probe more than 0.7 dB off Density 0, and then moves only as far
as it must. So the auditioned settings keep their level, and the table
differs from 5.2 / 3.3 only where the old values missed.

Density 1 against Density 0, the largest |dB| over both channels and both
probes (`rv3-density-level.mjs check`), same machine and backend as above:

| Grid | `c97b098` | after |
|---|---|---|
| the 150 nodes | 3.07 | 0.71 |
| 192 settings between them (Tone 1100, 3200, 6000; Size 0.35, 0.7, 2, 6; Decay 0.3, 1, 4, 12 s) | 2.78 | 0.88 |
| Diffusion 0 and 1 at the box's corners (Tone 800 and 9000, Size 0.25 and 10, Decay 0.2 and 20 s) | 3.06 | 0.74 |

So the tolerance is ±1 dB for the expected level of a white input across
the valid box. Diffusion moves it by under 0.2 dB, so it is not an axis.
A single 100 ms burst scatters around that: at Tone 800, Size 0.25,
Decay 20 s, where the tail is a few low modes, the three bursts read
−1.8 to +0.9 dB on their own (6 s each). No fixed match can follow one
burst's low notes. Examples (impulse L / R, then the pooled bursts):

| Tone, Size, Decay | `c97b098` | after |
|---|---|---|
| 800, 10, 0.2 | 3.02 / 1.26, 3.03 / 1.02 | 0.69 / 0.70, 0.70 / 0.45 |
| 800, 0.25, 20 | −2.39 / −0.86, −2.24 / −0.50 | −0.70 / −0.70, −0.56 / −0.34 |
| 9000, 10, 0.2 | 1.14 / −0.58, 1.18 / −0.73 | 0.66 / −0.56, 0.70 / −0.71 |

**Auditioned settings.** Size 0.5, 1 and 3 × Decay 1.4 and 2 s at Tone
4200, Density 0.5 and 1, an impulse and a 100 ms burst, 3 s, against
`c97b098`: every level is within 0.001 dB except Size 3, Decay 1.4 s on
the left, −0.11 dB at Density 0.5 and −0.20 dB at Density 1 (Density 1
was 0.85 to 0.90 dB over Density 0 there, and is now 0.65 to 0.70). The RT60 below 3 kHz at
Density 1 is the same to the millisecond: 1.252, 1.797, 1.295, 1.832, 1.373
and 1.921 s. At Density 0 the table is never read: 1,920,000 of 1,920,000
samples (five settings, both probes, 2 s) equal `c97b098`'s.

The Density test now also asserts Density 1 within 1 dB of Density 0 at
Tone 800, Size 10, Decay 0.2 s and at Tone 1100, Size 2, Decay 1 s (between
nodes). On `c97b098`'s bundle they read 3.02 / 1.26 and 1.68 / 0.99 dB and
fail; after, 0.69 / 0.70 and 0.70 / 0.68.

## Density 0 is today's sound

Eight settings, an impulse and a 100 ms noise burst each, 3 s at 48 kHz:
reverb at defaults, Size 3 with Decay 8, Size 0.25 with Decay 0.5, Early 0.7
with Drift depth 0.8 at 2 Hz, Early 1 with Drift depth 1, Size 2, Decay 3 and
a 50 ms pre-delay, gated, reverse at Density 1, and gated at Density 1 with
Drift depth 1. Every one of the 4.6 million output samples from the RV-3
bundle equals main's (`131dec4`) bit for bit. `retroReverbNeutralPin.test.ts`
is unchanged and green.

## CPU

`rv3-bench.mjs` (beside this file) is `rv2-bench.mjs` with a Density
argument, timed in the process's CPU time (user + system) as well as wall
time. It runs reverb mode, Mix 1 and a 0.25 sine input. Each value is the
median of five runs, interleaved with the other cases, and each run is the
median of six timed passes of 1,500 quanta. The unit is microseconds per
128-frame quantum per instance at 48 kHz. "main" is `131dec4`'s bundle.

The machine was shared with other sessions' builds and tests throughout: the
load average read 173 at the start and 252 at the end. That inflates every
figure about 2.5× against RV-2's quiet-machine 9.3 µs, and the wall times
(right) scatter by a third, so read the CPU times (left), and read them
against one another rather than against `rv2.md`.

| Case | CPU, 1 instance | 8 | 16 | wall, 1 | 8 | 16 |
|---|---|---|---|---|---|---|
| main, density 0 | 25.36 | 23.14 | 23.10 | 37.90 | 39.22 | 34.98 |
| RV-3, density 0 | 24.41 | 23.61 | 22.74 | 29.00 | 32.61 | 42.24 |
| RV-3, density 0.5 | 33.04 | 33.40 | 33.23 | 70.71 | 73.69 | 87.87 |
| RV-3, density 1 | 35.11 | 33.85 | 33.48 | 77.30 | 57.91 | 55.10 |
| RV-3 first version (a `RetroDelay.read` call per tap), density 1 | 44.03 | 44.25 | 43.69 | 78.80 | 75.91 | 80.23 |
| main, drift depth 1 | 27.96 | 28.70 | 28.22 | 43.75 | 50.63 | 48.85 |
| RV-3, density 1, drift depth 1 | 39.82 | 38.26 | 40.10 | 71.75 | 76.82 | 59.65 |

At Density 0 the cost is main's, within the runs' scatter: no tap is read and
the outputs use today's expressions. Any Density above 0 costs the same, about
10 µs a quantum on this loaded machine (about 43 % over Density 0): 16 reads a
sample, about 1,000 a quantum. The first version called `RetroDelay.read` for
each tap and cost about 20 µs; working out each tap's whole and fractional
delay once a block and reading the buffer in place halved it. In gated and
reverse the taps are off (Density is scaled by the tank's share, as Drift is),
so they cost nothing there.
