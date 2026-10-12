# Plate reverb: Decay in seconds, the low band, equal-power Mix

Written 2026-10-12 for windsor#748, items 1 and 6 of
`docs/research/2026-10-11-plate-reverb-upgrades/README.md`. Every figure here
was measured on the shipped bundle, `worklet/generated/reverb-processor.js`,
through the scripts in this folder. Machine: Apple M1, 16 GB. Backend: Node
24.21.0 (V8) unless a section says Chrome.

## What changed

- **Decay is an RT60 in seconds, 0.2 to 60** (20 s until fix round 1, record
  `2026-10-12-plate-decay-in-seconds`). Each tank line, lines 4 to 11,
  has its own gain point (`worklet/reverb/tankGains.ts`): the long lines at
  their output, where the old feedback gain sat, and the all-pass lines inside
  their all-pass, on the delayed sample both of its sums read. A line `L`
  samples long at the block's Size takes `g = 10^(−3L / (Decay·fs))`, so every
  delay `z^−L` of the loop becomes `(r z^−1)^L`: a sample loses 60 dB over
  Decay seconds whichever segments it spends them in, the all-passes' own
  recirculation included. The gains are set once a block and ramped across it
  a sample at a time, so a Decay step, a Size move or HOLD never steps the loop.
- **A measured correction** (`worklet/reverb/reverbDecayTables.ts`, below)
  stretches the gains' Decay so the broadband T30 lands on the knob's.
- **The low band** (`worklet/reverb/plateLowBand.ts`): `lowDecay` 0.25 to 4,
  default 1, and `lowCross` 80 Hz to 10 kHz, default 300. At each gain point,
  a first-order shelf from a trapezoidal one-pole lowpass at `lowCross`:
  `g·x + (gL − g)·lp`, with `gL` the gain for Decay × `lowDecay`, as the Retro
  Reverb's own band does it. At `lowDecay` exactly 1 nothing in the band runs
  and the tank takes its plain gain, which a test pins bit for bit against a
  build with the band's code out of the path (`lowBand: false`). Since fix
  round 2, `gL` takes the measured correction at the band's own target, and
  the shelf is written out in the tank's sample loop, never called per sample
  (below, "Each band at its own target" and "CPU").
- **HOLD** keeps `HOLD_DECAY` at the long lines' points and passes the
  all-passes untouched, so a held tank renders exactly as it did before: the
  golden table's `hold` row kept its hash. It bypasses the band's output (its
  extra gains ramp to 0) while each lowpass keeps tracking.
- **Equal-power Mix** on the Plate insert: wet `sin(mix·π/2)`, dry
  `cos(mix·π/2)` (written `sin((1 − mix)·π/2)` so Mix 1 is exactly dry 0).
- **Format:** `ARRANGEMENT_VERSION` 10 → 11 with no upgrade.

## The spaces, before and after

Today's broadband T30 on `main` (`spacesMain.mjs`, run on `main`'s bundle):
an impulse after half a second at the space's Size (the plate starts at Size
1 and glides), Schroeder integral of L² + R², a least-squares line through −5
to −35 dB. Then each row's new `decay` and its T30 on this branch.

| Space | Old `decay` (gain) | T30 on main, 48 kHz | 44.1 kHz | New `decay` | T30 now, 48 kHz | 44.1 kHz | Change |
|---|---|---|---|---|---|---|---|
| `DEFAULT_SPACE` | 0.7 | 3.366 s | 3.387 s | 3.35 s | 3.273 s | 3.292 s | −2.8 % |
| `plate` | 0.62 | 1.240 s | 1.244 s | 1.25 s | 1.189 s | 1.194 s | −4.1 % |
| `room` | 0.45 | 0.421 s | 0.426 s | 0.40 s | 0.382 s | 0.386 s | −9.3 % |
| `hall` | 0.78 | 6.336 s | 6.377 s | 6.35 s | 6.017 s | 6.052 s | −5.0 % |
| `shimmer` | 0.85 | 4.355 s | 4.402 s | **5.05 s** | 4.342 s | 4.381 s | −0.3 % |
| `cathedral` | 0.9 | 30.376 s | 30.537 s | 30.40 s | 28.140 s | 28.287 s | −7.4 % |
| `wash` | 0.95 | 31.372 s | 31.146 s | 31.35 s | 23.104 s | 22.985 s | −26 % |

- The rows in plain type follow the issue's rule: the old T30 rounded to
  0.05 s. Their T30 now lands a little short of it because the spaces damp the
  tank (60 to 250 Hz low cuts, 4.2 to 11 kHz high cuts), which the open-damping
  correction table does not cover.
- **`shimmer`** at the rule's 4.35 s measured 3.805 s, 12.6 % short: its
  250 Hz tank low cut takes the most. It takes 5.05 s instead, the 0.05 s
  step whose T30 is nearest the old one.
- **`cathedral` and `wash`** rang about 30 s. Until fix round 1 they sat at
  the 20 s ceiling (18.7 s and 16.2 s measured, −38 % and −48 %). With the
  ceiling at 60 s they follow the rule like the plain rows. `cathedral` lands
  within 10 %. `wash` lands 26 % short: its 200 Hz tank low cut and 5 kHz
  high cut take a fixed bite a second, which costs a 31 s tail far more than
  a short one, as `shimmer`'s low cut did. tacowars ruled that neither gets
  further tuning: item 8's preset bank replaces both (Old Mill about 4 s,
  Last Train about 8 s), and `cathedral`, `shimmer` and `wash` are not kept
  (record `2026-10-12-plate-decay-in-seconds`).
