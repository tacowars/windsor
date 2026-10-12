# The plate's output taps: measurements

Written 2026-10-12 for windsor#766, item 5 of
`docs/research/2026-10-11-plate-reverb-upgrades/README.md`. The decision
record is `docs/log/2026-10-12-plate-output-taps.md`.

Every figure was read on this branch's `reverb-processor.js` and on `main` at
94a14d6 (Build, the stereo input and the four-point modulation merged; the
output taps still Dattorro's table 2), through the scripts in this folder and
windsor#763's in `../2026-10-12-plate-stereo-input/`. Machine: Apple M1,
16 GB, shared with other sessions. Backend: Node 24.21.0 (V8) unless a
section says Chrome. 48 kHz unless a table names another rate. No audio was
written to disk.

## What was built

- **The table** (`worklet/reverb/reverbTapTables.ts`): twelve taps a side
  where table 2 had seven, each a time in seconds at Size 1, a tank line and
  a signed gain of 1 or 0.75. `OUTPUT_TRIM` moves there too, at 0.4781
  (0.6 before).

  | Side | Lines read (taps) | Own half's share of \|gain\| |
  |---|---|---|
  | Left | 5, 6 ×2, 7 ×2 (guest); 8, 9 ×2, 10, 11 ×3 (own) | 7 against 4 |
  | Right | 4, 5 ×3, 6, 7 ×2 (own); 9 ×2, 10 ×2, 11 (guest) | 6.5 against 4.25 |

- **The reads** are written out in the tank's sample loop, two loops of a
  table read each (line, delay, signed gain) and `Math.floor`, where `main`
  called `_readTap` per tap and multiplied by a sign; `_readTap` is gone.
  `main`'s table read this way renders `main`'s golden to the bit.
- **The pole coefficients** (`poleCoefficients`) moved from `tank.ts` to
  `platePoles.ts`, which the written-out loops had taken past 350 lines. Its
  arithmetic is unchanged, and the golden held across the move.

## How the table was chosen

1. **The lead zone.** A click entering a half reaches that half's first two
   lines at once, because the half's first all-pass passes its input straight
   into the long line behind it, and its last two lines a long line later
   (141.7 ms on the right, 149.6 ms on the left, at Size 1). On `main` the
   other side heard nothing of a one-sided click for 50 ms at Size 1 and
   200 ms at Size 4 (the "silent" cells below), and windsor#763's criterion
   holds those cells. So every slot a click reaches inside 52 ms at Size 1
   belongs to the side its input leads (50 ms, and 2 ms for the read's reach
   and the modulation). Lines 4 and 8 are wholly inside it, so each is read by
   one side only.
2. **The deal** (`candidates.mjs`). Each half's slots are drawn on all four
   of its lines and sorted by when a click reaches them. The lead zone goes
   to the owner; past it the slots are dealt to the other side and back in
   turn, until one side's count is used up. That is the interleaving: the two
   outputs read each loop at alternating points. Each owner's first tap lands
   on its half's first all-pass inside 11.9 ms, so at Size 4 and Build 1 each
   side still hears its own input in the first 50 ms.
3. **Random draws failed.** 348 tables drawn this way (ten and twelve a side,
   random signs and magnitudes, `search.mjs`) all lost a late side-lead cell
   by 0.3 dB or more.
4. **Captures** (`capture.mjs`, `welch.mjs`, `optimise.mjs`). The taps feed
   nothing back, so the wet output is linear in their gains:
   left = trim × (Σ g·y + direct). An instrumented bundle records each tap's
   read and each side's Build direct path once per case. Every criterion is
   then a sum over those records for any gains: the early-density count, the
   side and mirror windows at 48 and 44.1 kHz, the correlation and mono sum of
   10 s of noise (third-octave bands by Welch, weighted by `measure.mjs`'s
   band filters), the level, the T30 of Decay 2 s at Size 4 (in 5 ms bins), and
   a centred source's balance. Read back on `main`'s table they reproduce
   `main`'s rendered figures exactly. A hill climb flips one tap's sign or
   magnitude at a time to raise the least margin over the criteria.
5. **Refinement** (`refine.mjs`). Each tap is captured at its time and a few
   steps of 1.5 to 3 ms either side, in one bank, and the climb also moves
   times. No move lets a tap cross another in its half's arrival order, so the
   deal holds.
6. **Twelve a side**, not ten. In the first round the best twelve-tap table
   came within 0.37 dB of every criterion and the best ten-tap within 1.02.
7. **The shipped table** is seed 403 of the fourth round, refined five times
   (`lineage.tsv`). The T30 cell and the balance joined the score after the
   first refinements read them off: a table chosen without them put Decay 2 s
   at Size 4 at −15 % and pulled a centred source 1.8 dB to one side at Size 4.
   `verify.mjs` reads any row through real renders, and they matched the
   captures to the fourth decimal.

The climb stalled 0.21 dB short of the side-lead allowance, in late windows
at Build 0 (below). The side cells are the one criterion the table misses.

## Early density

One centred click: wet samples, both sides, within 40 dB of the wet peak
(over its first second) in the first 100 ms (`criteria.mjs`).

| Build | Size | `main`, 48 kHz | new | | `main`, 44.1 kHz | new | |
|---|---|---|---|---|---|---|---|
| 0 | 0.25 | 8087 | 8318 | +2.9 % | 7417 | 7640 | +3.0 % |
| 0 | 1 | 7167 | 7830 | +9.3 % | 6601 | 7056 | +6.9 % |
| 0 | 4 | 6857 | 7116 | +3.8 % | 6542 | 6715 | +2.6 % |
| 1 | 0.25 | 3699 | 5175 | +39.9 % | 3655 | 4697 | +28.5 % |
| 1 | 1 | 2029 | 3430 | +69.0 % | 2025 | 3334 | +64.6 % |
| 1 | 4 | 723 | 1665 | +130.3 % | 657 | 1801 | +174.1 % |

At Build 0 the direct path fills most of the window on `main` already. At
Build 1 it is silent, and the window is the taps alone.

## Width and the mono sum

10 s of centred noise, the default space at each Size, read to a second past
its end. The mono sum is (L + R) / 2 against `main`'s, at the new trim.

| Size | `main` corr. | new | mono total | lowest band | at | 44.1 kHz: `main` corr. | new | mono total | lowest band |
|---|---|---|---|---|---|---|---|---|---|
| 0.25 | 0.0314 | 0.0023 | −0.20 dB | −1.16 dB | 125 Hz | 0.0294 | −0.0016 | −0.24 dB | −0.97 dB |
| 1 | 0.0071 | 0.0022 | −0.08 dB | −0.75 dB | 100 Hz | 0.0052 | 0.0059 | −0.03 dB | −0.65 dB |
| 4 | 0.0041 | 0.0021 | +0.18 dB | −0.60 dB | 100 Hz | 0.0038 | 0.0044 | +0.12 dB | −0.58 dB |

At 48 kHz the correlation falls at every Size. At 44.1 kHz it is 0.0007 and
0.0006 over `main`'s at Size 1 and 4. Both sit inside how far a 10 s noise
estimate wanders at these values. Every band of the mono sum, at both rates,
is within 1.2 dB of `main`'s:

| Size | 100 | 125 | 160 | 200 | 250 | 315 | 400 | 500 | 630 | 800 | 1k | 1.25k | 1.6k | 2k | 2.5k | 3.15k | 4k | 5k | 6.3k | 8k | 10k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.25 | −1.1 | −1.2 | −0.9 | −0.8 | −1.0 | −0.9 | −0.2 | 0.2 | 0.0 | −0.2 | −0.2 | −0.1 | −0.2 | −0.3 | −0.2 | −0.2 | −0.2 | −0.2 | −0.2 | −0.1 | 0.0 |
| 1 | −0.7 | −0.4 | −0.1 | 0.2 | 0.5 | 0.4 | 0.2 | 0.2 | 0.1 | 0.0 | −0.1 | −0.2 | −0.1 | −0.1 | −0.1 | −0.2 | −0.1 | −0.1 | −0.0 | −0.0 | −0.0 |
| 4 | −0.6 | −0.5 | −0.3 | 0.0 | 0.4 | 0.5 | 0.3 | 0.2 | 0.3 | 0.2 | 0.2 | 0.2 | 0.1 | 0.1 | 0.1 | 0.1 | 0.0 | 0.1 | 0.1 | 0.2 | 0.4 |

windsor#763's inversion of one injection was read again on the new taps
(its `criteria.mjs`): mono total −0.10 dB, lowest band −0.35 dB, correlation
−0.003. It buys nothing the plate needs, so the plate keeps one sign.

## Level

One centred click's wet RMS over its first second, both sides, the default
space.

| Build | `main` | new | | 44.1 kHz |
|---|---|---|---|---|
| 0 | 0.00336 | 0.00332 | −0.11 dB | −0.04 dB |
| 0.1 | 0.00308 | 0.00307 | −0.02 dB | +0.03 dB |
| 0.5 | 0.00320 | 0.00320 | −0.00 dB | +0.01 dB |
| 1 | 0.00323 | 0.00327 | +0.11 dB | +0.13 dB |

`OUTPUT_TRIM` is 0.4781: the trim that puts the mean of the Build 0, 0.5 and
1 rows, in dB, on `main`'s, at 48 kHz. A hard-left click's level moves
+0.02 to +0.19 dB (windsor#763's `criteria.mjs`).

## The sides

windsor#763's side-lead and mirror cells, re-run with its own `criteria.mjs`:
one click on L alone, then on R alone, the default space. Lead is the fed
side over the other in dB; "silent" is a window the other side hears nothing
in. Mirror is L alone's left over R alone's right, dB. Each cell reads
`main` → new.

48 kHz:

| Build | Size | L lead 0–50 | 50–200 | 200–1000 | R lead 0–50 | 50–200 | 200–1000 | mirror 0–50 | 50–200 | 200–1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.25 | 4.0 → 6.6 | 0.4 → 0.5 | 0.0 → 0.3 | 3.5 → 6.1 | 0.4 → −0.1 | 0.0 → −0.0 | −0.13 → 0.55 | −0.34 → 0.26 | −0.11 → 0.22 |
| 0 | 1 | silent → silent | 0.8 → 1.7 | 0.8 → 0.3 | silent → silent | 0.8 → 2.8 | **0.7 → 0.0** | 0.27 → −0.31 | −0.13 → −0.14 | −0.40 → 0.21 |
| 0 | 4 | silent → silent | silent → silent | **−0.0 → −0.6** | silent → silent | silent → silent | 0.3 → 1.6 | 1.16 → −0.33 | −0.79 → −0.10 | −0.44 → −0.25 |
| 1 | 0.25 | 5.2 → 8.3 | 1.4 → 3.0 | −0.1 → 0.0 | 4.6 → 8.5 | 1.8 → 4.4 | 0.2 → −0.0 | 2.71 → 2.18 | 0.47 → 0.31 | −0.85 → −0.60 |
| 1 | 1 | silent → silent | 6.4 → 10.1 | 0.4 → 0.2 | silent → silent | 6.2 → 10.1 | 0.8 → 1.1 | 2.61 → 1.89 | 0.28 → −0.27 | −1.30 → −1.20 |
| 1 | 4 | silent → silent | silent → silent | 1.1 → 1.4 | silent → silent | silent → silent | 2.1 → 4.7 | 8.22 → −2.48 | 2.84 → 0.48 | −1.90 → −2.04 |

44.1 kHz:

| Build | Size | L lead 0–50 | 50–200 | 200–1000 | R lead 0–50 | 50–200 | 200–1000 | mirror 0–50 | 50–200 | 200–1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.25 | 3.5 → 6.1 | 0.3 → 0.3 | −0.1 → 0.3 | 3.3 → 6.1 | **0.4 → −0.2** | 0.1 → −0.0 | −0.57 → 0.38 | −0.28 → 0.29 | −0.12 → 0.22 |
| 0 | 1 | silent → silent | 0.5 → 1.7 | **0.8 → 0.2** | silent → silent | 0.4 → 2.9 | **0.7 → 0.0** | −0.45 → −0.50 | 0.03 → 0.17 | **0.05 → 0.56** |
| 0 | 4 | silent → silent | silent → silent | **0.4 → −0.3** | silent → silent | silent → silent | 0.5 → 1.5 | 0.69 → −0.56 | −1.20 → 0.04 | −0.77 → −0.53 |
| 1 | 0.25 | 4.8 → 8.1 | 1.1 → 2.7 | −0.1 → −0.0 | 4.3 → 8.4 | 1.6 → 4.1 | 0.2 → −0.1 | 2.64 → 2.52 | 0.67 → 0.80 | −0.62 → −0.32 |
| 1 | 1 | silent → silent | 5.5 → 9.7 | 0.4 → 0.1 | silent → silent | 6.1 → 10.3 | 0.5 → 1.2 | 1.51 → 1.91 | 0.03 → 0.31 | −0.48 → −0.46 |
| 1 | 4 | silent → silent | silent → silent | 1.4 → 1.7 | silent → silent | silent → silent | 2.1 → 4.2 | 6.20 → −2.53 | 2.60 → 1.13 | −1.66 → −1.38 |

- **Every silent cell stays silent**, and every first-window lead grows
  (3.3–5.2 dB on `main`, 6.1–8.5 dB new, at Size 0.25).
- **The mirror** improves in most cells. Build 1 at Size 4, which windsor#763
  left at 8.22 dB (6.20 at 44.1 kHz), reads −2.48 (−2.53): each side's
  first tap now reaches the first window.
- **The cells in bold are worse than `main` by more than 0.5 dB,** all at
  Build 0. Past the allowance: 0.20 and 0.12 dB at 48 kHz; 0.03, 0.04, 0.20,
  0.21 and 0.01 dB at 44.1 kHz. Each is a late or middle window where `main`
  read under 0.8 dB, a field that is nearly diffuse by then. There, each
  owner's dense early taps catch the other input's energy the moment it
  crosses into their half, about 248 ms after a click at Size 1. The fed side's
  own early taps see that energy only when it comes back round, 275 ms later
  and some 5 dB quieter at the default Decay. The search traded these cells
  against early density and found no table that held them all
  (`docs/log/2026-10-12-plate-output-taps.md`, deviation 1).

## A centred source

L over R in dB: one centred click over its first second, and 10 s of centred
noise, the default space.

| Size | Build 0 | 0.5 | 1 | noise | `main` Build 0 | 0.5 | 1 | noise |
|---|---|---|---|---|---|---|---|---|
| 0.25 | 0.28 | 0.25 | −0.01 | 0.26 | 0.07 | 0.01 | −0.06 | 0.02 |
| 1 | −0.15 | −0.31 | −0.49 | −0.16 | 0.02 | −0.03 | −0.14 | −0.00 |
| 4 | −0.61 | −0.88 | −1.20 | −0.62 | −0.13 | −0.24 | −0.22 | −0.08 |

Twelve taps a side at different times can't weigh the two halves exactly
alike, and Size 4's first second holds less than two trips round the tank. A
table chosen without this criterion read 1.8 dB at Size 4. The climb held it
to within 1 dB or `main`'s own reading, and stalled at −1.20 dB
(`docs/log/2026-10-12-plate-output-taps.md`, deviation 2).

## The tail's length

T30, one centred click, the default Build, tank filters open and no
modulation, as `mixer/reverbDecay.test.ts` reads it.

| Decay | Size | `main` | new | 44.1 kHz: `main` | new |
|---|---|---|---|---|---|
| 2 | 0.25 | 2.00 (−0.1 %) | 2.00 (0.2 %) | 2.01 (0.7 %) | 2.02 (1.1 %) |
| 2 | 1 | 2.02 (1.1 %) | 2.02 (0.8 %) | 2.04 (1.8 %) | 2.03 (1.5 %) |
| 2 | 4 | 1.80 (−10.0 %) | 1.81 (−9.7 %) | 1.79 (−10.3 %) | 1.82 (−9.2 %) |
| 10 | 0.25 | 9.94 (−0.6 %) | 10.01 (0.1 %) | 9.97 (−0.3 %) | 10.04 (0.4 %) |
| 10 | 1 | 10.00 (0.0 %) | 10.01 (0.1 %) | 10.04 (0.4 %) | 10.05 (0.5 %) |
| 10 | 4 | 10.12 (1.2 %) | 10.09 (0.9 %) | 10.15 (1.5 %) | 10.12 (1.2 %) |
| 60 | 0.25 | 59.92 (−0.1 %) | 60.67 (1.1 %) | 59.66 (−0.6 %) | 60.40 (0.7 %) |
| 60 | 1 | 60.00 (−0.0 %) | 60.13 (0.2 %) | 59.94 (−0.1 %) | 60.06 (0.1 %) |
| 60 | 4 | 60.00 (−0.0 %) | 59.98 (−0.0 %) | 59.97 (−0.0 %) | 59.98 (−0.0 %) |

Decay 2 s at Size 4, where the 0.6 s lines lose 18 dB a pass and few passes
span the fit, is the cell the taps' places move. Across Build 0, 0.5 and 1 it
reads −9.9, −9.9 and −9.8 % (−9.3, −9.7, −9.6 % at 44.1 kHz), where `main`
read −10.2, −9.6 and −10.5 %. At the deepest modulation it reads −9.4 %
(`main` −9.8 %). Size 0.05's ceiling (`2026-10-12-plate-decay-in-seconds`) is
unchanged. The low band's modulated corner at Size 0.05 (375 Hz, Decay 10 ×
4, 8 Hz, 4 ms) reads 33.9 s of 40 (−15.4 %), where `main` read 34.8 s.

## Live moves

windsor#763's `liveMoves.mjs`: under a stereo drum loop with a tail ringing,
the largest step from 1 s on against the same loop's largest through a still
plate. At or under 1 passes the no-step test of
`2026-08-31-dattorro-reverb-not-plateau` §3.

| Move | new, 48 kHz | 44.1 kHz | `main`, 48 kHz | 44.1 kHz |
|---|---|---|---|---|
| Size 0.05 → 4 → 0.05, 1 s each way | 0.83 | 0.66 | 0.76 | 0.72 |
| Size 0.05 → 4 → 0.05, 8 s each way | 0.86 | 0.71 | 0.73 | 0.63 |
| Build 0 → 1 → 0, 1 s each way | 0.62 | 0.62 | 0.56 | 0.53 |
| Build 0 → 1 → 0, 8 s each way | 0.60 | 0.64 | 0.52 | 0.54 |
| HOLD on at 2 s, off at 4 s | 0.50 | 0.49 | 0.49 | 0.54 |

All pass. In `mixer/reverbModulation.test.ts` the 1 s `modDepth` sweep's
loudest drum step reads 1.018 of the still plate's (`main` within 1.01), the
other modulation sweeps 0.88 to 0.97. Every one passes its steady-tone
check, the no-step test itself.

## Every tap inside its line

`mixer/reverbTaps.test.ts` replays each block's taps and line lengths sample
by sample through Size jumps of 0.05 → 4 → 0.05 and 4 → 0.05 → 4 in one
block, and a sweep of 0.05 → 4 → 0.05 over 1 s each way, at 44.1, 48 and
96 kHz. Every tap reads at least one sample behind its line's write head and
two inside its length. The shortest tap is line 4's 2.2 ms (4.8 samples at
Size 0.05 and 44.1 kHz), and the longest share of its line is 81 % (line 9's
114.5 ms of 141.7), so `_applySize`'s clamp never binds.

