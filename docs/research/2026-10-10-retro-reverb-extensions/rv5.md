# RV-5: Retro Reverb Low decay and Low cross, measured

Low decay gives the tank's low band its own decay. Each of the four tank
lines splits its feedback at Low cross with a one-pole lowpass and its
complement. The low part takes the gain for an RT60 of Decay × Low decay,
and the rest keeps the line's gain for Decay. This is per-line absorption as
in Jot & Chaigne (1991), a first-order shelf on each line:
`gain + (lowGain - gain) × lowpass`. Today's Tone lowpass stays. The band
lives in `packages/engine/src/worklet/retro/retroLowBand.ts`, and
`retroTank.ts` runs it a sample at a time.

All figures below: Apple M1, macOS (Darwin 25.6.0), arm64. Backend: Node
v24.21.0 / V8 13.6.233.17-node.53, offline, running the shipped
`retro-reverb-processor.js`. No browser was involved.

## How the numbers were chosen

- **Ranges.** Low decay 0.25 to 4 and Low cross 80 to 2000 Hz are RV-0's,
  kept. Decay × Low decay then spans 0.05 to 80 s.
- **The split.** The lowpass is the trapezoidal (bilinear) one-pole,
  `g / (1 + g)` with `g = tan(π × Low cross / 23,437.5)`, rather than the
  exponential one-pole Tone uses. Its zero sits at the internal clock's
  Nyquist, so each line's shelf is exactly the low gain at DC and exactly
  today's gain at Nyquist. Its magnitude lies between the two everywhere, so
  it never exceeds the larger. The exponential form leaves 0.26 of the low
  gain's difference at Nyquist at Low cross 2000 Hz, so the top of the
  "rest" would never reach Decay.
- **Stability.** Every gain is below 1. The longest band decay, 80 s on the
  shortest line at Size 0.25, gives 0.001^(0.0311 × 0.25 / 80) = 0.99933 a
  pass. The shelf never exceeds its larger gain, the Hadamard matrix is
  orthogonal, and Drift's interpolated reads never gain. The lowpass states
  snap to 0 under `silenceFloor`, as the Tone states do, so a dying tail
  never reaches denormals.
- **Block rate.** The coefficient and both gains are set once a block from
  the block's Size, as the line gains are, so a Size ramp keeps the bands in
  step with today's gains. Low decay and Low cross take the shared 50 ms
  smoothing. Low decay lands exactly on its target within `silenceFloor`,
  so a return to 1 takes today's path again.
- **Knobs.** Both are on the Space page, after Density, in reverb mode
  only, and both are on log curves. Low decay's range is symmetric in its
  log, so ×1 sits at mid-travel. Low decay reads as a multiple (`×1.00`).
  The automation rows are log too, and are offered in reverb mode only.

## Low decay 1 is today's sound

At Low decay exactly 1, or in gated and reverse (the tank's share under the
floor, as Drift and Density do), the split is skipped. `write` and the
outputs are then today's expressions. Fifteen settings were compared with
main (`2c68d43`): defaults, long and short decays, Size 10 at Tone 800, Early with
Drift, Density at the box's corners, the gain-ranging converter, and gated
and reverse at Low decay 0.25, 3 and 4. Each was rendered with an impulse and
a 50 ms burst, held and with a Size move, 2 s at 48 kHz. All 11,520,000
output samples are equal bit for bit. `retroReverbNeutralPin.test.ts` is
unchanged and green.

## RT60 in each band across the box (the boundary sweep)

`rv5-sweep.mjs` (beside this file) renders an impulse at every combination
of:

- Size 0.25, 1, 3 and 10
- Decay 0.2, 1, 5 and 20 s
- Tone 800 and 9000 Hz
- Low cross 80, 300 and 2000 Hz
- Density 0 and 1
- Drift depth 0 and 1

Each combination is rendered at Low decay 0.25, 1 and 4. That is 384 rows
and 1,920 renders, up to 60 s each.

**The reference.** Today's Decay is the RT60 at DC, and Tone shortens the
top. So "Decay × Low decay below Low cross, Decay above" is measured against
today's tank:

- **Low band:** the octave around Low cross / 8, against today's tank
  (Low decay 1) at Decay × Low decay.
- **High band:** the octave around Low cross × 8 (7 kHz at most), against
  the same setting at Low decay 1.

The bands have 16th-order Butterworth edges. RT60 is a least-squares fit of
the backward-integrated energy from −5 to −25 dB.

**Where a band can be read.** A band is read only where today's tank reads
within 15 % of a prediction from its own gains and Tone filter. The
prediction also has to be over 0.4 s and over six passes of the longest
line, and the low octave has to hold at least one of the tank's modes. Most
skipped high bands are dead: Tone 800, or the top at Low cross 2000 Hz, or a
pass that loses most of the level. Most skipped low bands are Decay 0.2 s, a
large Size at a short Decay (where the response is one pass), or Low cross
80 Hz at Size 0.25 (an octave around 10 Hz with no mode in it).