- `PLATE_REVERB_SPACE_DEFAULT` stays `hall`.

## T30 against Decay: the sweep

`sweepT30.mjs`: an impulse after half a second at the Size, `tankLowCut`
10 Hz, `tankHighCut` 20 kHz, `lowDecay` 1, modulation off, wet 1. Decay over
0.2, 0.3, 0.5, 0.7, 1, 1.5, 2.5, 4, 7, 12, 20, 30, 45 and 60 s; Size over
0.05, 0.08, 0.15, 0.3, 0.6, 1, 1.7, 2.5 and 4; `diffusionTank1` and
`diffusionTank2` each over 0, 0.4 and 0.8 (nine pairs per cell). Each cell is
the error range over the nine pairs, in percent. A cell in brackets is one
where one trip round the tank (0.7254 s × Size) is a quarter of Decay or
more: its tail is a few discrete echoes, reported without a fit to hold it
to. The full rows are `sweep48.tsv` and `sweep44.tsv` up to 20 s, and
`sweep48-long.tsv` and `sweep44-long.tsv` from 30 s, measured in fix round 1
when Decay's top went from 20 s to 60 s (record
`2026-10-12-plate-decay-in-seconds`).

**48 kHz:**

| Decay \ Size | 0.05 | 0.08 | 0.15 | 0.3 | 0.6 | 1 | 1.7 | 2.5 | 4 |
|---|---|---|---|---|---|---|---|---|---|
| 0.2 s | +5..+14 | (+10..+17) | (+17..+20) | (+13..+17) | (+4..+12) | (+4..+16) | (+19..+53) | (+34..+87) | (+46..+133) |
| 0.3 s | −3..+2 | +0..+4 | (+4..+5) | (+4..+7) | (−9..+1) | (−25..−8) | (−21..+3) | (−10..+36) | (+3..+85) |
| 0.5 s | −1..+1 | +1..+2 | −0 | (−0..+2) | (+3..+7) | (−11..−2) | (−40..−16) | (−46..−18) | (−34..+19) |
| 0.7 s | −0 | +0..+1 | −0 | (−0..+1) | (+3..+4) | (+2..+7) | (−20..−10) | (−49..−19) | (−53..−10) |
| 1 s | −0 | +0..+1 | −0 | −0 | (−0..+3) | (+2..+5) | (−9..+6) | (−23..−11) | (−67..−22) |
| 1.5 s | −0 | +0..+1 | −0 | −0 | (+1..+2) | (−1..+4) | (+3..+9) | (−8..+9) | (−29..−7) |
| 2.5 s | −0 | +0 | −0 | −0 | +0 | (−0..+1) | (−1..+4) | (+3..+6) | (−2..+11) |
| 4 s | −0 | +0..+1 | −0 | −0 | +0 | −0 | (−1..+0) | (−1..+3) | (+3..+7) |
| 7 s | −1..−0 | +0..+1 | −0 | −0 | +0 | −0 | −1 | (−0..+1) | (+0..+2) |
| 12 s | −0 | +0..+1 | −0..+1 | −0 | +0 | −0 | −1..−0 | −1..−0 | +0..+1 |
| 20 s | −1..+0 | +0..+1 | −0..+1 | −0..+1 | +0 | +0 | −1..−0 | −0 | −0 |
| 30 s | −1..+2 | +0..+2 | −0..+1 | −0..+1 | +0 | +0 | −1..−0 | −0 | +0 |
| 45 s | +3..+12 | +2..+6 | −0..+1 | −0..+1 | +0..+1 | +0 | −1..−0 | −0 | −0..+0 |
| 60 s | −3..+11 | +2..+8 | −1..+1 | −1..+1 | +0..+1 | +0 | −1..−0 | −0 | +0 |

**44.1 kHz** (the table was measured at 48 kHz only):

