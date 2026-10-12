# The plate's room voicing: measurements

windsor#746, item 7 of `docs/research/2026-10-11-plate-reverb-upgrades/`. The
plate gets a `voicing`, `plate` or `room`: a row of tables the one tank reads
(both input chains' diffuser lengths and whether they follow Size, Build's
tap times, gain rows and direct levels, the output taps and their trim). The
decisions are in `docs/log/2026-10-12-plate-room-voicing.md`; this note holds
the figures behind them. Every figure is read off the shipped bundle
(`packages/engine/src/worklet/generated/reverb-processor.js`) against `main` at
3824eaa, at 48 kHz unless a row names another rate, in the default space unless
it names another. Every click waits half a second so the plate has settled at
its Size, and every window is read from the end of the pre-delay.

## What was built

- **Two rows of one shape** (`worklet/reverb/reverbVoicingTables.ts`): the
  plate voicing (row 0) keeps windsor#761's Build table and windsor#766's tap
  table and takes new input diffusers under 1 ms that do not follow Size; the
  room voicing (row 1, `reverbRoomTables.ts`) has diffusers around the lengths
  both chains held before, scaled by the square root of Size, a Build table of
  its own with no direct path, and twelve taps a side of its own.
- **The switch** (`plateVoicing.ts`): a change of `voicing` ducks the wet output
  and the tank's feed to zero over `INSERT_SWITCH_FADE_S` (5 ms), rendering
  the duck with a snapshot of every parameter as it stood the block before;
  at the first block boundary at silence it applies the new row and the live
  fields together, empties both input chains and both Build lines, lands the
  taps and the input lengths outright, and fades back in over the same time.
  The tank's loop is never cleared.
- **The field**: `voicing: 'plate' | 'room'` on `ReverbSpace`, so on the Send A
  bus's Plate insert (the `room` return since windsor#172) and on any Plate
  insert; the processor reads it as a k-rate parameter, 0 or 1, 0.5 and up the
  room. A missing `voicing` loads as `plate`. Every `SPACES` row and
  `DEFAULT_SPACE` say `plate`.