**Why 46,875 Hz.** The sweep renders at 46,875 Hz, exactly twice the
internal clock. At 48 kHz, the hold that carries the 23,437.5 Hz clock to the
host rate (today's) leaves beat images of each band about 40 dB under it in
the other. For example, energy just above 1,125 Hz lands at 10 Hz. Where one
band rings far longer than the other, the short band's −25 dB point falls
under those images.

- At 48 kHz, Size 3, Decay 5, Tone 9 kHz, Low cross 80 and Low decay 0.25
  read 1.83 s in the low band against 1.34 s.
- At 46,875 Hz the same setting reads 1.45 s against 1.32 s.
- The images are there at Low decay 1 too.

**Tolerance: each band's RT60 is within 10 % of its reference, at every
setting where it can be read: 385 low-band and 134 high-band readings.**
Two sources of deviation are expected:

- The first-order shelf's own transition. At Low cross / 8 and × 8, the
  prediction from the shelf's magnitude puts the band 0.3 to 4.4 % off its
  gain.
- Scatter in the fit where a band holds a few modes.

In the table:

- **low / reference:** the low band's RT60 over today's at Decay × Low
  decay.
- **high / Low decay 1:** the high band's RT60 over the same setting's at
  Low decay 1.
- **Energies:** each band's whole energy against the same references. This
  is the level change beyond what the decay change implies: equal decay
  with equal energy means no jump.
- **Density 1 / 0:** the whole response's energy, left and right, Drift
  included.

| Low decay | Low cross | low / reference (n) | high / Low decay 1 (n) | low energy / reference (dB) | high energy / Low decay 1 (dB) | Density 1 / 0, L and R (dB) |
|---|---|---|---|---|---|---|
| 0.25 | 80 | 1.004 to 1.093 (34) | 0.942 to 0.993 (49) | −0.12 to 0.18 | −0.16 to −0.02 | −0.60 to 1.24 |
| 0.25 | 300 | 0.976 to 1.040 (49) | 0.968 to 0.995 (17) | 0.03 to 0.69 | −0.09 to −0.01 | −0.60 to 1.31 |
| 0.25 | 2000 | 1.004 to 1.027 (52) | 0.959 (1) | −0.08 to 0.53 | −0.08 | −0.61 to 1.01 |
| 4 | 80 | 0.942 to 1.001 (64) | 1.008 to 1.029 (49) | −0.28 to −0.03 | 0.02 to 0.06 | −2.19 to 0.75 |
| 4 | 300 | 0.935 to 1.006 (101) | 1.010 to 1.027 (17) | −0.29 to 0.40 | 0.03 to 0.05 | −1.35 to 0.74 |
| 4 | 2000 | 0.947 to 1.008 (85) | 1.064 (1) | −0.57 to 0.18 | 0.11 | −1.17 to 0.83 |

**Example.** Size 1, Decay 1 s, Tone 9 kHz, Low cross 300 Hz:

| Low decay | 37.5 Hz octave | today's at Decay × Low decay | 2.4 kHz octave |
|---|---|---|---|
| 0.25 | 0.334 s | 0.338 s | 0.827 s |
| 1 | 1.211 s | — | 0.845 s |
| 4 | 3.911 s | 4.051 s | 0.858 s |

The 2.4 kHz octave reads 0.85 s rather than 1 s because Tone takes its share
there, as it does today.

**Stability.** None of the 1,920 renders produced a value that was not
finite. None ended louder in its last half second than half its whole
energy, with Drift on or off. The largest output peak over the sweep is
0.0187 (an impulse of 0.8 at Mix 1).

## Density with two bands

Density's taps (RV-3) sit on their line end's decay envelope through a
weight from the line's gain. Its loudness match divides by E, the ends'
energy in taps, read from a table at the block's Decay. With two bands each
band needs its own, so:

- The low band's taps are weighted by the low gains and matched from an E at
  the band's decay.
- Each output's two mixes (ends and taps at the high-band gains, and at the
  low-band gains) are recombined through the same lowpass at Low cross:
  `high + lowpass(low − high)`.
- Per sample, that costs a second sum over the taps and two one-poles.
- RT60 per band is unaffected, since the taps only read: the table above
  holds at Density 1.

The low band's E was measured, in two steps:

1. **RV-3's table at the band's decay.** It was held at its edges outside
   0.2 to 20 s. An impulse at Density 1 read up to 2.8 dB off Density 0
   (Size 0.25, Tone 800, Decay 20, Low decay 4, Low cross 80).