## The whole box

`box.mjs`: 3,072 cells a plate at each rate, the new plate and `main` side by
side. The cells are every combination of the input (centred, L alone, R alone,
anti-phase), Size 0.05, 0.25, 1 and 4, Build 0 and 1, `diffusionTank1` and
`diffusionTank2` each at 0, 0.5, 0.8 and 1, Decay 0.2, 10 and 60 s, and HOLD
off or engaged 0.1 s after the click. One click a cell. The tank diffusions
stop at 0.8 on the descriptors (`MAX_TANK_DIFFUSION`), so a live AudioParam
clamps 1 to 0.8; the rig writes raw values, and 1 is read past the ceiling.
Rows: `box48k.tsv`, `box44.1k.tsv`, `box96k.tsv`.

| | 48 kHz | 44.1 kHz | 96 kHz |
|---|---|---|---|
| Non-finite samples, new / `main` | 0 / 0 | 0 / 0 | 0 / 0 |
| Largest peak, new / `main` | 1.113 / 1.238 | 1.085 / 1.049 | 0.738 / 0.762 |
| Level, new − `main`, first second, median | −0.10 dB | −0.12 dB | −0.15 dB |
| Level, diffusions to 0.8 but Decay 0.2 s at Size 4 | −0.99 to +3.42 dB | −1.10 to +3.58 dB | −1.06 to +3.56 dB |
| Early density, centred, not above `main` | 60 of 768 | 78 of 768 | 35 of 768 |
| Centred \|L/R\| over 1 dB, new / `main` | 104 / 4 | 77 / 4 | 62 / 7 |
| … diffusions to 0.8, worst | 1.50 dB (Size 4) | 1.51 dB | 1.48 dB |
| Lead 0–50 ms worse than `main` by over 0.5 dB | 8 of 816 | 16 of 816 | 4 of 816 |
| Silent on `main` and heard now | 0 | 0 | 0 |
| Anti-phase against L = R, least | −2.5 dB | −3.3 dB | −3.2 dB |
| HOLD keeps under 0.9 of `main`'s, a side | 167 of 1536 | 182 of 1536 | 123 of 1536 |

