# The Tape's wow and flutter on a square law (windsor#818)

windsor#818 moves the Tape's Wow and Flutter dials, and the Wear macro's
wow and flutter, from a linear amount (`dial / 100`) onto a square law,
`0.3 · (dial / 100)²` (`inserts/tapeMotionCurve.ts`, record
`2026-10-16-tape-motion-on-a-square-law`). This note measures the pitch
swing the new dials play, at 44.1 and 48 kHz, and gives tacowars the listen.

## Method

`measure.mjs` loads the shipped `worklet/generated/tape-processor.js` under
Node (v24.16.0), builds the processor at the rate with seed 12345 and the
setting as its parameters (Dropouts 0), and calls its DSP's `advance` for
120 s: the controls' smoothing, the square law, `TapeMotion` and the hiss's
draw, as a rendered frame runs them. It reads `motion.delay` each sample. A
delay that moves by Δ samples in a sample plays the tape at 1 − Δ of its
speed, so the sample's pitch error is `1200 · log2(1 − Δ)` cents, the method
of the issue's Goal table. Each row gives the 1st and 99th percentiles of
that error, its largest magnitude, and its RMS (unweighted).

A "today" row is the same DSP with the linear amounts it replaces written
into its motion amounts, so the two differ in the mapping alone. The Goal's
table came from a separate replication of `TapeMotion`'s delay path; the
last comparison table repeats it from `TapeMotion.tick` alone (no hiss draw
between the motion's draws). It reads within about 10 % of the Goal's
figures (Wear 30: −92 to +108 here, −98 to +114 there). The two seeded
streams differ only in which draws the motion gets.

The swing is deterministic: it depends on the bundle, the seed and the
rate, not on the machine.

```
node docs/research/2026-10-16-tape-motion-range/measure.mjs [--seconds 120] [--goal]
```

## A real deck's figure

"A typical figure for a good analogue tape machine would be better than
0.02 per cent WRMS, and good cassette machines can approach this figure
also. Cheap cassette machines coupled with poor tapes can cause the figure
to rise considerably, with some examples approaching 0.5 per cent or
more." (Francis Rumsey and Tim McCormick, *Sound and Recording: An
Introduction*, 5th edition, Focal Press, 2006, Appendix 1, "Wow and
flutter".)

0.02 % of speed is 0.35 cents, and 0.5 % is 8.7 cents. WRMS weights the
error by a filter that peaks near 4 Hz, so the unweighted RMS column below
is only a rough reading against it. On the new dials, a good deck's speed
error sits around dial 10 (RMS 0.15 to 0.4 cents) and a cheap cassette's
around dials 25 to 50 (RMS 1 to 10 cents). That leaves dials 75 and 100
for a deliberately mangled tape. Under the old linear dials the same
cassette sat at dials 3 to 5.

## Results

The acceptance checks, at 48 kHz and the default rates (Wow 1 Hz, Flutter
7 Hz):

- **Split, Wow 100 swings exactly what today's Wow 30 does.** Both are
  amount 0.3, and the rows are equal to the digit.
- **Wow 41 with Flutter 58** reads −28.9 to +38.6 cents, against today's
  Wow 5 with Flutter 10 at −28.7 to +38.3: within 0.3 cents at p1 and p99.
- **Wear 30** drops from −90.0 to +112.2 cents (largest 202.8) to −7.9 to
  +10.4 (largest 19.3). tacowars's Wow 5, Flutter 10 drops from −28.7 to
  +38.3 to −0.8 to +1.2.

The largest magnitude can sit far above p99 at a slow Wow rate. The wow
holds a random target for a whole cycle (20 s at 0.05 Hz) and glides to the
next over about 0.23 s, so a run holds a handful of short, steep glides,
the first of them from rest at the start.

## The listen

`listen.mjs` renders a held C minor seventh (C3, G3, B♭3, E♭4, held 11 s
of a 12 s render) once through the shipped FM bundle. The patch is
`pad-drift` with its pitch LFO, its operator LFO and its unison spread off
and its attacks at 0.3 s, so the chord holds a still pitch. The script then
runs the chord through the shipped Tape bundle on the Ferric model, split,
with Drive 0, Dropouts 0, the hiss off, seed 12345 and the default rates.
It renders Wow 0, 25, 50, 75 and 100 (Flutter 0) and Flutter 25, 50 and
100 (Wow 0). All eight share one gain.

```
node docs/research/2026-10-16-tape-motion-range/listen.mjs --out ~/Desktop/tape-motion-listen
```

writes `tape-wow-000.wav` to `tape-flutter-100.wav` there (16-bit stereo,
48 kHz). Without `--out` it writes to `windsor-tape-motion-listen` in the
system temp folder, never into the repository.

## Tables

`measure.mjs --goal`'s output, as printed.

### Today, linear (48 kHz, default rates)

| Setting | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|
| Wear 30 (unsplit) | -90.0 to +112.2 | 202.8 | 33.21 |
| Split, Wow 5, Flutter 10 | -28.7 to +38.3 | 67.2 | 10.09 |
| Split, Wow 3, Flutter 3 | -9.8 to +11.2 | 23.1 | 3.24 |
| Split, Wow 30 | -40.7 to +65.2 | 104.4 | 16.49 |

### The square law (48 kHz, default rates)

| Setting | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|
| Split, Wow 100 | -40.7 to +65.2 | 104.4 | 16.49 |
| Split, Wow 41, Flutter 58 | -28.9 to +38.6 | 67.8 | 10.19 |
| Split, Wow 5, Flutter 10 | -0.8 to +1.2 | 2.0 | 0.30 |
| Wear 30 (unsplit) | -7.9 to +10.4 | 19.3 | 3.01 |

### The Goal's replication: TapeMotion.tick alone, today's amounts

| Setting | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|
| Wear 30 (unsplit) | -91.9 to +108.1 | 187.6 | 31.63 |
| Split, Wow 5, Flutter 10 | -27.6 to +39.4 | 65.5 | 10.35 |
| Split, Wow 3, Flutter 3 | -9.0 to +11.1 | 19.7 | 3.18 |

### Wow alone, 44.1 kHz

| Rates | Dial | Amount | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|---|---|
| wowRate 1 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1 | 10 | 0.0030 | -0.4 to +0.6 | 1.1 | 0.15 |
| wowRate 1 | 25 | 0.0187 | -2.2 to +3.7 | 6.7 | 0.91 |
| wowRate 1 | 50 | 0.0750 | -8.9 to +14.8 | 26.7 | 3.65 |
| wowRate 1 | 75 | 0.1687 | -20.2 to +33.1 | 59.5 | 8.20 |
| wowRate 1 | 100 | 0.3000 | -36.0 to +58.4 | 104.5 | 14.53 |
| wowRate 0.05 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 0.05 | 10 | 0.0030 | -0.1 to +0.1 | 1.0 | 0.04 |
| wowRate 0.05 | 25 | 0.0187 | -0.6 to +0.4 | 6.5 | 0.27 |
| wowRate 0.05 | 50 | 0.0750 | -2.3 to +1.6 | 26.0 | 1.10 |
| wowRate 0.05 | 75 | 0.1687 | -5.1 to +3.5 | 58.0 | 2.46 |
| wowRate 0.05 | 100 | 0.3000 | -9.1 to +6.3 | 101.8 | 4.36 |
| wowRate 3 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 3 | 10 | 0.0030 | -0.5 to +0.7 | 1.1 | 0.24 |
| wowRate 3 | 25 | 0.0187 | -2.8 to +4.3 | 6.6 | 1.52 |
| wowRate 3 | 50 | 0.0750 | -11.3 to +17.1 | 26.1 | 6.07 |
| wowRate 3 | 75 | 0.1687 | -25.6 to +38.3 | 58.2 | 13.63 |
| wowRate 3 | 100 | 0.3000 | -45.7 to +67.5 | 102.1 | 24.17 |

### Flutter alone, 44.1 kHz

| Rates | Dial | Amount | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|---|---|
| flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| flutterRate 7 | 10 | 0.0030 | -0.8 to +1.3 | 2.1 | 0.32 |
| flutterRate 7 | 25 | 0.0187 | -4.9 to +7.9 | 12.9 | 2.00 |
| flutterRate 7 | 50 | 0.0750 | -19.8 to +31.4 | 51.2 | 7.96 |
| flutterRate 7 | 75 | 0.1687 | -44.9 to +69.8 | 113.2 | 17.85 |
| flutterRate 7 | 100 | 0.3000 | -80.6 to +122.2 | 196.4 | 31.55 |
| flutterRate 1 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| flutterRate 1 | 10 | 0.0030 | -0.4 to +0.5 | 1.7 | 0.12 |
| flutterRate 1 | 25 | 0.0187 | -2.5 to +3.3 | 10.5 | 0.78 |
| flutterRate 1 | 50 | 0.0750 | -9.9 to +13.3 | 41.5 | 3.10 |
| flutterRate 1 | 75 | 0.1687 | -22.4 to +29.8 | 92.1 | 6.95 |
| flutterRate 1 | 100 | 0.3000 | -40.0 to +52.7 | 160.5 | 12.30 |
| flutterRate 20 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| flutterRate 20 | 10 | 0.0030 | -0.9 to +1.3 | 1.8 | 0.40 |
| flutterRate 20 | 25 | 0.0187 | -5.7 to +8.0 | 11.5 | 2.48 |
| flutterRate 20 | 50 | 0.0750 | -23.0 to +31.8 | 45.6 | 9.89 |
| flutterRate 20 | 75 | 0.1687 | -52.1 to +70.7 | 100.9 | 22.19 |
| flutterRate 20 | 100 | 0.3000 | -93.7 to +123.7 | 175.5 | 39.31 |

### Wear (unsplit), 44.1 kHz

| Rates | Dial | Amount | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|---|---|
| wowRate 1, flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1, flutterRate 7 | 10 | 0.0030 | -0.9 to +1.2 | 2.1 | 0.32 |
| wowRate 1, flutterRate 7 | 25 | 0.0187 | -5.7 to +7.0 | 13.2 | 2.05 |
| wowRate 1, flutterRate 7 | 50 | 0.0750 | -24.7 to +27.4 | 49.5 | 8.46 |
| wowRate 1, flutterRate 7 | 75 | 0.1687 | -54.3 to +61.6 | 117.9 | 18.12 |
| wowRate 1, flutterRate 7 | 100 | 0.3000 | -95.2 to +103.3 | 211.0 | 31.26 |
| wowRate 0.05, flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 0.05, flutterRate 7 | 10 | 0.0030 | -0.8 to +1.1 | 2.1 | 0.28 |
| wowRate 0.05, flutterRate 7 | 25 | 0.0187 | -5.5 to +7.1 | 12.7 | 1.79 |
| wowRate 0.05, flutterRate 7 | 50 | 0.0750 | -24.6 to +25.3 | 50.5 | 7.18 |
| wowRate 0.05, flutterRate 7 | 75 | 0.1687 | -51.9 to +46.8 | 110.5 | 13.39 |
| wowRate 0.05, flutterRate 7 | 100 | 0.3000 | -102.3 to +80.4 | 221.3 | 26.20 |
| wowRate 3, flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 3, flutterRate 7 | 10 | 0.0030 | -1.0 to +1.2 | 2.0 | 0.39 |
| wowRate 3, flutterRate 7 | 25 | 0.0187 | -6.2 to +7.5 | 14.5 | 2.37 |
| wowRate 3, flutterRate 7 | 50 | 0.0750 | -22.9 to +28.2 | 53.2 | 9.12 |
| wowRate 3, flutterRate 7 | 75 | 0.1687 | -56.7 to +64.4 | 118.6 | 21.37 |
| wowRate 3, flutterRate 7 | 100 | 0.3000 | -103.2 to +116.9 | 207.0 | 38.13 |
| wowRate 1, flutterRate 1 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1, flutterRate 1 | 10 | 0.0030 | -0.5 to +0.7 | 2.1 | 0.20 |
| wowRate 1, flutterRate 1 | 25 | 0.0187 | -3.7 to +4.3 | 13.4 | 1.27 |
| wowRate 1, flutterRate 1 | 50 | 0.0750 | -15.1 to +17.8 | 57.4 | 5.32 |
| wowRate 1, flutterRate 1 | 75 | 0.1687 | -29.8 to +40.2 | 107.4 | 11.39 |
| wowRate 1, flutterRate 1 | 100 | 0.3000 | -58.0 to +67.7 | 207.4 | 19.92 |
| wowRate 1, flutterRate 20 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1, flutterRate 20 | 10 | 0.0030 | -1.1 to +1.2 | 2.3 | 0.40 |
| wowRate 1, flutterRate 20 | 25 | 0.0187 | -6.4 to +7.0 | 12.9 | 2.40 |
| wowRate 1, flutterRate 20 | 50 | 0.0750 | -26.2 to +29.1 | 50.2 | 9.93 |
| wowRate 1, flutterRate 20 | 75 | 0.1687 | -63.3 to +67.5 | 103.6 | 22.85 |
| wowRate 1, flutterRate 20 | 100 | 0.3000 | -110.5 to +115.8 | 198.0 | 39.77 |

### Wow alone, 48 kHz

| Rates | Dial | Amount | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|---|---|
| wowRate 1 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1 | 10 | 0.0030 | -0.4 to +0.7 | 1.1 | 0.17 |
| wowRate 1 | 25 | 0.0187 | -2.5 to +4.2 | 6.7 | 1.04 |
| wowRate 1 | 50 | 0.0750 | -10.1 to +16.5 | 26.7 | 4.15 |
| wowRate 1 | 75 | 0.1687 | -22.8 to +37.0 | 59.5 | 9.31 |
| wowRate 1 | 100 | 0.3000 | -40.7 to +65.2 | 104.4 | 16.49 |
| wowRate 0.05 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 0.05 | 10 | 0.0030 | -0.1 to +0.0 | 0.6 | 0.03 |
| wowRate 0.05 | 25 | 0.0187 | -0.4 to +0.3 | 3.6 | 0.21 |
| wowRate 0.05 | 50 | 0.0750 | -1.4 to +1.0 | 14.2 | 0.84 |
| wowRate 0.05 | 75 | 0.1687 | -3.2 to +2.3 | 31.7 | 1.88 |
| wowRate 0.05 | 100 | 0.3000 | -5.7 to +4.0 | 56.0 | 3.35 |
| wowRate 3 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 3 | 10 | 0.0030 | -0.4 to +0.7 | 1.0 | 0.23 |
| wowRate 3 | 25 | 0.0187 | -2.8 to +4.3 | 6.1 | 1.47 |
| wowRate 3 | 50 | 0.0750 | -11.2 to +17.2 | 24.2 | 5.87 |
| wowRate 3 | 75 | 0.1687 | -25.4 to +38.5 | 54.0 | 13.18 |
| wowRate 3 | 100 | 0.3000 | -45.3 to +67.9 | 94.8 | 23.38 |

### Flutter alone, 48 kHz

| Rates | Dial | Amount | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|---|---|
| flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| flutterRate 7 | 10 | 0.0030 | -0.8 to +1.2 | 2.0 | 0.29 |
| flutterRate 7 | 25 | 0.0187 | -4.7 to +7.5 | 12.4 | 1.82 |
| flutterRate 7 | 50 | 0.0750 | -19.1 to +29.7 | 49.1 | 7.27 |
| flutterRate 7 | 75 | 0.1687 | -43.2 to +66.0 | 108.5 | 16.30 |
| flutterRate 7 | 100 | 0.3000 | -77.6 to +115.7 | 188.5 | 28.83 |
| flutterRate 1 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| flutterRate 1 | 10 | 0.0030 | -0.4 to +0.6 | 2.0 | 0.14 |
| flutterRate 1 | 25 | 0.0187 | -2.8 to +3.8 | 12.5 | 0.87 |
| flutterRate 1 | 50 | 0.0750 | -11.2 to +15.1 | 49.3 | 3.47 |
| flutterRate 1 | 75 | 0.1687 | -25.4 to +33.9 | 109.0 | 7.77 |
| flutterRate 1 | 100 | 0.3000 | -45.4 to +59.8 | 189.3 | 13.75 |
| flutterRate 20 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| flutterRate 20 | 10 | 0.0030 | -0.9 to +1.2 | 1.8 | 0.39 |
| flutterRate 20 | 25 | 0.0187 | -5.7 to +7.7 | 11.5 | 2.44 |
| flutterRate 20 | 50 | 0.0750 | -22.8 to +30.5 | 45.5 | 9.76 |
| flutterRate 20 | 75 | 0.1687 | -51.6 to +67.9 | 100.7 | 21.91 |
| flutterRate 20 | 100 | 0.3000 | -92.9 to +119.0 | 175.1 | 38.83 |

### Wear (unsplit), 48 kHz

| Rates | Dial | Amount | p1 to p99 (cents) | Largest (cents) | RMS (cents) |
|---|---|---|---|---|---|
| wowRate 1, flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1, flutterRate 7 | 10 | 0.0030 | -0.9 to +1.1 | 2.2 | 0.33 |
| wowRate 1, flutterRate 7 | 25 | 0.0187 | -5.7 to +6.7 | 12.1 | 1.98 |
| wowRate 1, flutterRate 7 | 50 | 0.0750 | -22.3 to +28.3 | 50.6 | 8.06 |
| wowRate 1, flutterRate 7 | 75 | 0.1687 | -52.3 to +61.5 | 117.7 | 17.96 |
| wowRate 1, flutterRate 7 | 100 | 0.3000 | -91.4 to +110.5 | 193.4 | 33.31 |
| wowRate 0.05, flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 0.05, flutterRate 7 | 10 | 0.0030 | -0.7 to +1.1 | 2.0 | 0.26 |
| wowRate 0.05, flutterRate 7 | 25 | 0.0187 | -5.2 to +5.5 | 13.2 | 1.55 |
| wowRate 0.05, flutterRate 7 | 50 | 0.0750 | -24.5 to +22.0 | 46.0 | 6.41 |
| wowRate 0.05, flutterRate 7 | 75 | 0.1687 | -60.8 to +50.6 | 108.6 | 16.00 |
| wowRate 0.05, flutterRate 7 | 100 | 0.3000 | -97.5 to +81.7 | 228.8 | 24.44 |
| wowRate 3, flutterRate 7 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 3, flutterRate 7 | 10 | 0.0030 | -1.0 to +1.2 | 2.2 | 0.37 |
| wowRate 3, flutterRate 7 | 25 | 0.0187 | -6.2 to +7.6 | 15.4 | 2.39 |
| wowRate 3, flutterRate 7 | 50 | 0.0750 | -24.6 to +29.9 | 61.8 | 9.43 |
| wowRate 3, flutterRate 7 | 75 | 0.1687 | -57.7 to +70.9 | 120.2 | 21.89 |
| wowRate 3, flutterRate 7 | 100 | 0.3000 | -100.3 to +119.0 | 210.2 | 37.41 |
| wowRate 1, flutterRate 1 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1, flutterRate 1 | 10 | 0.0030 | -0.6 to +0.7 | 1.9 | 0.20 |
| wowRate 1, flutterRate 1 | 25 | 0.0187 | -3.5 to +4.8 | 12.2 | 1.28 |
| wowRate 1, flutterRate 1 | 50 | 0.0750 | -13.6 to +19.3 | 51.7 | 4.99 |
| wowRate 1, flutterRate 1 | 75 | 0.1687 | -27.4 to +36.1 | 116.5 | 10.34 |
| wowRate 1, flutterRate 1 | 100 | 0.3000 | -52.7 to +62.4 | 195.2 | 18.56 |
| wowRate 1, flutterRate 20 | 0 | 0.0000 | 0.0 to +0.0 | 0.0 | 0.00 |
| wowRate 1, flutterRate 20 | 10 | 0.0030 | -1.1 to +1.2 | 2.3 | 0.41 |
| wowRate 1, flutterRate 20 | 25 | 0.0187 | -7.3 to +7.4 | 13.6 | 2.56 |
| wowRate 1, flutterRate 20 | 50 | 0.0750 | -29.1 to +28.7 | 50.5 | 10.14 |
| wowRate 1, flutterRate 20 | 75 | 0.1687 | -64.0 to +64.1 | 129.0 | 22.82 |
| wowRate 1, flutterRate 20 | 100 | 0.3000 | -109.5 to +114.5 | 192.3 | 39.36 |