- **The switch on the card**: `Plate | Room` (`seg`), labelled `Voicing`, at
  the start of the Plate card's Diffusion page. Screenshots:
  `send-a-plate-card.png` (the Send A bus, after picking the `room` starting
  point over a room-voiced plate: the switch went back to Plate) and
  `master-and-send-a-plate-cards.png` (a Plate insert on the master above the
  bus's, both reading Plate).

## The plate voicing's diffusers

`plateSearch.mjs`, log `plateSearch.txt`. A set is feasible when windsor#763's
side leads (at least 3 dB in the first 50 ms) and its mirror at Size 0.25 and
1 (within 1 dB) hold at Build 0 with 0.05 dB to spare at 48 and 44.1 kHz, and
the held 1 kHz sine beats under −18.5 dB (`mixer/reverbModulationSpread.test.ts`).
Of 600 sets drawn between 0.25 and 1.5 ms (each R its L off by 3 to 15 %),
four were feasible; a climb from the best of them for 200 steps reached a
Size 4 mirror of 2.98 dB with 0.05 dB to spare elsewhere. The shipped set is
the feasible draw with the most to spare elsewhere (0.14 dB):

| | Line 0 / 12 | 1 / 13 | 2 / 14 | 3 / 15 |
|---|---|---|---|---|
| L, ms | 0.383 | 0.533 | 0.650 | 0.804 |
| R, ms | 0.331 | 0.498 | 0.580 | 0.747 |
| before windsor#746, L | 4.771 | 3.595 | 12.735 | 9.307 |
| before, R | 5.312 | 3.825 | 11.459 | 8.022 |

**No set under 2 ms holds the mirror at Size 4** (1.25 dB, the bound
windsor#765 and windsor#769 accepted). At Size 4 the first windows hold only
each half's first output taps, and with the click no longer smeared over tens
of milliseconds windsor#766's tap gains set the split: L alone's left output
hears two taps of gain 1 in the first 50 ms, R alone's right two of 0.75, and
in 50–200 ms the right hears a direct tap of gain 1 where the left hears only
recirculations. Scaling the old lengths down shows it (Build 0, Size 4, 48 kHz,
the three windows' mirror):

| Scale of the old lengths | Longest | Mirror 0–50, 50–200, 200–1000 ms |
|---|---|---|
| 0.05 | 0.64 ms | 1.58, −3.35, −0.06 |
| 0.1 | 1.27 ms | 2.16, −2.69, 0.47 |
| 0.15 | 1.91 ms | 2.65, −2.18, 0.89 |
| 0.5 | 6.37 ms | 0.37, −0.20, −0.25 |
| 1 (`main`) | 12.7 ms | −0.29, −0.11, −0.25 |

The shipped set reads 1.25, −3.61 and −0.34 dB (0.98, −3.54 and −0.83 at
44.1 kHz). Retuning windsor#766's taps for the plate voicing would move it;
the issue keeps that table, so this is a deviation for tacowars.

## Onset (`onset.mjs`)

One centred click in the default space. First arrival: ms to the first wet
sample within 40 dB of the wet peak over the first second. 20 ms energy: both
sides' squares. Early density: wet samples, both sides, within 40 dB of the
peak in the first 100 ms (windsor#766's count).

| Size | Build | first ms: `main` | plate | room | 20 ms energy: `main` | plate | room | density: `main` | plate | room |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.05 | 0 | 0.00 | 0.00 | 0.23 | 0.2950 | 1.1649 | 0.8761 | 9025 | 9226 | 9082 |
| 0.05 | 0.5 | 0.00 | 0.00 | 0.23 | 0.0175 | 0.1006 | 0.4900 | 8440 | 9013 | 9132 |
| 0.05 | 1 | 0.31 | 0.31 | 0.23 | 0.0006 | 0.0028 | 0.0498 | 6296 | 7049 | 8876 |
| 0.25 | 0 | 0.00 | 0.00 | 1.21 | 0.1173 | 0.3902 | 0.2321 | 8366 | 8921 | 8531 |
| 0.25 | 0.5 | 0.00 | 0.00 | 1.21 | 0.0060 | 0.0287 | 0.1232 | 7700 | 8691 | 8538 |
| 0.25 | 1 | 1.23 | 1.23 | 1.21 | 0.0002 | 0.0007 | 0.0112 | 5175 | 5212 | 8326 |
| 1 | 0 | 0.00 | 0.00 | 4.90 | 0.0725 | 0.2211 | 0.0452 | 7776 | 7668 | 7052 |
| 1 | 0.5 | 0.00 | 0.00 | 4.90 | 0.0023 | 0.0112 | 0.0196 | 6942 | 8334 | 7830 |
| 1 | 1 | 2.85 | 2.85 | 4.90 | 0.0001 | 0.0004 | 0.0021 | 3430 | 4408 | 6492 |
| 4 | 0 | 0.00 | 0.00 | 19.58 | 0.0418 | 0.1092 | 0.0049 | 7290 | 4698 | 1715 |
| 4 | 0.5 | 0.00 | 0.00 | 19.58 | 0.0005 | 0.0024 | 0.0019 | 5544 | 6394 | 4972 |
| 4 | 1 | 9.40 | 9.40 | 19.58 | 0.0000 | 0.0001 | 0.0002 | 1665 | 2172 | 2809 |

- **The plate voicing is instant.** At Size 0.25, 1 and 4, Build 0, its first
  arrival is `main`'s (0 ms, the direct path's first sample) and its 20 ms
  energy is 5.2, 4.8 and 4.2 dB over `main`'s.
- **The room's first arrival grows with Size**: 0.23, 1.21, 4.90 and 19.58 ms
  at Size 0.05, 0.25, 1 and 4, at every Build: it has no direct path, so its
  first arrival is its first tap.
- **At Size 1, Build 0 the room's early field is sparser** than the plate
  voicing's: 7 052 samples against 7 668. At Size 4 the plate voicing's own
  density falls under `main`'s (4 698 against 7 290): its compact burst sets
  a higher peak, and the 40 dB floor with it.
- **Build** (`build.mjs`, Size 1): the time to the wet envelope's peak rises
  with Build in both, 0, 0, 50, 90 and 140 ms in the plate voicing and 30, 30,
  40, 60 and 80 ms in the room at Build 0, 0.25, 0.5, 0.75 and 1.

## The tail's length (`t30.mjs`)

T30 off Decay, %, a centred click with damping open and the modulation off
(as `mixer/reverbDecay.test.ts` measures Decay).

| Decay | Size | Build | `main` | plate | room |
|---|---|---|---|---|---|
| 0.5 | 0.25 | 0 / 0.1 / 1 | +2.0 / +1.9 / +1.7 | +1.4 / +1.7 / +1.1 | +1.8 / +1.9 / +1.9 |
| 0.5 | 1 | 0 / 0.1 / 1 | −7.7 / −7.2 / −6.0 | −8.9 / −8.4 / −7.2 | +6.7 / +6.7 / +7.9 |
| 0.5 | 4 | 0 / 0.1 / 1 | +47.4 / +44.5 / +42.9 | +54.2 / +45.9 / +54.8 | +74.7 / +74.5 / +76.7 |
| 2 | 0.25 | 0 / 0.1 / 1 | +0.1 / +0.2 / −0.2 | −0.0 / +0.2 / −0.0 | +0.2 / +0.4 / +0.4 |
| 2 | 1 | 0 / 0.1 / 1 | +0.7 / +0.8 / +0.4 | +0.9 / +1.2 / +0.6 | +0.5 / +0.8 / +1.0 |
| 2 | 4 | 0 / 0.1 / 1 | −9.8 / −9.6 / −9.8 | −9.4 / −9.2 / −9.0 | +7.4 / +7.5 / +7.8 |
| 10 | 0.25 | 0 / 0.1 / 1 | −0.2 / +0.0 / −0.4 | −0.3 / +0.2 / −0.2 | +0.1 / +0.1 / +0.6 |
| 10 | 1 | 0 / 0.1 / 1 | −0.2 / +0.1 / −0.1 | +0.1 / +0.4 / +0.2 | +0.1 / +0.2 / +0.5 |
| 10 | 4 | 0 / 0.1 / 1 | +0.9 / +0.9 / +0.7 | +1.2 / +1.2 / +1.1 | +0.9 / +1.1 / +1.3 |

Every cell holds ±10 % but **Decay 0.5 s at Size 4**, which no voicing can
hold and `main` does not: at Size 4 one pass of the long lines takes 0.6 s
and loses 72 dB, so the fit reads where the taps lie in time, not a decay.
The correction was not re-measured; the corner is reported. The room's input
diffusers ring outside the loop, so they add to short tails at large Sizes;
scaled by Size itself they rang longer still. With the room's lengths at the
old ones, Build 0.1, damping open (`inputLaw.mjs`):

| Decay, Size | linear in Size | square root (shipped) | `main` |
|---|---|---|---|
| 0.5 s, 2 | +14.6 % | +4.1 % | −5.6 % |
| 0.5 s, 4 | +113.1 % | +75.6 % | +44.5 % |
| 1 s, 4 | +15.0 % | −1.3 % | −10.8 % |
| 1.5 s, 4 | +2.6 % | +1.5 % | −16.9 % |

## The room's diffusers

`roomSearch.mjs`, log `roomSearch.txt`. Each of the eight lengths drawn within
±15 % of the length its line held before; a set passes when the room voicing
keeps windsor#763's leads and mirror at Build 0 (Size 0.25, 1, 4; 48 and
44.1 kHz; 1 dB, 1.25 at Size 4), an early density at Size 1, Build 0 under
the plate voicing's, and T30 within 10 % at Decay 0.5 s, Size 1 and Decay
2 s, Size 4. The old lengths themselves pass with 0.17 dB to spare; 81 of 150
draws pass, and the shipped set has the most to spare, 0.25 dB:
L 4.881, 3.220, 12.439, 9.249 ms; R 5.532, 3.748, 10.023, 8.402 ms, at Size 1.

The room was tuned in the default space (diffusions 0.75, 0.625, 0.7, 0.5).
Item 8's room-voiced starting points can take lower diffusions to make the
reflections more distinct still; the processor applies none of them.

## The sides (`sides.mjs`)

windsor#763's cells: one click on L alone and one on R alone, the default
space; each side's lead (fed over other, dB) in 0–50, 50–200 and 200–1000 ms,
and the mirror (L alone's left over R alone's right, dB). `main` / plate /
room.

48 kHz:

| Build | Size | L lead 0–50 | 50–200 | 200–1000 | R lead 0–50 | 50–200 | 200–1000 | mirror 0–50 | 50–200 | 200–1000 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.25 | 6.92 / 4.20 / 10.90 | 0.49 / −0.01 / −0.86 | 0.30 / 0.16 / 0.33 | 6.39 / 5.15 / 9.94 | −0.03 / −0.97 / −1.10 | −0.03 / −0.16 / 0.34 | 0.55 / 0.01 / 0.43 | 0.26 / 0.27 / 0.16 | 0.22 / 0.06 / −0.10 |
| 0 | 1 | silent other side | 1.73 / −0.79 / 7.97 | 0.33 / 0.69 / −0.21 | silent other side | 2.86 / 1.05 / 7.52 | 0.04 / −0.60 / −0.20 | −0.30 / −0.15 / −0.03 | −0.14 / −0.68 / 0.61 | 0.21 / 0.58 / −0.22 |
| 0 | 4 | silent | silent | −0.64 / −0.98 / 5.64 | silent | silent | 1.61 / 1.20 / 5.49 | −0.28 / 1.25 / 0.81 | −0.10 / **−3.61** / 0.17 | −0.25 / −0.34 / 0.18 |
| 1 | 0.25 | 8.34 / 8.04 / 15.19 | 3.00 / 2.19 / 2.27 | 0.04 / 0.12 / 0.26 | 8.46 / 6.16 / 13.49 | 4.35 / 3.59 / 2.39 | −0.03 / −0.53 / 0.28 | 2.18 / 3.56 / 1.32 | 0.31 / −0.15 / 0.18 | −0.60 / −0.26 / −0.15 |
| 1 | 1 | silent | 10.05 / 8.98 / 11.73 | 0.15 / −0.27 / 0.11 | silent | 10.09 / 9.46 / 11.81 | 1.12 / 0.39 / 0.22 | 1.89 / 1.53 / 0.94 | −0.27 / −0.69 / −0.14 | −1.20 / −0.90 / −0.15 |
| 1 | 4 | silent | silent | 1.42 / 0.60 / 7.00 | silent | silent | 4.72 / 3.87 / 6.85 | −2.48 / −0.23 / 2.68 | 0.48 / 0.23 / 0.05 | −2.04 / −2.09 / 0.06 |

"Silent" is a lead over 300 dB: the other side hears nothing of that input in
the window, in all three. 44.1 kHz reads within 0.5 dB of these but for the
mirror cells the deviations name (plate, Build 0, Size 4: 0.98, −3.54,
−0.83). Every Build 0 cell holds `mixer/reverbStereo.test.ts`'s bounds in the
room voicing, and in the plate voicing but at Size 4 in 50–200 ms. At Build 1
the mirror misses 1 dB in both voicings at Size 0.25 (as on `main`) and in the
room at Size 4 (2.68 dB in 0–50 ms; `main` −2.48), where windsor#763 accepted
the misses.

## Width, level and the held tone

Centred noise, 10 s (`width.mjs`): balance (L over R), the mono sum against
`main`'s, its lowest third-octave band (100 Hz to 10 kHz) against `main`'s,
and the L/R correlation.

| Size | voicing | balance | mono − `main` | lowest band − `main` | correlation |
|---|---|---|---|---|---|
| 0.25 | `main` | +0.26 dB | — | — | 0.0024 |
| 0.25 | plate | +0.36 dB | −0.32 dB | −0.66 dB (10 kHz) | −0.0058 |
| 0.25 | room | +0.19 dB | −0.41 dB | −1.00 dB (200 Hz) | −0.0095 |
| 1 | `main` | −0.16 dB | — | — | 0.0027 |
| 1 | plate | −0.14 dB | −0.29 dB | −0.99 dB (10 kHz) | −0.0036 |
| 1 | room | +0.38 dB | −0.30 dB | −1.22 dB (200 Hz) | 0.0059 |
| 4 | `main` | −0.61 dB | — | — | 0.0037 |
| 4 | plate | −0.64 dB | −0.26 dB | −0.93 dB (10 kHz) | 0.0239 |
| 4 | room | +0.41 dB | −0.48 dB | −1.02 dB (10 kHz) | 0.0111 |

A centred click's wet RMS over its first second (`level.mjs`), Size 1:

| Build | plate − `main`, 48 kHz | room − plate, 48 kHz | plate − `main`, 44.1 kHz | room − plate, 44.1 kHz |
|---|---|---|---|---|
| 0 | −0.23 dB | −0.07 dB | +0.27 dB | −0.09 dB |
| 0.1 | −0.21 dB | −0.13 dB | +0.27 dB | −0.05 dB |
| 0.5 | −0.19 dB | +0.20 dB | +0.33 dB | +0.33 dB |
| 1 | −0.26 dB | −0.13 dB | +0.23 dB | +0.19 dB |

`ROOM_OUTPUT_TRIM`, 0.4856, puts the room's mean over Build 0, 0.5 and 1 on
the plate voicing's at 48 kHz (−0.00 dB; +0.14 dB at 44.1 kHz). Every centred
click and noise sits within 0.65 dB of centre in either voicing.

The held 1 kHz sine (`heldBeat.mjs`, `mixer/reverbModulationSpread.test.ts`'s
reading): `main` −19.45 dB, the plate voicing −19.63 dB, the room −18.36 dB
(the test's bound, −18.5 dB, is the default voicing's).

## Switching (`switchSteps.mjs`, `mixer/reverbVoicing.test.ts`)

Decay 10 s, so a tail rings through every switch; the voicing flipped at 2 s
and back at 3 s; the largest step on either side from 1 s on, against the
same feed through a still plate in each voicing (the no-step test of
`docs/log/2026-08-31-dattorro-reverb-not-plateau.md` §3), and for a steady
220 Hz tone against its own slew ceiling (2π·220/rate × the wet peak × 3).

| Switch | tone, ÷ still (48 kHz) | ÷ ceiling | drums ÷ still | tone ÷ still (44.1 kHz) | drums ÷ still |
|---|---|---|---|---|---|
| plate → room → plate | 0.61 | 0.35 | 0.91 | 0.64 | 0.93 |
| room → plate → room | 0.90 | 0.34 | 1.00 | 0.89 | 1.00 |
| a flip back during the duck | 0.51 | 0.34 | 0.91 | 0.51 | 0.93 |
| with HOLD on | 0.53 | 0.34 | 0.91 | 0.54 | 0.93 |

The drum loop's largest step is its own kick, through the still plate too.

- **The feed is ducked with the output.** Ducking the wet output alone, as the
  plan wrote it, the tone stepped 1.71 and 1.75 times the still plate's
  (`switchSteps.mjs … wet`): emptying the input chains at silence restarted
  their output as a step into the tank, which came round after the fade in.
  Ducked with the output, the chains restart under a 5 ms fade. Swapping at
  once with no duck (`… none`) stepped 5.7 to 34 times.
- **A starting point** (the `hall` space plate-voiced to the `room` space
  room-voiced, every field written at once, and back) steps no further than
  the drum loop through a still plate. With a steady tone it outruns the
  tone's slew with or without a voicing: its Size falls from 1.4 to 0.28 in
  Size's 50 ms glide, and the Doppler does it (`main`: 0.197 against a
  ceiling of 0.161; held at one voicing, 0.253 against 0.181).
- **The tail rings on** after every switch: its RMS 8 quanta after the switch
  is over a quarter of its RMS 4 quanta before, with the input stopped.

## CPU (`bench.mjs`, `benchPage.html`)

Stereo noise in (L and R apart), the default space, sleep off, 48 kHz. `duck`
flips the voicing every 6 quanta, so nearly every quantum ducks. Node 24.21.0
(V8) on an Apple M1 shared with other sessions: the median of three rounds
alternating the bundles, each the median of seven runs of 20 000 quanta.
Headless Chrome 155 on the same machine, the page's main thread: the median
of three rounds, each the median of five runs.

| Bundle | Node 24.21.0 | Headless Chrome 155 |
|---|---|---|
| `main` (3824eaa) | 45.42 µs | 47.50 µs |
| plate voicing | 37.95 µs (−16.4 %) | 40.43 µs (−14.9 %) |
| room voicing | 37.84 µs | 40.22 µs |
| ducking | 38.04 µs | 40.46 µs |

The plate got cheaper because L's chain is written out in the sample loop now,
as R's has been since windsor#763 (`tank.ts` had passed 350 lines, and the
written-out form is shorter). The same bundle with L's chain still through
`_read` and `_write1` cost 45.94 and 47.16 µs in Node, so the voicing and its
duck cost about 0.5 to 1.7 µs a quantum and the written-out chain saves about
8 µs. The render is the same to the bit with the chain written out (the golden
rows, at the old lengths). Nothing allocates per block, a switch included
(`mixer/reverbAllocation.test.ts` toggles the voicing in its scenario).