| Decay \ Size | 0.05 | 0.08 | 0.15 | 0.3 | 0.6 | 1 | 1.7 | 2.5 | 4 |
|---|---|---|---|---|---|---|---|---|---|
| 0.2 s | +3..+12 | (+11..+18) | (+18..+21) | (+13..+18) | (+5..+12) | (+5..+17) | (+18..+52) | (+29..+85) | (+20..+112) |
| 0.3 s | −4..+1 | +2..+5 | (+4..+6) | (+5..+7) | (−8..+2) | (−25..−8) | (−22..+2) | (−14..+36) | (−7..+77) |
| 0.5 s | −3..−1 | +2..+3 | +1 | (−0..+3) | (+3..+7) | (−11..−1) | (−39..−15) | (−48..−18) | (−41..+16) |
| 0.7 s | −2 | +1..+2 | +0..+1 | (+0..+2) | (+2..+4) | (+3..+8) | (−19..−9) | (−48..−18) | (−58..−13) |
| 1 s | −2 | +1..+2 | +0..+1 | −0 | (−0..+3) | (+3..+6) | (−8..+8) | (−21..−10) | (−68..−21) |
| 1.5 s | −2..−1 | +1 | +0..+1 | −0 | (+0..+1) | (−0..+4) | (+4..+10) | (−6..+10) | (−27..−5) |
| 2.5 s | −2..−1 | +1 | +0..+1 | −0 | +0 | (+0..+1) | (+0..+5) | (+4..+7) | (+0..+12) |
| 4 s | −3..−1 | +1 | −0..+1 | −0 | −0 | +0 | (+1..+2) | (+0..+4) | (+4..+8) |
| 7 s | −4..−2 | +0..+1 | −0..+1 | −0 | −0 | +0 | +0..+1 | (+1..+2) | (+1..+3) |
| 12 s | −5..−4 | +1 | −0..+1 | −1..+0 | −0 | +0 | +0..+1 | +1 | +1..+2 |
| 20 s | −9..−7 | +1..+2 | −0..+1 | −1..+0 | −0 | +0 | +0 | +1 | +0..+1 |
| 30 s | −14..−8 | +1..+3 | −0..+1 | −1..−0 | −1..−0 | −0..+0 | +0 | +1 | +1 |
| 45 s | −17..−4 | +3..+7 | −0..+2 | −2..−1 | −1..−0 | −0 | +0 | +1 | +0..+1 |
| 60 s | −25..−8 | +2..+8 | −1..+1 | −2..−1 | −1..−0 | −0 | +0 | +1 | +0..+1 |

- Every measured cell is within ±10 % but two: **Decay 0.2 s at Size 0.05**,
  and **Size 0.05 at Decay 30 s and up** (below).
- **Decay 0.2 s at Size 0.05** measures up to +14.5 % at 48 kHz and +12.5 %
  at 44.1 kHz. That is a floor, not the
  tank: with the tank's own Decay set to 0.05 s the plate still measures a
  T30 of 0.18 to 0.19 s, the ring of the four input diffusers (3.6 to 12.7 ms
  at coefficients 0.75 and 0.625), which sit outside the loop and do not
  follow Decay. Item 7's plate voicing, with diffusers well under 2 ms,
  removes it.
- The tank diffusions move a cell by about 2 % at most: charging the loss on
  every segment, the all-passes' included, is what keeps them out of it.
- At 44.1 kHz the smallest Size runs a few percent short at long Decays
  (−9 % at 20 s), where the interpolating reads lose more per pass than at
  48 kHz. Still within ±10 % up to 20 s.
- **Size 0.05 from Decay 30 s** is the second miss, new with the 60 s top.
  A 36 ms tank asked to ring for a minute loses nearly that minute's 60 dB
  to its own passes, so the correction there is large (5.58 at 60 s) and
  anything that changes the loss a pass moves the result:
  - At 48 kHz, three of the 243 cells from 30 s up miss, all at Size 0.05
    with `diffusionTank2` 0.8: +11.6 % and +10.2 % at 45 s, +11.0 % at
    60 s. The table holds the default diffusions (0.7, 0.5) and, near 60 s,
    a second tank diffusion of 0.8 lengthens the tail by about 10 %. The 45 s
    cells also sit between the 40 s and 60 s columns, where the factor
    curves steeply and the bilinear read runs a few percent high.
  - At 44.1 kHz, Size 0.05 runs short from 30 s: −14 to −8 % at 30 s, −17
    to −4 % at 45 s and −25 to −8 % at 60 s. The table was measured at
    48 kHz, and each pass loses more at 44.1 kHz.
  - Size 0.08 and up is within ±10 % at both rates through 60 s. A table per
    sample rate (measured the same way at 44.1 kHz) would close the 44.1 kHz
    miss. tacowars accepted the miss on 2026-10-12 with no 44.1 kHz table
    (record `2026-10-12-plate-decay-in-seconds`, decision 5).

### Why a correction table

With the loss charged on every segment and the damping open, the T30 came
out short wherever the tank is passed many times a second: −27 % at Size
0.05 and Decay 20 s, −7 % at Size 4. Each pass costs a little on its own: the
damping one-poles are not transparent even at 10 Hz and 20 kHz (the low cut
takes about 0.3 dB a pass at 37.5 Hz), and every fractional read
interpolates. `decayTable.mjs` measures, per Size and Decay, the factor `f`
with `T30(Decay × f) = Decay`, by three steps of
`f ← f × Decay / T30(Decay × f)` on a bundle built with every factor 1, and
more steps (up to twelve) while a cell is still more than 1 % off. A
cell whose trip is a quarter of Decay or more holds the factor of the shortest
measured Decay at its Size, and a factor under 1 is held at 1 (that happens
only at Decay 0.2 s and Size 0.05, the input-diffuser floor above). The
factors run from 1 to 1.50 up to 20 s, and to 5.58 at 60 s; the table is
read bilinearly in Size and Decay.

The 30, 40 and 60 s columns came in fix round 1, with Decay's 60 s top. The
whole table was re-measured in one run on a bundle with every factor 1, and
every cell up to 20 s came out as before to the fourth decimal: they had all
converged within 1 % in three steps. Six new cells needed more steps, all at
Size 0.1 and under: near the smallest Size's own loss each step closes only
part of the gap, and three steps had left Size 0.05 at 60 s 11 % short
(factor 3.29). Its twelve steps still leave it 1.4 % short at 5.58 (T30
59.16 s); fourteen would give 5.72. It stays at 5.58 so that the table
reproduces.

