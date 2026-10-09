# The synced Saw, Square and Pulse's direct shape, as built (windsor#655)

windsor#655 builds candidate A + D of the anti-aliasing study
(`docs/research/2026-10-09-sync-antialias-study/`, windsor#652): a synced
Saw, Square or Pulse that nothing modulates computes its wave directly,
with a two-point polyBLEP at every edge, and a synced voice whose ratio
is modulated keeps the fine control interval. The decisions are in
`docs/log/2026-10-09-sync-direct-shape.md`. This note measures the build
against the study's figures for A + D (decision 8). The 2× synced voice
that takes it to the reference is windsor#656.

**The build lands on the study's row.** On `lead-sync-sweep` the framed
median goes from −32.0 to −36.8 dB at MIDI 72 and from −28.4 to −33.1 dB
at MIDI 84. That is the study's A + D row (−36.8 and −33.1) to the tenth of
a dB. One voice costs 1.43 to 1.46 times shipped's CPU, and the patch
with its sync off costs what shipped's does.

## Machine and method

| | |
|---|---|
| Machine | Apple M1, 8 cores, macOS 26.7.1 |
| Runtime | Node 24.21.0 (V8). No browser: the bundle is evaluated under Node through the study's `render.mjs`, as the study did |
| Backend | `packages/engine/src/worklet/generated/fm-processor.js` built on this branch, against the same file at `origin/main` 9ea3051 (after windsor#650's per-octave tables). A stand-in `AudioWorkletProcessor`, 128-frame quanta, seed 1. No Web Audio |
| Load | other sessions shared the machine: load average 2.7 to 4.0 through the runs |

These are dev-machine readings. The CPU figures show relative cost on one
machine and say nothing about audio-thread headroom in Chrome.

The study's scripts are imported unchanged. `build.mjs` and
`interleaved.mjs` set three bundles side by side:

- **shipped**: the bundle at 9ea3051, read with `git show`;
- **study A + D**: the study's own in-memory edits of that bundle
  (`candidates.mjs`, `direct(text, 2)` and `fineRatio`);
- **built**: this branch's bundle.

The two direct shapes send their wave a sample late, which `render.mjs`
takes out, so every render is aligned with shipped's.

## Framed alias, `lead-sync-sweep`

The study's framed metric (`spectrum.mjs`'s `framed`): one held note at
MIDI 72 and one at 84, 8 s each, left channel, 8 192-sample frames from
0.5 s, dB under the signal.

| Variant | MIDI 72 median | MIDI 72 p90 | MIDI 84 median | MIDI 84 p90 |
|---|---|---|---|---|
| shipped (9ea3051) | −32.0 | −27.0 | −28.4 | −23.8 |
| study A + D | −36.8 | −33.6 | −33.1 | −29.2 |
| **built** | **−36.8** | −33.6 | **−33.1** | −29.2 |

- **Within 1 dB of the study's A + D row.** It is the same row to the tenth,
  so windsor#650's longer tables did not move it. `lead-sync-sweep`'s synced
  Saw runs at 0.65 to 5.2 kHz at these notes, where every mip table is still
  2 048 long.
- **Shipped reads the study's figures** too (−32.0 and −28.4).
- **The p90** sits near the study's, at the sweep's own movement inside a
  frame, as the study explains.

## Against the table path at a low note

MIDI 36, the study's synced carrier (`fallbackPatches.mjs`'s
`syncedCarrier`) at ratio 1 and 3.7, Pulse at width 0.3. The peak and the
mean, and the worst level and phase gap of the first ten harmonics against
shipped's, from 0.1 s over 0.5 s (the study's `checks.mjs` functions).

| Variant | Wave | Ratio | Peak (variant / shipped) | Mean (variant / shipped) | Level gap dB | Phase gap ° |
|---|---|---|---|---|---|---|
| study A + D | saw | 1 | 0.060 / 0.283 | −0.0001 / −0.0005 | 12.05 | 0.0 |
| **built** | saw | 1 | 0.240 / 0.283 | −0.0005 / −0.0005 | 0.01 | 0.0 |
| study A + D | square | 1 | 0.000 / 0.283 | −0.0000 / −0.0016 | 131.83 | 0.0 |
| **built** | square | 1 | 0.240 / 0.283 | −0.0016 / −0.0016 | 0.00 | 0.0 |
| study A + D | pulse | 1 | 0.084 / 0.380 | −0.0003 / −0.0013 | 12.05 | 0.0 |
| **built** | pulse | 1 | 0.337 / 0.380 | −0.0013 / −0.0013 | 0.00 | 0.0 |
| study A + D | saw | 3.7 | 0.240 / 0.283 | 0.0140 / 0.0140 | 0.11 | 1.0 |
| **built** | saw | 3.7 | 0.240 / 0.283 | 0.0140 / 0.0140 | 0.11 | 1.0 |
| study A + D | square | 3.7 | 0.240 / 0.283 | 0.0198 / 0.0198 | 0.03 | 0.4 |
| **built** | square | 3.7 | 0.240 / 0.283 | 0.0198 / 0.0198 | 0.03 | 0.4 |
| study A + D | pulse | 3.7 | 0.339 / 0.381 | 0.0280 / 0.0279 | 0.35 | 0.0 |
| **built** | pulse | 3.7 | 0.339 / 0.381 | 0.0280 / 0.0279 | 0.35 | 0.0 |