- **Level.** Past ±1.5 dB, inside the diffusions' range, only at Decay 0.2 s:
  Size 4 (33 cells at 48 kHz, up to +27.5 dB) and Size 1 at Build 1 (9
  cells). On `main`, a 0.2 s tail at Size 4 had all but died before table 2's
  taps read it (a hard-left click: 9.8e-5 of energy in its first second); the
  new early taps catch it. The other large gaps are all at a diffusion of 1,
  past the ceiling.
- **Early density** falls under `main`'s only at Size 0.05, where the whole
  tank is 36 ms round, and at Size 0.25 at Build 0. Inside the diffusions'
  range, 31 cells at 48 kHz (40 at 44.1, 8 at 96), by at most 3.8 % (4.0 %,
  6.1 %). Past the ceiling, with `diffusionTank1` at 1, Size 0.05 at Build 1
  and HOLD on falls by up to 56 % (45 %, 67 %): a held 36 ms tank at
  a raw all-pass gain of 1.
- **Centring** is the regression the box shows, mostly at Size 4 and Build 1
  (deviation 2 in the record). At Size 0.05, 0.25 and 1, inside the
  diffusions' range, the worst cell is 1.08 dB (1.18 dB at 44.1 kHz).
- **The 0–50 ms lead** loses more than 0.5 dB only at Size 0.05, nearly all
  with `diffusionTank2` at 1, by at most 0.67 dB (0.95 at 44.1 kHz, 0.64 at
  96), where `main` led by 0.8 to 1.4 dB: a 36 ms tank fills both halves
  inside the window either way.