**Fix round 2 widened the RT60 axis to 0.05–240 s**, because the low band
now looks the table up at its own target, Decay × `lowDecay` (record
`2026-10-12-plate-decay-in-seconds`, decision 8). The columns 0.05, 0.1 and
0.15 s and 80, 120, 180 and 240 s were measured in one run that reproduced
all 208 earlier cells to the fourth decimal, the rows run in parallel
(`decayTable.mjs <bundle> <sizes>`). The new columns past 60 s step up to
forty times. Two kinds of cell can't be measured and are filled:

- **Under a quarter trip**, as before, the cell holds the shortest measured
  factor at its Size. That is every cell of the new columns under 0.2 s but
  one: Size 0.05 at 0.15 s is measured, and its T30 is the input diffusers'
  0.18 s floor, so its factor falls under 1 and is held at 1, which the
  row's 0.2 s cell already was. A trip there loses at least 15 dB, and
  60 × trip / RT60 dB in all, so a factor a few percent off moves each echo
  by a few percent of a loss that already buries it.
- **Past the ceiling.** With every gain at 1 the tank still loses a little
  each pass, so at each Size it can only ring so long. That ceiling,
  measured the same way with the gains cut from 10^6 s:

  | Size | 0.05 | 0.075 | 0.1 | 0.15 | 0.2 | 0.3 |
  |---|---|---|---|---|---|---|
  | Broadband T30, every gain at 1 | 73.9 s | 102.4 s | 141.6 s | 196.9 s | 258.1 s | 424.0 s |

  A cell past 95 % of its ceiling steps towards 95 % of the ceiling instead
  of its RT60: the factor that rings within 1 % of it. Past there each
  doubling of the factor buys under 2 % (Size 0.05: gains cut from 335 s
  ring 59.2 s, from 1000 s 68.2 s, from 3000 s 71.9 s, from 30 000 s
  73.7 s). These cells are Size 0.05 from 80 s (T30 69.5 s), 0.075 from
  120 s (96.4 s), 0.1 from 180 s (133.2 s) and 0.15 at 240 s (185.2 s).
  Across them the factor falls so that the gains' RT60 (RT60 × f) holds,
  about 1330 s at Size 0.05. Size 0.2 at 240 s, 93 % of its ceiling, is
  reached, with a factor of 14.3 after 28 steps.

The largest factor is 16.7 (Size 0.05, 80 s). Between 60 and 80 s at
Size 0.05 the factor climbs from 5.58 to 16.7, and the bilinear read moves
the gains' RT60 from 335 s to 1336 s, where the T30 moves only from 59 s to
70 s.

The correction is broadband: it stretches the whole tank, so a band the
plate loses little in (the mids at small Sizes) rings up to a few percent
longer than Decay, and the top, which the interpolation and the damping take
most, rings shorter. The octave bands at `lowDecay` 1 are in the next table's
"at lowDecay 1" figures.

## The low band

`lowBand.mjs`: an impulse after half a second, damping open, modulation off.
Octave-band T30 (fourth-order Linkwitz–Riley edges) one, two and three
octaves below and above `lowCross`. Each cell: the band's centre, its T30,
the error against Decay × `lowDecay` below or Decay above, and in brackets'
second figure the error against the same band at `lowDecay` 1 (times
`lowDecay` below), which takes out the plate's own losses in that band. The
cases are chosen so that each band's decay is at least four trips: Size 0.05
at Decay 2 s, Size 1 at Decay 12 s, Size 4 at Decay 20 s. 48 kHz;
`low44.tsv` has 44.1 kHz, within a few percent of it. Re-measured in fix
round 2, when the band's gains began taking the correction at its own target
(next section): the `lowDecay` 4 cells moved by up to 4 %, the 0.25 cells by
up to 5 %, the other side of `lowCross` by about 1 %.