## The whole box (`box.mjs`)

1,200 cells a plate at each rate, `main`, the plate voicing and the room
voicing side by side: every combination of the input (centred, L alone),
Size 0.05, 0.25, 1 and 4, Build 0, 0.5 and 1, Decay 0.2, 0.5, 2, 10 and 60 s,
HOLD off or engaged 0.1 s after the click, and five variants: the default
space, all four diffusions (`diffusionIn1`, `diffusionIn2`, `diffusionTank1`,
`diffusionTank2`) at 0, all four at 1, `preDelay` 1 s, and `modDepth` 4 ms.
One click a cell. The tank diffusions stop at 0.8 on the descriptors, so a
live AudioParam clamps 1 to 0.8; the rig writes raw values and reads 1 past
the ceiling. Rows: `box48k.tsv`, `box44.1k.tsv`, `box96k.tsv`.

| | 48 kHz | 44.1 kHz | 96 kHz |
|---|---|---|---|
| Non-finite samples, `main` / plate / room | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Largest peak, `main` / plate / room | 0.945 / 0.945 / 0.797 | 0.623 / 0.623 / 0.838 | 0.486 / 0.486 / 0.503 |
| Level, plate − `main`, first second, median | −0.16 dB | +0.21 dB | −0.02 dB |
| … range, inside the ceiling | −6.20 to +1.36 dB | −5.60 to +1.13 dB | −6.78 to +1.29 dB |
| Level, room − plate, median | −0.11 dB | +0.07 dB | −0.14 dB |
| … range, inside the ceiling | −7.00 to +1.95 dB | −6.83 to +2.17 dB | −7.01 to +1.86 dB |
| Plate's first arrival later than `main`'s, centred | 0 of 600 | 0 of 600 | 0 of 600 |
| Plate's 0–50 ms energy under `main`'s, centred | 0 of 600 | 0 of 600 | 0 of 600 |
| Room's first arrival rising through Size 0.05, 0.25, 1, 4 | 300 of 300 | 300 of 300 | 300 of 300 |
| Centred \|L/R\| over 1.2 dB, `main` / plate / room | 43 / 37 / 15 of 600 | 28 / 23 / 26 | 25 / 15 / 27 |
| … worst inside the ceiling, `main` / plate / room | 1.43 / 1.48 / 1.07 dB | 1.71 / 1.47 / 1.10 dB | 1.63 / 2.23 / 0.96 dB |
| L alone leads under 3 dB in 0–50 ms, `main` / plate / room | 156 / 143 / 112 of 600 | 146 / 132 / 121 | 140 / 132 / 116 |
| HOLD keeps, least a side, `main` / plate / room | 0.54 / 0.54 / 0.47 | 0.41 / 0.51 / 0.45 | 0.54 / 0.54 / 0.48 |

