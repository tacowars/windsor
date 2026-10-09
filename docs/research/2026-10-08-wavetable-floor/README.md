# The table oscillator's noise floor, and wavetables sized to their harmonics

The voice drive study (`../2026-10-08-voice-drive-aliasing/`) found that a
plain band-limited Saw, with no drive and no filter, read an inharmonic floor
of −36 dB A-weighted against the note at C1, where an exactly summed saw
reads −91 dB. tacowars asked for it to be followed up and fixed. This note
finds the cause, measures the fixes, and records the one shipped (record
`2026-10-09-wavetables-sized-to-their-harmonics`).

**In short.** Linear interpolation between a 2048-sample table's samples
leaves images of its harmonics, which fold back below Nyquist. The more
harmonics a table holds for its length, the louder they are, and the
lowest octave's saw holds 733. Sizing each octave's table to at least 22
times its highest harmonic (2048 to 16384 samples) takes the worst note of
every octave to −72.5 dB, for Saw, Square and Pulse. The harmonic levels
come within 0.06 dB of exact. Building the long tables by an inverse FFT
makes a wave set cheaper to build than before. The voice loop's measured
cost did not change.

## Machine and method

| | |
|---|---|
| Machine | cloud container, Intel Xeon @ 2.80 GHz, 4 vCPU, Linux 6.18 |
| Runtime | the floor and build readings on Node v22.22.0; the voice-loop cost and every golden on Node v24.21.0 (`npx node@24`, `.nvmrc`'s); `npx tsx` 4.20.3 |
| Browser | none: no reading here is from Chrome |

The meter is the drive study's `spectrum.mts`: a 65 536-point
Blackman–Harris spectrum of a held tone of known fundamental. The figure is
the non-harmonic power against the harmonic power, 20 Hz – 20 kHz, both
A-weighted. The meter's own floor is about −88 to −91 dB.

- **`tables.mts`** builds the tables as `waveTables.ts` did, at any size.
  It is checked against the shipped `getMips`, bit-identical for saw,
  square and triangle at 2048. It also reads them as the voice loop does.
  Against the worklet harness its floor agrees with the engine's to within
  0.7 dB at C1–C4.
- **`floor.mts`** reads every semitone C0–C8 for saw, square and triangle,
  for each candidate. `--notes` prints every note.
- **`engineFloor.mts`** reads the shipped bundle through the harness, at
  every semitone, in any checkout: the before and after below.
- **`buildTime.mts`** times a wave set's build.
- **`voiceCost.mts`** with `voicePairs.mjs` times the voice loop in two
  checkouts, interleaved.

## The cause

A table read with linear interpolation is, as a function of phase, the
piecewise-linear interpolant of the table. That interpolant is periodic,
and besides the table's harmonics h it holds images near N − h, N + h, 2N − h
and so on, at a level that grows as (h/N)². Played at f, the images sit at
multiples of f far above Nyquist, and sampling folds them back to
frequencies that are not multiples of f: a hash under the note.

The images are loudest where a table holds the most harmonics for its
length. In the old tables that was the lowest octaves: 733 harmonics in
2048 samples in octave 0, 367 in octave 1. They are loudest at the top of
each octave (the C notes): there the table's harmonics reach Nyquist, and
its images fold furthest down. `MIP_BASE_HZ` (16.352) sits a hair above C0,
so each C is the last note of its octave's table.

The exactly summed saw at the same notes reads −91 dB, so the table's
contents are right. The read is what makes the floor.

## The candidates

Worst A-weighted floor in each octave (dB), saw, from `floor.mts`:

| Octave | linear 2048 (shipped) | linear 4096 | linear 8192 | linear 16384 | cubic 2048 | cubic 4096 | sized 11× (to 8192) | **sized 22× (to 16384)** |
|---|---|---|---|---|---|---|---|---|
| 0 | −35.2 | −48.2 | −58.8 | −73.0 | −38.8 | −57.9 | −58.8 | **−73.0** |
| 1 | −37.1 | −54.4 | −63.3 | −78.4 | −38.9 | −65.8 | −59.9 | **−72.8** |
| 2 | −54.1 | −62.4 | −77.4 | −85.8 | −65.8 | −78.5 | −60.0 | **−72.6** |
| 3 | −62.4 | −77.2 | −85.5 | −90.2 | −78.5 | −90.5 | −62.4 | **−72.7** |
| 4 | −77.1 | −85.3 | −89.9 | −90.0 | −90.0 | −90.0 | −77.1 | **−77.1** |
| 5 | −84.9 | −89.3 | −89.4 | −89.4 | −89.4 | −89.4 | −84.9 | **−84.9** |
| 6–7 | −88.6 | −88.6 | −88.6 | −88.6 | −88.6 | −88.6 | −88.6 | **−88.6** |
| Top harmonics' worst level error | 3.92 | 0.93 | 0.23 | 0.06 | 2.05 | 0.16 | 0.23 | **0.06** |

The square reads within 2 dB of the saw in every cell. The triangle's
harmonics fall as 1/h², so its floor was lower to begin with: −66.9 dB at
worst, and −77.7 dB sized.

- **A cubic read** is the wrong lever. At 2048 it fixes the middle octaves
  but leaves the lowest at −39 dB, and it adds two reads and about ten
  operations per operator-sample to every one of the kernel's sixteen table
  reads.
- **A longer table** fixes the floor with no change to the read. One fixed
  size of 16384 for every octave costs 786 KB per wave set (its build time
  was not measured).
- **Sized tables** give the long table only to the octaves that need it: a
  saw gets 16384, 8192 and 4096 samples for octaves 0–2 and 2048 above,
  184 KB a set. At 22× each table's worst image is the same size relative
  to its harmonics, so every octave reads about −73 dB. 11× (to 8192)
  reads about −60 dB.

Sizing by the highest non-zero harmonic, rather than by the octave's
harmonic limit, keeps a sine (one harmonic) and a sparse User wave at 2048.
The first version sized by the limit and gave the sine a 16384 table; the
test of the sine's tables caught it.

## Building the long tables

The worklet builds a wave set when a patch arrives with a wave or a tone
not yet in the cache, on the audio thread, inside one 2.67 ms quantum.
`buildTime.mts`, median of 15:

| Build | saw, tone 1 | square, tone 1 | saw, tone 0.5 | Memory (saw, tone 1) |
|---|---|---|---|---|
| shipped: 2048, summed | 6.0 ms | 3.8 ms | 3.0 ms | 96 KB |
| sized 22×, summed | 33.7 ms | 28.6 ms | 12.8 ms | 184 KB |
| **sized 22×, long tables by inverse FFT** | **3.0 ms** | **2.7 ms** | **2.6 ms** | 184 KB |

The old build already took longer than a quantum for a saw. The FFT build
takes half as long, even with the longer tables. The FFT and the summation
differ by at most 2.2·10⁻⁶ per sample (the summation accumulates in
Float32), and the 2048 tables, still summed, are bit-identical to the
shipped ones.

## The shipped change, measured on the bundle

`engineFloor.mts`, worst A-weighted floor in each octave (dB), the note it
falls on, and every semitone C0–B7 read:

| Wave | Build | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|---|
| saw | `main` | A#0 −35.0 | C1 −36.4 | C2 −54.0 | C3 −62.6 | C4 −77.3 | C5 −84.8 | F#6 −89.4 | B7 −88.6 |
| saw | sized | C#0 −72.8 | C#1 −72.5 | C#2 −72.6 | C#3 −72.7 | C4 −77.3 | C5 −84.8 | F#6 −89.4 | B7 −88.6 |
| square | `main` | A#0 −36.9 | C1 −36.8 | C2 −54.0 | C3 −62.5 | C4 −77.7 | C5 −85.2 | F#6 −89.5 | F7 −87.9 |
| square | sized | C#0 −72.8 | C#1 −72.7 | C#2 −72.6 | C#3 −72.8 | C4 −77.7 | C5 −85.2 | F#6 −89.5 | F7 −87.9 |
| pulse 0.3 | `main` | A#0 −36.9 | C1 −36.4 | C2 −54.1 | C3 −62.5 | C4 −77.8 | C5 −85.6 | F#6 −89.2 | B7 −88.8 |
| pulse 0.3 | sized | C#0 −72.9 | C#1 −72.6 | C#2 −72.7 | C#3 −72.9 | C4 −77.8 | C5 −85.6 | F#6 −89.2 | B7 −88.8 |

From C4 up the tables are the old ones, to the bit.

**The voice loop's cost**, `voicePairs.mjs`: `main` and this branch
interleaved, one process each, on Node 24, the median of the rounds'
after/before ratios, 10 s of audio a run:

| Scenario | Rounds | Median ratio | Range |
|---|---|---|---|
| `bass`: a saw and a square held at C1, C2 and C3 (the 16384, 8192 and 4096 tables) | 12 | 0.998 | 0.76 – 1.09 |
| `bank`: the windsor#548 bench's four factory parts at C3, G3 and C4 | 12 | 1.021 | 0.95 – 1.10 |

The kernel reads each operator's table length once per render call, and
the generic loop reads it at each table read. An earlier version that
kept the sizes in a voice field read 1.004 and 1.033 on the same two
scenarios.

**Goldens.** 41 factory presets read a grown table and render differently.
Both `fmGolden.json` and `fmGoldenFineInterval.json` were refreshed on
Node 24. The kernel still matches the generic loop to the bit
(`fmProcessorKernel.test.ts`), and the allocation tests pass.

## Reproduce

From the repository root:

```
npx tsx docs/research/2026-10-08-wavetable-floor/floor.mts [--notes]
npx tsx docs/research/2026-10-08-wavetable-floor/buildTime.mts
npx tsx docs/research/2026-10-08-wavetable-floor/engineFloor.mts <checkout root>
node docs/research/2026-10-08-wavetable-floor/voicePairs.mjs <before root> <after root> <rounds> bass,bank
```
