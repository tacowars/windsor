# Synced Saw, Square and Pulse alias: the candidates measured (windsor#652)

Hard sync (windsor#646, record `docs/log/2026-10-09-operator-hard-sync.md`)
ships the Saw, Square and Pulse taking the reset uncorrected. This note
measures four ways to remove that alias, each alone and with the fine
control interval, and recommends one. Nothing under `packages/` changes:
every candidate is an in-memory edit of the shipped FM bundle's text, run
through `docs/research/2026-10-09-operator-hard-sync/workletBundle.mjs`.

**Recommendation: C + D, a direct shape with a four-point polyBLEP and the
fine control interval for a voice whose ratio is modulated.** On
`lead-sync-sweep` it takes the framed median from −32.0 to −49.5 dB at
MIDI 72 and from −28.4 to −46.1 dB at MIDI 84, for 1.45 to 1.58 times the
synced voice's shipped CPU. It costs some top end: the harmonics at 15 to
20 kHz sit 6 to 10 dB under the reference's. It leaves a phase-modulated,
fed, squeezed or Tone-reduced synced Saw on today's path. The reasons, the
alternative, and what tacowars should listen for are under
[Recommendation](#recommendation).

**D is needed by every candidate.** Without it the ratio steps every 128
samples, and that stepping alone sits at about −43 dB. No candidate gets
past it without D.

## Machine and method

| | |
|---|---|
| Machine | Apple M1, 8 cores, macOS 26.7.1 |
| Runtime | Node 24.21.0 (V8). No browser: the bundle is evaluated under Node, as the #548 method does |
| Backend | `packages/engine/src/worklet/generated/fm-processor.js` at `origin/main` 1eb05d1, edited in memory per candidate; a stand-in `AudioWorkletProcessor`, 128-frame quanta, seed 1. No Web Audio |
| Load | other sessions shared the machine: load average 2.6 to 2.8 through the first CPU run, 4.8 to 5.5 through the second |

These are dev-machine readings. The CPU figures show relative cost on one
machine and say nothing about audio-thread headroom in Chrome.

### The two metrics

Both are the diagnostic renders' (decision 2). A synced wave repeats at the
note's period, so any component that is not a harmonic of the note is
folded alias. Through a four-term Blackman-Harris window, the energy within
±6 bins of each harmonic is the signal, and everything else from 20 Hz to
20 kHz is the alias, given in dB under the signal.

- **Framed** (`framed.mjs`): `lead-sync-sweep` as shipped, one held note at
  MIDI 72 and one at 84, 8 s each (two cycles of its 0.25 Hz LFO), left
  channel at 48 kHz. 8 192-sample frames, hop 2 048, from 0.5 s to 8 s:
  172 frames a note. The median and p90 over frames.
- **Stationary** (`stationary.mjs`): `alias.mjs`'s one synced carrier at
  ratio 3.7, held, at MIDI 60 to 96, one frame of 32 768 from 0.1 s. A 0.3
  Pulse; the Saw and Square unsqueezed. The carrier plays on Additive, not
  Series, because A counts Series's silent B as a modulator (see A below).
  Additive changes the level only, so shipped's and the reference's figures
  match `alias.mjs`'s published ones to 0.1 dB.

### The reference

The shipped bundle at 768 kHz (16×), brought to 48 kHz through a 2 049-tap
Kaiser-windowed sinc (β 11.2, cutoff 24 kHz). Its passband is flat to
0.001 dB to 20 kHz. Its worst gain on anything that folds into 0–20 kHz is
−119.2 dB (`response.mjs`). Two rows:

- `ref16`: the control intervals as shipped, 32 and 128 samples, so 16
  times finer in time than at 48 kHz. This is the diagnostic renders'
  reference: −54 dB.
- `ref16s`: the intervals scaled 16 times, so the ratio steps as often in
  time as it does at 48 kHz. It isolates the stepping.

Every decimation here is applied zero phase, so renders compare sample for
sample. A's one sample and C's two of lateness are taken out the same way
(`render.mjs`).

## The candidates as built

- **A. Restricted direct shape** (`directBundle.mjs`, two points). Who takes
  it is decided at the bind: a synced Saw, Square or Pulse with no
  modulator in its algorithm, feedback 0, no LFO on its width, a Saw or
  Square at width 1, and the patch's Tone at 1. Every other synced operator
  keeps today's path.
  - **The shape.** Windsor's polarity and the tables' level. The table is
    `Σ aₙ sin(2πnp)` over its own peak, so its fundamental is `g = 1 /
    peak`. The direct shape is the same sum carried to every harmonic:
    - the Saw: `g·π/2·(1 − 2p)`, a falling ramp;
    - the Square: `±g·π/4`;
    - the Pulse: `saw(p) − saw(p + w)`, which is `g·π·w` up to phase `1 − w`
      and `g·π·(w − 1)` after.

    `g` is read off the operator's current mip, so the level follows the
    mip as the table path's does.
  - **The edges.** After each sample's resets, in time order: the wraps and
    duty edges on the free-running path up to the reset, then the reset's
    step (from the left limit at the free-running phase just before it to
    the wave at phase 0), then any duty edge after it (consult findings 2
    and 3).
  - **The polyBLEP.** Two points. The operator's wave goes on a sample late.
  - **A modulator slot counts even when silent.** The bind tests the
    algorithm, not the modulators' levels. A build should decide whether an
    operator at Level 0 with nothing raising it frees its carrier.
- **B. Oversampling the synced voice, 2× and 4×.** The voice rendered at
  96 or 192 kHz with its tables built at that rate, the control intervals
  scaled so it updates as often in time, and then decimated. Today's reset
  correction stays on the waves that use it.
  - **2×** is the drive oversampler's FIR
    (`worklet/advancedDrive/driveOversample.ts`, `DRIVE_DSP.firLength` 65,
    `firCutoff` 0.235): a 65-tap Blackman-windowed sinc, 96 → 48 kHz.
  - **4×** is a 25-tap Blackman-windowed sinc (cutoff 48 kHz) from 192 to
    96 kHz, then the same 65 taps.

  | Chain | Taps | Folded into 0–20 kHz | Passband, 20 Hz–20 kHz | Group delay | Multiplies per output sample |
  |---|---|---|---|---|---|
  | B 2× | 65 | −75.3 dB | −0.25 to 0.00 dB | 16 samples, 0.333 ms | 65 |
  | B 4× | 25 + 65 | −74.0 dB, then −75.3 dB | −0.25 to 0.00 dB | 19 samples, 0.396 ms | 115 |

  The in-memory render runs the whole voice at the higher rate.
  `lead-sync-sweep`'s filter and drive are off, so for it that means the
  operators, the carrier sum and the pan.
- **C. A four-point polyBLEP** in A instead of two-point, since A misses
  the target. The kernel is the integrated cubic B-spline less the step,
  over two samples each side. The operator's wave goes on two samples late.
- **D. The fine control interval** (32 samples) for a voice an LFO's
  `toRatio` reaches with a depth, at any rate and shape
  (`candidates.mjs`). A build would add the step, song-lane and macro
  sources of `ops.<i>.ratio`; `lead-sync-sweep` uses only the LFO.
- **AB2: A inside B's 2× voice.** Not in the issue's list. It is measured
  because it is the only variant that reaches the reference.

## Framed alias, `lead-sync-sweep`

Median and p90 over frames, dB under the signal.

| Variant | MIDI 72 median | MIDI 72 p90 | MIDI 84 median | MIDI 84 p90 |
|---|---|---|---|---|
| shipped | −32.0 | −27.0 | −28.4 | −23.8 |
| shipped + D | −32.3 | −27.0 | −28.5 | −23.9 |
| **16× reference** (`ref16`) | **−54.0** | −40.8 | **−53.9** | −43.8 |
| 16×, stepping as at 48 kHz (`ref16s`) | −43.0 | −38.3 | −42.6 | −39.5 |
| 16×, stepping as at 48 kHz, + D | −53.8 | −40.8 | −53.6 | −43.8 |
| A | −36.1 | −33.1 | −32.8 | −28.9 |
| A + D | −36.8 | −33.6 | −33.1 | −29.2 |
| C | −44.2 | −40.4 | −42.3 | −38.4 |
| **C + D** | **−49.5** | −42.4 | **−46.1** | −40.6 |
| B 2× | −37.8 | −33.0 | −35.0 | −30.0 |
| B 2× + D | −39.2 | −33.4 | −35.8 | −30.4 |
| B 4× | −41.3 | −37.6 | −39.1 | −35.4 |
| B 4× + D | −46.7 | −39.1 | −42.0 | −36.1 |
| AB2 (not in the issue's list) | −43.4 | −38.8 | −42.9 | −39.7 |
| AB2 + D | −54.7 | −41.2 | −53.9 | −44.4 |

- **The stepping floor.** `ref16s` against `ref16`: a ratio stepped every
  128 samples sits at −43 dB, and every candidate without D stops near it.
  With D the 16× render returns to −54 dB, so 32 samples is fine enough.
- **D alone** changes almost nothing (−0.3 and −0.1 dB): shipped's alias is
  11 to 14 dB over the stepping.
- **A** gains 4 dB. That matches the hard-sync note's naive model (a
  direct saw with a two-point polyBLEP on every edge): A's stationary saw at
  MIDI 84 is −32.1 dB, the model's figure exactly.
- **The p90** is near −41 dB at MIDI 72 and −44 dB at MIDI 84 even in the
  reference. That floor is not alias: it is the sweep's own movement inside
  a frame, which smears harmonics past the ±6-bin masks. Only the medians
  separate the candidates.

## Stationary alias, `alias.mjs`'s carrier

dB under the signal, ratio 3.7.

| Wave | Note | Shipped | 16× reference | A | C | B 2× | B 4× | AB2 |
|---|---|---|---|---|---|---|---|---|
| saw | 60 | −33.9 | −59.7 | −37.7 | −51.4 | −41.2 | −47.4 | −58.4 |
| square | 60 | −32.8 | −58.4 | −39.8 | −54.1 | −39.7 | −45.8 | −59.4 |
| pulse (0.3) | 60 | −35.1 | −63.6 | −39.6 | −53.8 | −43.8 | −50.6 | −59.9 |
| saw | 72 | −30.3 | −56.8 | −34.1 | −47.6 | −38.1 | −44.3 | −55.7 |
| square | 72 | −29.3 | −55.1 | −34.9 | −47.9 | −36.4 | −42.8 | −58.5 |
| pulse (0.3) | 72 | −32.1 | −59.6 | −34.2 | −46.9 | −40.7 | −47.3 | −58.4 |
| saw | 84 | −26.5 | −53.3 | −32.1 | −46.6 | −34.2 | −41.1 | −51.4 |
| square | 84 | −26.7 | −51.7 | −35.8 | −51.1 | −32.9 | −39.3 | −56.2 |
| pulse (0.3) | 84 | −28.1 | −56.4 | −31.4 | −45.5 | −37.7 | −44.1 | −56.3 |
| saw | 96 | −23.5 | −49.5 | −26.2 | −39.9 | −30.3 | −36.8 | −45.7 |
| square | 96 | −21.5 | −48.0 | −36.7 | −54.9 | −29.9 | −35.4 | −54.7 |
| pulse (0.3) | 96 | −25.1 | −53.1 | −29.2 | −43.2 | −33.8 | −41.0 | −54.7 |

**With D, every cell is the same.** A held carrier's ratio is not
modulated, so D cannot change it. `--check-d` rendered every `+D` variant
and found each bit-identical to its row.

## Correctness beyond the alias figure (decision 4)

`checks.mjs`. Every figure reads 0.5 s from 0.1 s in.

### A against the table path at a low note

MIDI 36, the synced carrier at ratio 1 and at 3.7, the first ten harmonics
compared with shipped's, where both are band limited alike.

| Wave | Ratio | Peak, A / shipped | Mean, A / shipped | Worst level gap | Worst phase gap |
|---|---|---|---|---|---|
| saw | 1 | 0.241 / 0.283 | −0.0005 / −0.0005 | 0.00 dB | 0.0° |
| square | 1 | 0.241 / 0.283 | −0.0016 / −0.0016 | 0.00 dB | 0.0° |
| pulse (0.3) | 1 | 0.338 / 0.380 | −0.0013 / −0.0013 | 0.00 dB | 0.0° |
| saw | 3.7 | 0.240 / 0.283 | 0.0140 / 0.0140 | 0.11 dB | 1.0° |
| square | 3.7 | 0.240 / 0.283 | 0.0198 / 0.0198 | 0.03 dB | 0.4° |
| pulse (0.3) | 3.7 | 0.339 / 0.381 | 0.0280 / 0.0279 | 0.35 dB | 0.0° |

- **Polarity, harmonics and the Pulse's mean agree.** A passes. C's
  figures are within 0.01 dB of A's.
- **The peak does not, by design.** A's peak is 15 % (1.4 dB) under the
  table's while its harmonics match: the table is a truncated Fourier
  series normalised to its Gibbs overshoot, and the direct shape has no
  overshoot. Anything after the operator that reacts to peaks rather than
  to harmonics hears the difference, the drive stage first.

### Against the reference's waveform

MIDI 72 and 84, ratio 3.7. The error energy is the energy of the variant
less the reference, in dB under the reference's.

| Wave | Note | Shipped | A | **A inverted** | C | B 2× | B 4× | AB2 |
|---|---|---|---|---|---|---|---|---|
| saw | 72 | −18.8 / 0.996 | −20.2 / 0.996 | **+6.2 / −0.996** | −17.1 / 0.990 | −25.3 / 0.999 | −27.2 / 0.999 | −25.1 / 0.999 |
| square | 72 | −26.5 / 0.999 | −21.8 / 0.997 | **+5.9 / −0.997** | −18.2 / 0.993 | −31.0 / 1.000 | −32.7 / 1.000 | −28.9 / 0.999 |
| pulse (0.3) | 72 | −17.6 / 0.994 | −20.9 / 0.997 | **+6.2 / −0.997** | −18.0 / 0.992 | −24.4 / 0.999 | −26.0 / 0.999 | −24.3 / 0.998 |
| saw | 84 | −12.7 / 0.986 | −16.1 / 0.992 | **+6.4 / −0.992** | −13.9 / 0.980 | −19.3 / 0.996 | −21.2 / 0.996 | −19.5 / 0.995 |
| square | 84 | −24.1 / 0.998 | −18.8 / 0.995 | **+5.8 / −0.995** | −15.2 / 0.988 | −31.0 / 1.000 | −35.5 / 1.000 | −29.2 / 1.000 |
| pulse (0.3) | 84 | −12.8 / 0.988 | −16.4 / 0.994 | **+5.8 / −0.994** | −14.7 / 0.985 | −20.7 / 0.998 | −24.0 / 0.998 | −21.5 / 0.998 |

Each cell is the error energy in dB, then the correlation.

- **The sine-and-inverse check.** A inverted has A's alias figure to the
  tenth of a dB, and here it correlates at −0.99 with an error 6 dB over
  the signal. A's polarity is right.
- **The error is dominated by level, not alias.** A and C read worse than
  shipped on the square because they lose top end (below). B's error is
  lowest because its tables and decimator keep the reference's top.

### Brightness against the reference

Harmonic energy per band, in dB against the reference's.

| Variant | Wave, note | 0–5 kHz | 5–10 kHz | 10–15 kHz | 15–20 kHz |
|---|---|---|---|---|---|
| shipped | saw, 72 | +0.55 | +0.56 | +0.59 | +0.68 |
| A | saw, 72 | +0.49 | −0.07 | −1.38 | −3.27 |
| C | saw, 72 | +0.42 | −0.68 | −3.30 | −6.99 |
| B 2× | saw, 72 | +0.24 | +0.24 | +0.25 | +0.26 |
| B 4× | saw, 72 | +0.08 | +0.08 | +0.08 | +0.07 |
| AB2 | saw, 72 | +0.23 | +0.09 | −0.23 | −0.71 |
| A | square, 84 | −0.26 | −0.55 | −1.73 | −4.86 |
| C | square, 84 | −0.45 | −1.01 | −3.40 | −9.61 |

`checks.mjs` prints the other waves and notes. They follow the same
pattern.

- **The offset in the first band** is the tables': a mip with few
  harmonics peaks lower, so it normalises louder. A and C read `g` off the
  same table and keep it.
- **The droop is the polyBLEP's own response.** A spreads each edge over
  two samples and C over four, and that is a lowpass on the edges. Relative
  to its own first band, A loses 3.3 to 4.6 dB at 15–20 kHz and C 6.6
  to 9.2 dB.
  AB2 runs A's two points at 96 kHz, which moves the droop past 20 kHz.

### B's decimation: latency and level

- **The delay.** 16 samples (0.333 ms) at 2× and 19 (0.396 ms) at 4×, from
  the linear-phase FIRs above. A build applies it to the synced voice only,
  so a synced voice runs 0.3 to 0.4 ms behind an unsynced one in the same
  part. That is below anything audible as latency.
- **The level from the decimator.** The passband is −0.25 to 0.00 dB to
  20 kHz.
- **The level from the tables.** Tables built at 96 kHz normalise up to
  0.66 dB louder than 48 kHz's at MIDI 36 (ratio 1). At 192 kHz the gap is
  0.05 dB. At ratio 3.7 it is 0.3 dB or less at either rate. A build would
  normalise the oversampled tables to the 48 kHz tables' fundamental.

## The cases A leaves on today's path (decision 5)

Measured, not fixed. A and C send these to today's path, so their figures
are shipped's: `stationary.mjs` printed A and C identical to shipped on
every case. Stationary is at ratio 3.7. The sweep is `lead-sync-sweep`
changed to match:

- the phase-modulation cases: Series + Tap, so its body sine at ratio 1
  becomes the modulator, at Level 0.5 or 1;
- the feedback case: feedback 0.5;
- the width case: width 0.25;
- the Tone case: Tone 0.3.

| Case | Note | Stationary: shipped = A = C | B 2× | B 4× | 16× | Sweep + D: shipped = A = C | B 2× + D | B 4× + D | 16× |
|---|---|---|---|---|---|---|---|---|---|
| PM, Level 0.5 | 72 | −15.7 | −22.4 | −28.6 | −41.5 | −19.2 | −26.9 | −35.3 | −44.8 |
| PM, Level 1 | 72 | −7.5 | −14.3 | −20.3 | −32.7 | −16.8 | −24.2 | −31.9 | −42.2 |
| feedback 0.5 | 72 | −20.3 | −20.8 | −15.9 | −24.2 | −25.7 | −29.7 | −26.4 | −29.0 |
| width 0.25 | 72 | −22.8 | −29.3 | −34.8 | −47.3 | −26.2 | −33.8 | −40.6 | −48.5 |
| Tone 0.3 | 72 | −35.2 | −40.8 | −46.4 | −58.0 | −33.1 | −40.1 | −47.5 | −54.2 |
| PM, Level 0.5 | 84 | −11.8 | −18.9 | −25.4 | −38.0 | −15.8 | −23.5 | −30.2 | −42.2 |
| PM, Level 1 | 84 | −2.3 | −8.6 | −14.5 | −27.0 | −13.6 | −20.3 | −26.8 | −38.6 |
| feedback 0.5 | 84 | −20.0 | −23.7 | −23.7 | −22.5 | −25.5 | −30.2 | −32.6 | −27.8 |
| width 0.25 | 84 | −19.3 | −27.5 | −31.7 | −43.6 | −21.9 | −30.5 | −36.9 | −48.6 |
| Tone 0.3 | 84 | −24.8 | −38.7 | −43.8 | −54.6 | −29.1 | −36.4 | −42.6 | −54.3 |

The sweep columns are framed medians.

- **A phase-modulated synced Saw aliases from the modulation, not the
  sync.** The same Saw unsynced at ratio 4, where it stays periodic at the
  note, gives the same figures (shipped −14.9 and −6.8 dB at MIDI 72 for
  Level 0.5 and 1, −10.7 and −0.4 at 84; `stationary.mjs --ratio 4 --sync
  off`). Phase modulation drives a band-limited table past its band limit,
  and even 16× leaves it at −27 to −45 dB. That is the FM engine's own
  behaviour on any modulated Saw. No sync correction removes it.
- **Feedback has no reference.** The one-sample feedback loop behaves
  differently at another sample rate, so the 16× render is a different
  sound, not a cleaner one. B moves it both ways (−15.9 to −36.0 dB). Under
  B a fed synced operator would change its sound.
- **Width 0.25 and Tone 0.3** fall back to today's −19 to −35 dB. B 4×
  recovers 11 to 19 dB of it.

So under A or C, a modulated sync sweep sounds as it does today. A sweep
that phase-modulates its synced Saw is dominated by the modulation's own
alias whatever is built.

## CPU (decision 6)

`lead-sync-sweep` with every envelope at its peak, one held note at MIDI
60: ns per 48 kHz output sample of the one voice, the median and
interquartile range over 30 rounds of 5 s after two warm-ups, the variants
interleaved and rotated (`bench.mjs`). B's figures include its streaming
polyphase decimator. Two runs, the second under heavier load.

| Variant | Run 1 | Run 2 | × shipped (run 1, run 2) |
|---|---|---|---|
| unsynced (the kernel) | 19.8 (18.6–21.6) | 18.6 (18.2–20.2) | 0.37, 0.32 |
| shipped | 52.9 (51.4–57.1) | 57.4 (56.9–60.2) | 1, 1 |
| shipped + D | 62.5 (61.8–64.6) | 60.9 (60.7–61.7) | 1.18, 1.06 |
| A | 70.2 (68.5–74.1) | 69.1 (68.5–70.0) | 1.33, 1.20 |
| A + D | 81.3 (80.5–83.2) | 79.7 (79.2–80.2) | 1.54, 1.39 |
| C | 75.0 (73.7–76.5) | 74.3 (73.5–76.9) | 1.42, 1.29 |
| **C + D** | **83.8 (83.5–88.3)** | **83.4 (83.1–84.9)** | **1.58, 1.45** |
| B 2× | 155.5 (152.9–168.5) | 152.7 (151.1–162.5) | 2.94, 2.66 |
| B 2× + D | 162.5 (161.3–169.4) | 172.9 (171.8–176.0) | 3.07, 3.01 |
| B 4× | 315.8 (302.1–320.6) | 314.2 (312.5–321.1) | 5.97, 5.47 |
| B 4× + D | 322.7 (297.3–330.2) | 296.3 (295.4–307.3) | 6.10, 5.16 |
| AB2 + D | 200.1 (198.5–206.9) | 199.2 (198.0–206.0) | 3.78, 3.47 |

- **D** costs 4 to 11 ns at 48 kHz: four control updates a quantum instead of one,
  only on a voice whose ratio is modulated.
- **A's and C's direct shape** costs 12 to 22 ns over shipped. That is the
  edge search after every sample, written here as a plain loop. A build
  could tighten it, but that is not measured.
- **B** costs its rate in loop work plus its decimator: about 3× shipped at
  2× and 5 to 6× at 4×. B 4× and B 4× + D swap order between runs, which
  is within this machine's noise under load.

## Recommendation

**Build C + D.** These are the reasons.

- **The alias.** It is the only candidate in the issue's list that reaches
  the target's neighbourhood: −49.5 dB at MIDI 72 and −46.1 at 84 on the
  framed metric. In the stationary table it reaches −45.5 to −54.1 dB for
  every wave at MIDI 60 to 84. B 4× + D, the only other candidate past
  −45 dB, does so at MIDI 72 only (−46.7, −42.0 at 84), for 3.5 to 3.9
  times C + D's CPU.
- **The CPU.** 83 ns per voice against shipped's 53 to 57, or 1.45 to 1.58
  times, on a voice that already leaves the kernel.
- **D ships with it.** Without D, C stops at −44.2 and −42.3 dB on the
  stepping floor.
- **The waveform.** It matches the table path's harmonics, polarity and
  Pulse mean (decision 4).

**What C + D costs in sound.**

- **Top end.** At 15–20 kHz its harmonics sit 6 to 10 dB under the
  reference's, and at 10–15 kHz 2 to 5 dB. That is the four-point
  kernel's own lowpass.
- **Peak.** The direct shape's peak is 15 % lower than the table's at the
  same harmonic levels, so a drive after it bites a little less.

Whether the top-end loss is heard is tacowars's call: compare
`sync-sweep-C-plus-D.wav` with `sync-sweep-ref16.wav`.

**The patches it leaves aliasing.** These keep today's figures:

- a synced Saw, Square or Pulse with any modulator in its algorithm, a
  silent one included as the bind stands;
- one with feedback;
- a squeezed Saw or Square, or any of the three with an LFO on its width;
- any of the three in a patch whose Tone is under 1;
- a synced User wave, which keeps the shipped correction.

Both factory sync patches, `lead-sync-sweep` and `lead-sync-detune`, are on
Additive with no feedback, at width 1 and Tone 1, so both would take C.

**If the top-end loss is heard: AB2 + D.** It runs A's direct shape inside
a 2× voice. It is at the reference (−54.7 and −53.9 dB), within 1.3 dB of
the reference's top end, and its waveform passes the same checks, with
B's table-level offset. It costs 199 to 200 ns, 2.4 times C + D, and needs
B's machinery: the oversampled tables and the decimator. It leaves the same
patches off the direct shape, but B's half of it gives them about 7 dB (B 2×
in decision 5's table), except a fed operator, whose sound it changes.

**Not recommended.**

- **A** alone or with D: 4 to 5 dB.
- **B 2×**: 6 to 7 dB at three times the CPU.
- **B 4× + D**: dominated by C + D on alias at MIDI 84 and on CPU, and by
  AB2 + D on both.

## Listening

`listen.mjs` writes `lead-sync-sweep` through each candidate's best variant
to `~/Desktop/sync-study/`, never into git. Each is 48 kHz, 16-bit mono,
the left channel at the same gain (12 dB over the voice's level), and plays
MIDI 60, 72 and 84 in turn, each held 8 s and released.

| File | Variant |
|---|---|
| `sync-sweep-shipped.wav` | as shipped |
| `sync-sweep-shipped-plus-D.wav` | D alone |
| `sync-sweep-A-plus-D.wav` | A + D |
| `sync-sweep-C-plus-D.wav` | C + D, recommended |
| `sync-sweep-B2-plus-D.wav` | B 2× + D |
| `sync-sweep-B4-plus-D.wav` | B 4× + D |
| `sync-sweep-AB2-plus-D.wav` | AB2 + D, the alternative |
| `sync-sweep-ref16.wav` | the 16× reference |

## What the figures do not show

- **One patch, one machine, Node.** The framed metric is one factory patch
  at two notes. CPU is Node on an M1 under shared load, not Chrome's audio
  thread.
- **The masks.** The ±6-bin masks are the diagnostic renders', and the
  stationary metric's limits in the hard-sync note's "What the metric shows"
  still hold. The waveform checks above cover what they miss.
- **The in-memory edits are not a build.**
  - A's and C's edge search runs every sample as a loop.
  - D reads only the LFOs.
  - B runs the whole voice at the higher rate.
  - The build ticket would write each one into the engine with its own
    tests and goldens.

## Commands

From the repo root with Node 24. No Python is used.

```bash
node docs/research/2026-10-09-sync-antialias-study/response.mjs     # the decimators' taps, stopband, passband, delay
node docs/research/2026-10-09-sync-antialias-study/framed.mjs       # framed table
node docs/research/2026-10-09-sync-antialias-study/stationary.mjs --check-d   # stationary table, D bit-identical
node docs/research/2026-10-09-sync-antialias-study/checks.mjs       # decision 4
node docs/research/2026-10-09-sync-antialias-study/stationary.mjs --cases pm05,pm1,fb,w025,tone03 --notes 72,84 --variants shipped,A,C,B2,B4,ref16
for p in pm05 pm1 fb w025 tone03; do
  node docs/research/2026-10-09-sync-antialias-study/framed.mjs --patch $p --variants shipped+D,A+D,B2+D,B4+D,ref16
done
node docs/research/2026-10-09-sync-antialias-study/stationary.mjs --cases pm05,pm1,fb --ratio 4 --sync off --notes 72,84 --variants shipped,B2,B4,ref16
node docs/research/2026-10-09-sync-antialias-study/bench.mjs        # CPU, about 15 s
node docs/research/2026-10-09-sync-antialias-study/listen.mjs       # WAVs to ~/Desktop/sync-study/
```

| File | What it holds |
|---|---|
| `candidates.mjs` | D, the interval scaling for B, and the edit helper |
| `directBundle.mjs` | A and C as edits to the bundle's text |
| `decimators.mjs` | B's and the reference's FIRs, offline and streaming |
| `render.mjs` | each variant's processor, rendered to aligned 48 kHz |
| `spectrum.mjs` | the two metrics |
| `fallbackPatches.mjs` | decision 5's cases |