| Size | Decay | lowCross | lowDecay | below 1 oct | below 2 oct | below 3 oct | above 1 oct | above 2 oct | above 3 oct |
|---|---|---|---|---|---|---|---|---|---|
| 0.05 | 2 s | 80 | 0.25 | 40 Hz: 0.71 s (42%; 63%) | 20 Hz: 0.67 s (33%; 54%) | — | 160 Hz: 1.60 s (−20%; −27%) | 320 Hz: 1.95 s (−2%; −11%) | 640 Hz: 2.07 s (4%; −5%) |
| 0.05 | 2 s | 80 | 4 | 40 Hz: 2.92 s (−64%; −58%) | 20 Hz: 2.91 s (−64%; −58%) | — | 160 Hz: 2.51 s (25%; 15%) | 320 Hz: 2.32 s (16%; 6%) | 640 Hz: 2.20 s (10%; 1%) |
| 0.05 | 2 s | 300 | 0.25 | 150 Hz: 0.74 s (49%; 37%) | 75 Hz: 0.58 s (16%; 14%) | 37.5 Hz: 0.53 s (5%; 21%) | 600 Hz: 1.54 s (−23%; −29%) | 1200 Hz: 1.76 s (−12%; −14%) | 2400 Hz: 1.67 s (−17%; −6%) |
| 0.05 | 2 s | 300 | 4 | 150 Hz: 4.98 s (−38%; −43%) | 75 Hz: 5.51 s (−31%; −32%) | 37.5 Hz: 4.04 s (−50%; −42%) | 600 Hz: 2.74 s (37%; 26%) | 1200 Hz: 2.18 s (9%; 7%) | 2400 Hz: 1.81 s (−10%; 2%) |
| 0.05 | 2 s | 10000 | 0.25 | 5000 Hz: 0.47 s (−6%; 38%) | 2500 Hz: 0.51 s (2%; 17%) | 1250 Hz: 0.53 s (6%; 4%) | — | — | — |
| 0.05 | 2 s | 10000 | 4 | 5000 Hz: 3.21 s (−60%; −41%) | 2500 Hz: 5.12 s (−36%; −27%) | 1250 Hz: 7.12 s (−11%; −12%) | — | — | — |
| 1 | 12 s | 80 | 0.25 | 40 Hz: 4.76 s (59%; 60%) | 20 Hz: 3.31 s (10%; 32%) | — | 160 Hz: 9.84 s (−18%; −25%) | 320 Hz: 11.73 s (−2%; −11%) | 640 Hz: 12.54 s (5%; −4%) |
| 1 | 12 s | 80 | 4 | 40 Hz: 23.45 s (−51%; −51%) | 20 Hz: 21.09 s (−56%; −48%) | — | 160 Hz: 16.00 s (33%; 22%) | 320 Hz: 13.86 s (15%; 5%) | 640 Hz: 13.20 s (10%; 1%) |
| 1 | 12 s | 300 | 0.25 | 150 Hz: 4.64 s (55%; 42%) | 75 Hz: 3.53 s (18%; 11%) | 37.5 Hz: 3.15 s (5%; 7%) | 600 Hz: 9.68 s (−19%; −26%) | 1200 Hz: 11.11 s (−7%; −12%) | 2400 Hz: 10.92 s (−9%; −5%) |
| 1 | 12 s | 300 | 4 | 150 Hz: 34.22 s (−29%; −35%) | 75 Hz: 38.67 s (−19%; −24%) | 37.5 Hz: 36.03 s (−25%; −23%) | 600 Hz: 16.39 s (37%; 26%) | 1200 Hz: 13.38 s (11%; 6%) | 2400 Hz: 11.69 s (−3%; 2%) |
| 1 | 12 s | 10000 | 0.25 | 5000 Hz: 3.14 s (5%; 36%) | 2500 Hz: 3.20 s (7%; 12%) | 1250 Hz: 3.20 s (7%; 2%) | — | — | — |
| 1 | 12 s | 10000 | 4 | 5000 Hz: 23.62 s (−51%; −36%) | 2500 Hz: 35.80 s (−25%; −21%) | 1250 Hz: 45.62 s (−5%; −9%) | — | — | — |
| 4 | 20 s | 80 | 0.25 | 40 Hz: 8.50 s (70%; 66%) | 20 Hz: 6.12 s (22%; 30%) | — | 160 Hz: 16.87 s (−16%; −22%) | 320 Hz: 19.65 s (−2%; −9%) | 640 Hz: 20.85 s (4%; −3%) |
| 4 | 20 s | 80 | 4 | 40 Hz: 46.41 s (−42%; −44%) | 20 Hz: 46.47 s (−42%; −38%) | — | 160 Hz: 26.94 s (35%; 25%) | 320 Hz: 22.80 s (14%; 6%) | 640 Hz: 21.77 s (9%; 1%) |
| 4 | 20 s | 300 | 0.25 | 150 Hz: 8.40 s (68%; 56%) | 75 Hz: 6.06 s (21%; 14%) | 37.5 Hz: 5.37 s (7%; 5%) | 600 Hz: 16.73 s (−16%; −22%) | 1200 Hz: 19.17 s (−4%; −9%) | 2400 Hz: 19.49 s (−3%; −3%) |
| 4 | 20 s | 300 | 4 | 150 Hz: 58.87 s (−26%; −32%) | 75 Hz: 69.58 s (−13%; −18%) | 37.5 Hz: 68.61 s (−14%; −16%) | 600 Hz: 27.24 s (36%; 27%) | 1200 Hz: 22.49 s (12%; 6%) | 2400 Hz: 20.52 s (3%; 2%) |
| 4 | 20 s | 10000 | 0.25 | 5000 Hz: 6.12 s (22%; 38%) | 2500 Hz: 5.66 s (13%; 13%) | 1250 Hz: 5.45 s (9%; 3%) | — | — | — |
| 4 | 20 s | 10000 | 4 | 5000 Hz: 49.45 s (−38%; −30%) | 2500 Hz: 67.69 s (−15%; −16%) | 1250 Hz: 80.16 s (0%; −5%) | — | — | — |