- **HOLD** holds every cell. What a side keeps at 2 s against 0.6–1.1 s
  differs from `main` because twelve taps read the frozen tank's slowly
  drifting phases at other points. The least is 0.27 at 48 kHz and 0.18 at
  44.1 (`main` 0.66 and 0.49 there), at Size 0.05 with `diffusionTank1` at 1,
  past the ceiling. Inside the range the least is 0.53 (`main` 0.52), 0.39
  (0.50) and 0.54 (0.51).

## CPU

The plate's render cost a quantum: stereo noise in (L and R apart), the
default space, sleep off. `bench.mjs` in Node, `benchPage.html` in headless
Chrome on the page's main thread, the same loop (both windsor#763's). Node:
the median of three runs alternating the bundles, each run the median of
seven runs of 20,000 quanta. Chrome: the median of the runs that did not
stall the page's thread. Three of eight, of either bundle, read over 200 µs
and were discarded, leaving three of the new and two of `main`, each the
median of five runs.

| Bundle | Node 24.21.0 (V8) | Headless Chrome 155, main thread |
|---|---|---|
| `main` (table 2, `_readTap` per tap) | 42.58 µs | 44.0 µs |
| table 2, reads written out | 41.80 µs | — |
| ten a side (a first-round table), written out | 43.99 µs | — |
| new, twelve a side, written out | 45.86 µs (+7.7 %) | 47.6 µs (+8.2 %) |

Writing the reads out saves 0.8 µs on table 2. The ten extra taps cost
4.1 µs a quantum.

## Scripts

- `tapRig.mjs`: patches a candidate table into a bundle's source (each
  constant must match once), and the early density, sides, width and level.
- `candidates.mjs`: the lead zone and the deal; `search.mjs`: random tables
  read against `main`.
- `capture.mjs`, `welch.mjs`, `optimise.mjs`: the captures and the climb over
  gains and signs; `refine.mjs`: the climb over times as well; `verify.mjs`:
  a row through real renders. `lineage.tsv` lists the shipped table's steps.
- `criteria.mjs`: the density, width, level and T30 tables,
  `node criteria.mjs <new> <main> [rate]`. The sides and live moves are
  windsor#763's `criteria.mjs` and `liveMoves.mjs`.
- `box.mjs`: the whole box.

`main`'s bundle is `git show 94a14d6:packages/engine/src/worklet/generated/reverb-processor.js`.