2. **A table of its own:** `RETRO_REVERB_DENSITY_LOW_LEVEL` in
   `retroReverbDensityTables.ts`, written by `rv5-density-level.mjs fit`
   (beside this file).
   - The low band holds only the low notes, which the lines carry more
     nearly in step than the whole signal, so its E differs from the whole
     signal's at the same decay.
   - The nodes are Tone and Size as in RV-3, and band decays 0.05, 0.2, 0.5,
     1.4, 2, 6, 20 and 80 s.
   - Each node is measured at Low cross 300 Hz and starts from RV-3's E.
     The node keeps that value unless a probe reads more than 0.7 dB off,
     then moves just far enough, by bisection on the rendered level. This is
     RV-3's rule.
   - The probes are RV-3's: an impulse and three pooled 100 ms white-noise
     bursts. They render the whole tail (3 s plus three quarters of the band
     decay, up to 60 s). Over a long decay the ends line up pass by pass,
     so a 6 s window read the whole tail 0.8 dB off at a band decay of 80 s.

Density 1 against Density 0, from `rv5-density-level.mjs check`. Each figure
is the largest |dB| over left, right, the impulse and the pooled bursts:

| Grid | Low decay 1 (RV-3's table alone) | Low decay ≠ 1 |
|---|---|---|
| Tone 800, 2500, 9000 × Size 0.25, 1, 10 × Decay 0.2, 1.4, 5, 20 × Low cross 80, 300, 2000 × Low decay 0.25, 4 | 0.72 | 1.85 (213 of 216 within 1 dB) |
| Between the nodes: Tone 1100, 4200 × Size 0.5, 3 × Decay 0.5, 2, 12 × Low decay 0.4, 2.5 × Low cross 150, 900 | — | 0.85 (48 of 48) |

**The three settings over 1 dB** are all at Size 0.25, Tone 800 and Low
cross 80 Hz:

| Decay | Low decay | Worst reading |
|---|---|---|
| 20 s | 4 | right −1.85 dB |
| 5 s | 0.25 | +1.14 dB |
| 5 s | 4 | −1.00 dB |

At Size 0.25 the tank has about three modes below 80 Hz. The band there is
a few separate low notes, whose level in each output depends on where they
fall. A match measured at Low cross 300 does not follow them. The sweep's
impulse-only column above reads the same corner at −2.19 dB with Drift on.
Everywhere else Density 1 stays within ±1 dB of Density 0 at Low decay 0.25
and 4.

## CPU

`rv5-bench.mjs` (beside this file) is `rv4-bench.mjs` with Low decay,
Density and Low cross arguments. It runs reverb mode, Mix 1 and a 0.25 sine
input, and times user CPU (`process.cpuUsage`).

**Method.** Each value is the median of five interleaved rounds. Each round
is the median of six timed passes of 1,500 quanta. The unit is CPU
microseconds per 128-frame quantum per instance at 48 kHz. "main" is
`65830f8`'s bundle, which is what RV-5 was built on; RV-6's converter is off
in both. The load average read 3.6 to 5 during the pass, so compare the
rows with each other.

| Case | 1 instance | 8 | 16 |
|---|---|---|---|
| main, Density 0 | 11.82 | 10.73 | 10.66 |
| RV-5, Low decay 1, Density 0 | 11.58 | 10.63 | 10.88 |
| RV-5, Low decay 4, Density 0 | 14.18 | 12.97 | 12.80 |
| main, Density 1 | 16.32 | 15.12 | 15.24 |
| RV-5, Low decay 1, Density 1 | 16.56 | 15.56 | 15.87 |
| RV-5, Low decay 4, Density 1 | 20.01 | 18.69 | 18.70 |

- **Low decay 1** costs main's within the rounds' scatter, about 1 µs.
  The split path is a separate `writeSplit` and `readTapsSplit`, so the
  neutral path is today's code plus one test a line and one a sample.
  - A first version tested the split inside `write`'s body and each tap's
    read. It cost 0.5 to 0.9 µs a quantum at Low decay 1.
- **Low decay on** costs about 2.3 µs a quantum (+22 %): four one-poles a
  tick.
- **Low decay and Density together** cost about 3 µs over Density alone:
  the second tap sum and the two output one-poles.
- In gated and reverse nothing runs, as with Drift and Density.

## Listening

Renders through the shipped bundle, at Decay 2 s, Mix 0.5 and Character
0.65, are in `~/Desktop/retro-reverb/rv5/` (not in the repo). The sources
are:

- a kick-like thump: a sine falling from 120 to 50 Hz
- a snare: a noise burst plus a 190 Hz body
- a 4 s A-minor saw pad

Each source is rendered at Low decay 1, and at Low decay 0.25 and 4 with Low
cross 150 and 600 Hz: 15 files.