**The issue's criterion does not hold one octave from `lowCross`, and this
is the split's order, not its tuning.** A first-order shelf's log gain moves
by `Re(lp) = 1 / (1 + (f/fc)²)` of the way from `g` to `gL` (exactly so as
`gL/g` nears 1): 0.8 an octave below `lowCross` and 0.2 an octave above. So
at `lowDecay` 4 the decay rate an octave below is `0.25 + 0.2 × 0.75 = 0.4`
of Decay's where it should be 0.25, a T30 37 % short, and an octave above it
is 0.85 of Decay's, 18 % long; at 0.25 the misses are of the same size the
other way. Moving the corner trades one side for the other. Three octaves
away the split is within 2 % of its target, which is where the Retro
Reverb's own test reads its band (`inserts/retroReverbDsp.test.ts`).

At three octaves the band holds `lowDecay` to within about ±15 % of the
same band at `lowDecay` 1 in most cases. What remains is the plate's own
per-pass loss in that band: the 10 Hz tank low cut at 20 to 40 Hz (at Size
0.05 a low band can't ring much past 4 s), and the interpolating reads above
a few kHz. Those losses are a fixed number of dB a second, so they cost a
long low decay (`lowDecay` 4) a larger share than a short one.

`mixer/reverbLowBand.test.ts` pins the band three octaves out: at Size 1,
Decay 6 s and `lowCross` 1 kHz, the 125 Hz band within 15 % of Decay ×
`lowDecay` and the 8 kHz band within 10 % of itself at `lowDecay` 1, for
`lowDecay` 0.25 and 4.

### Each band at its own target (fix round 2)

Until fix round 2 the band's gains were cut from the broadband Decay's
corrected value times `lowDecay`: the correction for Decay, never for the
band's own RT60, Decay × `lowDecay`. The correction climbs with the RT60
asked, so a long low band fell short, most at small Sizes. Now
`decayCorrection.ts` looks the factor up at the band's own target (record
`2026-10-12-plate-decay-in-seconds`, decision 8). `lowCase.mjs`, three
octaves from `lowCross`, damping open, modulation off; "before" is fix round
1's bundle:

| Size | Decay × `lowDecay` | `lowCross` | Band | Target | Before, 48 kHz | After, 48 kHz | After, 44.1 kHz |
|---|---|---|---|---|---|---|---|
| 0.05 | 15 × 4 | 3 kHz | 375 Hz | 60 s | 38.81 s (−35.3 %) | 60.60 s (+1.0 %) | 47.92 s (−20.1 %) |
| 0.05 | 15 × 4 | 2 kHz | 250 Hz | 60 s | 36.61 s (−39.0 %) | 56.00 s (−6.7 %) | 46.94 s (−21.8 %) |
| 0.05 | 15 × 4 | 80 Hz | 640 Hz | 15 s | 15.82 s (+5.5 %) | 15.87 s (+5.8 %) | 13.88 s (−7.5 %) |
| 0.05 | 60 × 4 | 3 kHz | 375 Hz | 240 s | 74.67 s (−68.9 %) | 74.63 s (−68.9 %) | 56.29 s (−76.5 %) |
| 1 | 12 × 4 | 1 kHz | 125 Hz | 48 s | 46.37 s (−3.4 %) | 48.20 s (+0.4 %) | 48.12 s (+0.2 %) |
| 4 | 4 × 0.25 | 250 Hz | 31.25 Hz | 1 s | 1.04 s (+4.1 %) | 1.04 s (+4.1 %) | 1.04 s (+4.1 %) |
| 4 | 4 × 0.25 | 250 Hz | 2 kHz | 4 s | 4.22 s (+5.4 %) | 4.22 s (+5.4 %) | 4.22 s (+5.4 %) |
| 4 | 60 × 0.25 | 250 Hz | 31.25 Hz | 15 s | 16.15 s (+7.7 %) | 15.63 s (+4.2 %) | 15.63 s (+4.2 %) |
| 4 | 60 × 0.25 | 250 Hz | 2 kHz | 60 s | 55.76 s (−7.1 %) | 55.66 s (−7.2 %) | 55.38 s (−7.7 %) |

- **Size 0.05, Decay 15, `lowDecay` 4** is Codex's case: the band asks
  60 s, where the factor is 5.58, and got Decay's 1.38. At Size 0.05 only
  about 250 to 500 Hz rings past a minute even with every gain at 1 (31 Hz
  28 s, 62 Hz 46 s, 125 Hz 59 s, 250 Hz 77 s, 500 Hz 76 s, 1 kHz 63 s,
  2 kHz 32 s, 4 kHz 12 s, 8 kHz 4.3 s), so the low band is read at 375 Hz
  (`lowCross` 3 kHz). Three octaves above any such `lowCross` is past what a
  36 ms tank rings at all (16 kHz rings under a second whatever `lowDecay`),
  so the upper band is read at 640 Hz with `lowCross` 80 Hz.
- At 44.1 kHz the long low band at Size 0.05 runs short, as the broadband
  T30 does there: the table was measured at 48 kHz, and tacowars accepted
  that corner with no 44.1 kHz table (record, decision 5).
- **Decay 60 × `lowDecay` 4 at Size 0.05** asks 240 s, past the tank's
  ceiling (73.9 s broadband). The band rings as long as the tank can there,
  74.6 s, before and after: its factor sits in the table's ceiling cells.
- **Size 4, Decay 4, `lowDecay` 0.25**: the band asks 1 s, under one trip
  round the tank (2.9 s), and holds it to 4 %. At Size 4 the correction's
  row is flat up to 15 s, so the fix leaves it where it was. At Decay 2 and
  1 s the band runs long (+29 % and +74 %): its 0.5 s and 0.25 s are a few
  echoes a trip apart, with the input diffusers' ring under them.