- **Level.** The plate voicing's level sits on `main`'s (median within
  0.21 dB) except at the short decays at the small Sizes under HOLD: past
  ±1.5 dB in 48 of 960 cells inside the ceiling (42 at 44.1 kHz, 48 at 96),
  nearly all at Decay 0.2 or 0.5 s and Size 0.05 or 0.25, down to −6.8 dB at
  Size 0.05, Build 0.5, Decay 0.2 s, held. HOLD engages 0.1 s after the click:
  `main`'s long diffusers were still feeding the tank then, the plate
  voicing's 0.8 ms ones have long since fed it, so less is frozen. The room
  against the plate voicing has the same shape (60, 53 and 66 cells), plus
  the all-zero diffusions at Size 4 and Decay 0.2 to 0.5 s, up to +2.2 dB.
- **Centring.** The plate voicing's worst cell inside the ceiling is 2.23 dB
  at 96 kHz (1.48 and 1.47 at 48 and 44.1 kHz), at Size 4 with all four
  diffusions at 0 and Decay 0.2 s: a corner where `main` reads 1.63 dB and
  nothing smears the first taps. The room's worst is 1.10 dB.
- **The 0–50 ms lead** of L alone falls under 3 dB in fewer cells in either
  voicing than on `main`, all at Size 0.05 and 0.25, where the whole tank is
  36 to 180 ms round.
- **HOLD** holds every cell: the least a side keeps at 2 s against 0.6–1.1 s
  is 0.45 to 0.54 inside the ceiling.

## Scripts

All take bundle paths; `main`'s is `git show 3824eaa:packages/engine/src/worklet/generated/reverb-processor.js`.
They reuse windsor#763's rig (`../2026-10-12-plate-stereo-input/rig.mjs`,
`measure.mjs`).

- `voicingRig.mjs`: loads a bundle with candidate voicing tables patched in;
  the onset figures.
- `voicingMeasures.mjs`: the side cells, a centred click's level, the mono
  sum, the held sine's beat.
- `plateSearch.mjs`, `roomSearch.mjs`: the diffuser searches (logs beside).
- `onset.mjs`, `t30.mjs`, `sides.mjs`, `width.mjs`, `level.mjs`, `build.mjs`,
  `heldBeat.mjs`, `switchSteps.mjs`, `inputLaw.mjs`: the tables above.
- `box.mjs`: the whole box, `box48k.tsv`, `box44.1k.tsv`, `box96k.tsv`.
- `bench.mjs`, `benchPage.html`: the CPU.