- **The built shape matches the table path's harmonics, polarity and
  Pulse mean**, at 0.01 dB or less at ratio 1 and at the study's own gaps at
  3.7. Its peak is the study's: 15 % under the table's, by design (record,
  decision 2).
- **The study's edit fails at ratio 1 on today's tables.** At MIDI 36,
  ratio 1, the operator reads a mip of 8 192 samples (windsor#650), and the
  study's level `g` summed the first 2 048 of them as if the table were
  2 048 long. The Saw and Pulse came out 12 dB low and the Square
  silent. The build reads `g` at the table's own stride (the issue's
  decision 9), which is why its gap is 0.01 dB. At ratio 3.7 the mip is
  2 048 long and the two agree.

## CPU

`interleaved.mjs`: the study's `bench.mjs` method with the three bundles in
one run. `lead-sync-sweep` with every envelope at its peak, one held note
at MIDI 60, ns per 48 kHz sample of the one voice, the median and
interquartile range over 30 rounds of 5 s after two warm-ups, the runs
interleaved and rotated. `unsynced` is the patch with its sync off, which
takes the kernel.

The bundle as it stands, D limited to synced voices and the Pulse's moving
duty edge (the PR's second round), two runs, load average 2.7 to 3.8:

| Run | Run 1 | Run 2 | × shipped (run 1, run 2) |
|---|---|---|---|
| shipped, unsynced | 23.5 (22.3–24.3) | 23.4 (22.6–24.2) | 0.31, 0.32 |
| built, unsynced | 23.5 (22.4–24.0) | 22.8 (22.1–23.5) | 0.31, 0.31 |
| shipped | 74.9 (73.0–75.9) | 72.5 (70.8–74.6) | 1, 1 |
| shipped + D | 80.5 (78.4–83.1) | 77.7 (76.0–79.6) | 1.07, 1.07 |
| study A + D | 102.4 (100.3–104.9) | 102.1 (100.0–104.0) | 1.37, 1.41 |
| **built** | **109.3 (106.6–111.5)** | **105.0 (104.1–108.7)** | **1.46, 1.45** |

The first round's bundle, which applied D to every voice, two runs:

| Run | Run 1 | Run 2 | × shipped (run 1, run 2) |
|---|---|---|---|
| shipped, unsynced | 18.8 (18.2–20.8) | 18.2 (18.0–18.6) | 0.32, 0.32 |
| built, unsynced | 29.2 (28.3–32.7) | 28.6 (28.2–29.2) | 0.50, 0.49 |
| shipped | 58.8 (57.8–62.9) | 57.8 (57.2–59.9) | 1, 1 |
| shipped + D | 62.8 (61.5–65.0) | 61.2 (60.9–62.2) | 1.07, 1.06 |
| study A + D | 80.0 (79.5–82.9) | 79.6 (79.3–80.6) | 1.36, 1.38 |
| built | 84.1 (83.3–90.6) | 82.9 (82.4–83.3) | 1.43, 1.43 |

Every row reads about 25 % slower in the second round's runs, shipped's
included, under the machine's shared load; the ratios to shipped are the
figures to compare.

- **The synced voice** costs 1.43 to 1.46 times shipped's, 3 to 7 ns over
  the study's in-memory A + D. The build calls the edge search once a
  sample, where the study wrote it into the loop. The `lead-sync-sweep`
  Saw takes no duty edge, so the Pulse's ramp search does not reach it.
- **D on an unsynced voice.** D applies to a voice with a synced operator
  only (record, decision 4). The patch with its sync off still has its LFO
  on the Saw's ratio, at 0.25 Hz, and now costs what shipped's does (23.5
  and 22.8 ns against 23.5 and 23.4). The first round, which kept that
  voice at the fine interval too, cost it about 10 ns a sample (18 to 29).
  On the synced voice D costs 3 to 6 ns.
- **The study's `bench.mjs`**, run once on each bundle in the first round
  (it reads one checkout per run), agrees with that round: at 9ea3051
  unsynced 18.1 and 18.5, shipped 58.5 and 59.8, shipped + D 61.7 and
  62.1, A + D 80.7 and 80.5; on the first round's bundle unsynced 28.4 and
  28.5, and the synced voice 83.1 twice.

## What the figures do not show

- **One patch, one machine, Node.** As the study: the framed metric is one
  factory patch at two notes, and the CPU is Node on an M1 under shared
  load, not Chrome's audio thread.
- **The switch between the shape and the table.** It is tested, not
  measured here: `synth/fmProcessorSyncShape.test.ts` toggles a feedback
  lane on a synced Saw, switching on a reset, and every sample of the
  switched render is within 1e-5 of one of the two paths' own samples.

## Commands

From the repo root with Node 24, after `node scripts/build-worklets.mjs`.

```bash
node docs/research/2026-10-09-sync-antialias-build/build.mjs          # framed and the table-path check, about 1 min
node docs/research/2026-10-09-sync-antialias-build/interleaved.mjs    # CPU, about 2 min
```

`--base <rev>` names the shipped bundle (9ea3051 by default).

| File | What it holds |
|---|---|
| `build.mjs` | the three bundles; the framed metric and the check against the table path |
| `interleaved.mjs` | the CPU, the three bundles in one run |