`mixer/reverbLowBand.test.ts` pins the first, third, sixth and seventh rows
within 15 % at 48 kHz, and that the tank's sample loop calls nothing but the
plate's own line methods and `Math`, read off the shipped bundle.

## The corners

`corners.mjs`: a 1 s noise burst into every corner of Decay 0.2 and 60 s,
`lowDecay` 0.25 and 4, Size 0.05 and 4, both tank diffusions 0 and 0.8,
`lowCross` 80 Hz and 10 kHz, HOLD off and on (on from 1.5 s to 11.5 s, then
released); damping open, modulation at its default. Full rows in
`corners48.tsv`. Fix round 1 moved the top corner from 20 s to 60 s; the
Decay 0.2 s rows came out as before. Fix round 2, with the band's gains cut
from its own target, moved only the `lowDecay` 4 rows at Decay 0.2 s and
Size 0.05 (largest gain 0.990299 to 0.991137) and at Decay 60 s and Size 4
(0.999352 to 0.999437); every verdict holds.

- **Every gain point stays under 1.** Before each block outside HOLD the
  script reads each of the eight gain points, and the low band's gain at DC
  on it (`g + (gL − g)`, the shelf's largest). The largest over every corner
  is 0.999994, at Decay 60 s × `lowDecay` 4 and Size 0.05, where the
  band's 240 s is past the tank's ceiling and its factor (5.53, a ceiling
  cell) cuts its gains for an RT60 of about 1330 s. Swept over 58 Sizes from
  0.05 to 4 at Decay 60 × `lowDecay` 4, 60 × 1 and 0.2 × 0.25
  (`gainSweep.mjs`), the largest is the same 0.999994 at Size 0.05. The
  all-passes (|H| ≤ 1 for a gain under 1 inside) and the damping
  one-poles never gain, so no loop round the tank can reach 1.
- **Nothing runs away.** The renders ran in full: three times the longest
  RT60 after the burst (or after HOLD's release), up to 3 × 240 s = 720 s
  for Decay 60 s × `lowDecay` 4. Every corner is at least 17 dB under the
  first second's peak (128-sample RMS). The 17 dB ones are Decay 0.2 s at
  Size 4, where one trip takes 2.9 s, so 0.6 s after the burst its echoes
  are still arriving. Every corner at Decay 60 s had decayed to the sleep
  floor (about −140 dBFS) and slept. No sample was non-finite.
  `mixer/reverbDecay.test.ts` renders the longest corner the same way (Decay
  60 × `lowDecay` 4, tank diffusions 0.8, 720 s) at Size 4 and at Size 0.05,
  and holds both the gains and the level.
- **HOLD holds.** Over the eight seconds held, the last second is 1 to 11 dB
  under the second second, never above it (2 to 4 dB at Decay 60 s). The
  most is at Size 0.05, where
  the tank is passed 28 times a second and the interpolating reads take the
  top off the noise; HOLD's gains are the old ones, so this is the plate's
  HOLD as it was (the golden table's `hold` row is unchanged).

## No steps

`steps.mjs`, as the Size-sweep test measures a step (record
`2026-08-31-dattorro-reverb-not-plateau` §3): a steady 220 Hz tone at 0.3,
the move made with the tail ringing, and the largest left-channel
sample-to-sample step after the first five quanta against the tone's slew at
the render's peak, times 3. Defaults otherwise.

| Move | Largest step | Ceiling | |
|---|---|---|---|
| HOLD on at 2 s, off at 4 s, `lowDecay` 0.25 | 0.0209 | 0.0618 | pass |
| HOLD on and off, `lowDecay` 1 | 0.0297 | 0.0879 | pass |
| HOLD on and off, `lowDecay` 4 | 0.0355 | 0.1065 | pass |
| `lowDecay` 1 → 0.25 at 2 s, back at 4 s | 0.0236 | 0.0708 | pass |
| `lowDecay` 1 → 4 at 2 s, back at 4 s | 0.0354 | 0.1061 | pass |
| Decay 0.2 → 60 s at 2 s, back at 4 s | 0.0720 | 0.2152 | pass |
| Decay 60 → 0.2 s at 2 s, back at 4 s | 0.0721 | 0.2152 | pass |
| Decay 0.2 → 60 s and back, `lowDecay` 4 | 0.0760 | 0.2271 | pass |
| Decay 60 s, HOLD on at 2 s, off at 4 s, `lowDecay` 0.25 | 0.0807 | 0.2415 | pass |
| Decay 60 s, HOLD on and off, `lowDecay` 1 | 0.1022 | 0.3054 | pass |
| Decay 60 s, HOLD on and off, `lowDecay` 4 | 0.1087 | 0.3246 | pass |
| Steady, defaults | 0.0238 | 0.0714 | pass |

At 44.1 kHz every row passes with the same margins. Fix round 1 moved the
Decay steps' top from 20 s to 60 s and added the HOLD rows at Decay 60 s;
the other rows are unchanged. Fix round 2 re-ran every row: those with
`lowDecay` off 1 moved in the fourth decimal. `mixer/reverbLowBand.test.ts` pins the Decay
steps 0.2 ↔ 60 s.

**The Size ramp 0.05 → 4 → 0.05** (`sweepSlow.mjs`) passes over 8 s each way
at `lowDecay` 0.25, 1 and 4, but not over 2 s or 4 s each way:

| Each way | `lowDecay` 1 | 0.25 | 4 |
|---|---|---|---|
| 2 s | 0.264 / 0.203 | 0.176 / 0.165 | 0.289 / 0.218 |
| 4 s | 0.244 / 0.206 | 0.123 / 0.165 | 0.311 / 0.230 |
| 8 s | 0.181 / 0.235 | 0.103 / 0.174 | 0.243 / 0.265 |

That is the sweep's Doppler, not a step. `stepLocal.mjs` finds the largest
steps of the 2 s sweep at 5.06 to 5.13 s, where Size lands back on 0.05:
runs of five neighbouring samples each within a few percent of the largest,
about three times the RMS step of the 128 samples around them, which is a
steep waveform rather than a jump. The tone's pitch there, by zero crossings,
has risen from 220 Hz to about 720 Hz, since every line shortening at 0.3 s a
second plays its contents back about 1.3 times fast, and the tail passes
several lines while the sweep runs. `main` does the same once its tail is as
long: at a feedback gain of 0.97 the same sweep reaches 1.4 kHz and a step of
0.73. The test pins the 8 s sweep.

## CPU

The plate's render per 128-frame quantum, noise in at 0.25, default space,
sleep off, after two warm-up runs; the median of seven runs of 20 000 quanta
(`bench.mjs`), five in Chrome (the same loop run from the page,
`benchPage.html`). Apple M1.

Fix round 2 wrote the band's shelf out in the tank's sample loop, where fix
round 1 called it at each of the eight gain points (worklet rule 6). Both
bundles were run in one session, interleaved, three times each, and each
figure is the median of the three; the runs spread by up to 1.1 µs in Node,
where another session shared the machine, and 0.4 µs in Chrome. `main` ran
twice in Node and three times in Chrome.

| | `main` | Fix round 1, `lowDecay` 1 | Fix round 1, `lowDecay` 2 | Now, `lowDecay` 1 | Now, `lowDecay` 2 |
|---|---|---|---|---|---|
| Node 24.21.0 (V8) | 40.3 µs | 34.8 µs | 43.2 µs | 34.7 µs (−14 % on `main`) | 36.8 µs (−9 %) |
| Headless Chrome 155, main thread | 39.6 µs | 35.4 µs | 43.2 µs | 35.5 µs (−10 %) | 37.3 µs (−6 %) |

At `lowDecay` 1 the plate is cheaper than `main`: each all-pass's delayed
sample is read once and used twice, where it was read twice, and that saves
more than the eight extra multiplies cost. Written out, the band adds about
2 µs a quantum, eight one-pole lowpasses a sample; called, it added about
8 µs. At `lowDecay` 1 the two bundles cost the same, since the band's code
does not run. The Chrome figure is the bundle's own `process` timed on the
page's main thread, not inside an AudioWorklet.

## Allocation

`mixer/reverbAllocation.test.ts` passes unchanged in tolerance; its scenario
now also toggles `lowDecay` (so the band comes on, seeds and goes off) and
`lowCross`, and Decay moves between 3.35 and 12 s.

## Scripts

Run from the repository root, each with a bundle path, for example
`node docs/research/2026-10-12-plate-decay-seconds/sweepT30.mjs packages/engine/src/worklet/generated/reverb-processor.js 48000`.

- `plateRig.mjs`: loads a bundle, renders, T30, octave bands.
- `spacesMain.mjs`: the spaces' T30, with per-row overrides as JSON.
- `decayTable.mjs`: measures `reverbDecayTables.ts` (optionally only the
  Sizes listed after the bundle, to run rows in parallel).
- `sweepT30.mjs`: the sweep (`sweep48.tsv`, `sweep44.tsv`).
- `lowBand.mjs`: the band (`low48.tsv`, `low44.tsv`).
- `corners.mjs`: the corners (`corners48.tsv`).
- `steps.mjs`, `sweepSlow.mjs`, `stepLocal.mjs`: the step checks.
- `lowCase.mjs`: one case's bands three octaves from `lowCross`, against
  their own targets.
- `gainSweep.mjs`: the largest gain point over Size.
- `bench.mjs`, `benchPage.html`: the CPU figures in Node and Chrome.

## The cards

In the project's headless Chrome at its default window (1200 px wide): the
Plate card on Send A (the `room` return) and a Plate insert on the master
each show 15 space knobs over their three pages (Space: Pre, Size, Decay;
Diffusion: six; Tone: the four cuts, `Low ×` and `Low Hz`). Decay reads
`6.35s`, `Low ×` reads `×1.00` and `Low Hz` `300` at their defaults, and
nothing overflows the card. In fix round 1, Decay dragged to the top of its
travel on both cards reads `60.00s`, within its knob, and the page does not
scroll sideways.

![Send A, Space](room-return-space.png)
![Send A, Tone](room-return-tone.png)
![Master Plate insert, Space](plate-insert-space.png)
![Master Plate insert, Tone](plate-insert-tone.png)
