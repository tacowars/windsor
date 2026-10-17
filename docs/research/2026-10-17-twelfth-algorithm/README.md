# What algorithm 11, Stack + One, costs the FM worklet

windsor#895 adds a twelfth algorithm, Stack + One (`D>C>B | A`). Its
acceptance asks for a drum-heavy and a pad-heavy program rendered on it
against algorithm 6, Stack + Two (`D>C | B | A`), which also sounds all
four operators, with the machine and browser named. This note measures
that.

**On drums the two cost the same. On pads, Stack + One costs 16 % more
than Stack + Two, the same as the other algorithms with a three-deep chain.**
Drums: 23.3 against 23.5 ms per second of audio (eight parts). Pads: 143.4
against 123.3 ms (eight parts holding four-note chords). Algorithms 9 and 1,
also three operators deep, read 146.6 and 149.1 on pads, and Series
(four deep) 165.3. The cost follows the depth of the modulation chain and not
the algorithm's index. Algorithm 11 takes the same kernel path and the same
per-edge code as every other algorithm. The routing is the sound, so there
is no cheaper design that sounds the same.

Measured on an Apple M4 Pro Mac mini (Mac16,11, 64 GB, macOS 26.5.1), in
HeadlessChrome 155 (the project's chrome-devtools MCP), on an
`OfflineAudioContext` at 48 kHz running the real FM worklet. A background
research job was running on the machine (load average about 9 on 14 cores),
so the absolute numbers are this session's. All cases ran interleaved, so
the load fell on each of them alike, and the ratios are the result.

## Method

`bench.mjs` runs in a page of the app's dev server (`npm run dev -w
packages/app`), imported from its `/@fs/` path so Vite compiles the
engine's TypeScript. Each run builds eight real `AudioPart`s with
`FmEngine` on a fresh `OfflineAudioContext`. Each part holds its whole
program as construction events, as `render/renderSong.ts` hands in a song's
opening, and the bench times `startRendering()` for 16 s of audio. An
offline render runs the audio thread flat out, so its wall time is the
worklets' cost. Each case's patches are library patches with `algorithm`
set to the case's, so two cases differ in routing alone.

- `drums`: 130 BPM. `tr909-kick` and `tr808-kick` on the beat,
  `tr909-snare` and `tr909-clap` on 2 and 4, `tr909-hat-closed`,
  `tr808-hat-closed` and `efm-snare` on every 16th, and `tr909-hat-open`
  on the off-beats. Each note is a 16th long.
- `pads`: eight `pad-drift` parts, each holding a four-note chord that
  changes every two bars (half an octave up on odd slots).

`runAll(rounds, warmUp, algorithms, sines)` runs the warm-up rounds, then
the timed rounds, with every program on every algorithm interleaved. With
`sines` set, every operator plays a Sine, which separates the routing's
cost from the waves it modulates. The table reports milliseconds of render
per second of audio, as the median of the runs; at 1000 ms the render
takes as long as the audio it renders.

## Results

### Algorithm 11 against 6, with references (7 rounds after 2 warm-up)

The library patches' own waves (`runAll(7, 2, [6, 11, 4, 8])`):

| Program | Alg | Routing | Runs (ms per audio s) | Median |
|---|---|---|---|---|
| drums | 6 | `D>C \| B \| A` | 23.31, 23.56, 23.52, 23.13, 23.65, 23.15, 23.53 | 23.52 |
| drums | 11 | `D>C>B \| A` | 23.40, 23.19, 23.38, 23.44, 23.17, 23.18, 23.32 | 23.32 |
| drums | 4 | `D>C \| B>A` | 23.73, 23.31, 23.32, 23.24, 23.34, 23.10, 23.46 | 23.32 |
| drums | 8 | `D>C>B>A +B` | 23.56, 23.66, 23.85, 24.14, 23.74, 24.31, 24.52 | 23.85 |
| pads | 6 | `D>C \| B \| A` | 124.41, 122.57, 123.34, 124.44, 123.33, 129.98, 122.88 | 123.34 |
| pads | 11 | `D>C>B \| A` | 143.37, 142.31, 142.67, 143.58, 143.52, 141.96, 143.65 | 143.37 |
| pads | 4 | `D>C \| B>A` | 131.11, 130.50, 131.27, 131.50, 131.64, 130.91, 130.76 | 131.11 |
| pads | 8 | `D>C>B>A +B` | 165.75, 165.48, 166.09, 165.93, 166.61, 166.61, 166.01 | 166.01 |

Every operator a Sine (`runAll(7, 2, [6, 11, 4, 8], true)`):

| Program | 6 | 11 | 4 | 8 |
|---|---|---|---|---|
| drums | 22.81 | 22.70 | 22.81 | 23.25 |
| pads | 118.91 | 136.03 | 125.32 | 157.67 |

### By the depth of the chain (5 rounds after 1 warm-up)

`runAll(5, 1, [6, 11, 9, 1, 0])`, the library patches' own waves:

| Alg | Routing | Deepest chain | drums | pads |
|---|---|---|---|---|
| 6 | `D>C \| B \| A` | 2 | 23.32 | 123.96 |
| 11 | `D>C>B \| A` | 3 | 23.53 | 143.89 |
| 9 | `D>C>(B,A)` | 3 | 23.73 | 146.55 |
| 1 | `(D,C)>B>A` | 3 | 23.54 | 149.12 |
| 0 | `D>C>B>A` | 4 | 23.78 | 165.32 |

The runs: pads 6 122.81, 123.11, 124.18, 123.96, 124.28; pads 11 143.59,
142.59, 143.89, 144.51, 144.07; pads 9 146.21, 146.55, 147.59, 147.18,
145.86; pads 1 148.88, 148.59, 149.12, 150.43, 149.17; pads 0 164.51,
176.60, 165.32, 164.73, 165.61; drums 6 23.32, 23.14, 23.14, 23.36, 23.41;
drums 11 23.61, 23.29, 23.53, 23.39, 23.93; drums 9 23.73, 23.32, 24.16,
23.66, 24.09; drums 1 23.45, 23.54, 23.54, 23.50, 24.02; drums 0 23.78,
23.60, 23.61, 23.91, 23.98.

## Reading

- **Drums don't move.** Short notes with dormancy (#547) spend most of
  their time outside the operator loop, so the routing is within the runs'
  spread: 11 reads 0.2 ms per audio second under 6 in one set and 0.2
  over in the other.
- **On pads, cost rises with the chain's depth.** Two edges in two
  independent pairs (algorithm 4) cost 6 % over Stack + Two. The same two
  edges in one chain (algorithm 11) cost 16 % over it. Three-deep
  algorithms 9 and 1 cost 18–20 %, and four-deep Series 33 %. The edge's
  own arithmetic is one multiply-add. The likely cause, not measured
  here, is that each operator in a chain waits within the sample for the
  one before it, so a deeper chain leaves the processor less work to
  overlap.
- **It isn't the waves.** With every operator a Sine, the order and the
  gaps are the same (6 < 4 < 11 < 8; 11 at 14 % over 6), so modulating
  `pad-drift`'s wave-3 operator B is not what costs.
- **Algorithm 11 adds no code to the kernel.** Its edges (`EDGE_CB`,
  `EDGE_DC`) and carrier bits are flags that the fixed-index kernel already
  reads, and the generated bundle's diff is the table row alone. The
  golden (`fmProcessorGolden`) is unchanged, so algorithms 0–10 render as
  they did.
