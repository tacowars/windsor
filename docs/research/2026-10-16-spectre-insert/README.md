# What the Spectre insert costs

Spectre is a spectral delay (records `docs/log/2026-10-16-spectre-insert.md`
and `docs/log/2026-10-17-spectre-drawn-cells.md`). This note measures what the
shipped bundle, `packages/engine/src/worklet/generated/spectre-processor.js`,
costs in Chrome, on the Pump's pattern (`docs/research/2026-10-13-pump-insert/`):
instances on a fresh `OfflineAudioContext`, the render's wall time over the
program's length, against the 48 kHz quantum. It was first measured on the
breakpoint engine, and measured again with drawn cells (record
`2026-10-17-spectre-drawn-cells` decision 14).

**One Spectre at the defaults (Bleep Test) costs 0.027 ms a quantum, 1.0 % of
the 2.667 ms budget at 48 kHz, and four cost 0.105 ms (3.9 %).** The costliest
mode is the finest analysis (2048 bands, 4× overlap), at 1.5 % an instance and
6.0 % for four. Of the drawn-cell features, the scope is the only one that
reads above the defaults: 1.03 % an instance and 4.1 % for four. Steps on
every lane, a selection with all three Select moves, and Follow on Chord with
the chord changing every bar cost nothing measurable over the defaults, nor
does an LFO driving three slots plus a delay shift stepping every 16 quanta.
No mode reads above 3 % for one instance. The cost grows linearly with the
instance count.

| Mode | 1 instance | 4 instances |
|---|---|---|
| default (Bleep Test: 512 bands, 2×) | 0.0271 ms (1.01 %) | 0.1048 ms (3.93 %) |
| coarse (128 bands, 2×) | 0.0267 ms (1.00 %) | 0.1056 ms (3.96 %) |
| fine (2048 bands, 4×) | 0.0404 ms (1.52 %) | 0.1607 ms (6.03 %) |
| blur | 0.0299 ms (1.12 %) | 0.1152 ms (4.32 %) |
| moving (LFO on three slots, stepped delay shift) | 0.0261 ms (0.98 %) | 0.1039 ms (3.89 %) |
| cells-stepped (Steps on every lane) | 0.0263 ms (0.99 %) | 0.1041 ms (3.90 %) |
| select (half the cells, Select moves at 0.5) | 0.0266 ms (1.00 %) | 0.1051 ms (3.94 %) |
| follow-chord (as select, Follow on Chord) | 0.0266 ms (1.00 %) | 0.1057 ms (3.96 %) |
| scope (the workbench's scope on) | 0.0276 ms (1.03 %) | 0.1103 ms (4.14 %) |

Medians of three repeats; the harness alone (the source, no Spectre) read
0.0005 ms (0.02 %). Every repeat is in [`measurement.json`](measurement.json).
The spread within a cell was small: each one-instance median sits within
2 ms of its repeats' minimum on a render of about 200 ms, except the scope's
slowest repeat (222.5 ms against 206.9 ms).

The drawn-cell engine is cheaper than the breakpoint one even though the
earlier run's default never ran the delay or the feedback (Before cells,
below): 1.01 % against 1.44 % an instance at the defaults, and 1.52 % against
1.95 % at the finest analysis. Decision 14 expected this, since reading a band
is now one lookup and one interpolation where it walked segments.

The card at its defaults, from `npm run dev` (Mixer → Add insert → Time →
Spectre), after one point added in the wide view, as the breakpoint engine
drew it:

![The Spectre card on the master inserts](spectre-card.png)

The curves opened wide (decision 13 of the first record):

![The wide view of the delay curve](spectre-wide.png)

## Setup

- **Machine:** Apple M4 Pro (14 cores), macOS 26.5.1 (Darwin 25.5.0), Node
  24.16.0. Never quiet: other sessions shared it, and the one-minute load
  average was 4.61 before the run and 3.38 after.
- **Browser:** Google Chrome 155, arm64, headless
  (`HeadlessChrome/155.0.0.0`), launched by `bench.mjs` with a temporary
  profile, no extensions and muted output. Pages are served from
  `127.0.0.1`.
- **Backend:** `OfflineAudioContext`, 48 kHz, stereo, 128-frame quanta. The
  bloom study found the offline render thread runs the same JavaScript 2 to
  4 times slower than the real-time thread on an M1
  (`docs/research/2026-10-11-bloom-insert/README.md`), so these figures are
  on the high side of what the real-time thread spends.
- **Budget:** one quantum, **2.667 ms at 48 kHz**. A share is ms per quantum
  over that.

## Method

`bench.mjs` (the Pump's, renamed) bundles `page.ts` with esbuild, serves it
and the generated worklet bundles, launches Chrome, collects each repeat the
page posts, and writes `measurement.json`. Run it from the repository root
on Node 24:

```bash
node docs/research/2026-10-16-spectre-insert/bench.mjs
```

The program is 20 seconds: a stereo pad (three sines, A3, C♯4 and E4, at
0.08 each, the right channel detuned 0.2 %) with a 1.8 kHz click on every
beat at 120 BPM. Each node is built as the insert builds it
(`spectreInsert.ts`), from one spec: `DEFAULT_SPECTRE` with the mode's
settings, its params as `spectreParameters` writes them at 120 BPM and its
cells handed over as `processorOptions.cells`, `spectreCellPayload(spec)`.

The modes over the defaults:

- **moving:** the LFO at 0.5 Hz with depth 0.5 into Delay Offset, Gain Shift
  and Feedback Offset, and the delay shift stepping between −1 and +1 octave
  every 16 quanta.
- **cells-stepped:** Steps on the gain, delay and feedback lanes.
- **select:** half the cells selected, in alternating runs of ten, with Gain,
  Delay and Feedback Select at 0.5.
- **follow-chord:** select's settings with Follow on Chord, and the `pitches`
  param set each bar (every 2 s) to C, F, G and A minor in turn, as the
  stage's `setChord` schedules it.
- **scope:** the scope turned on by the message the workbench sends. The
  page waits 200 ms, untimed, after the message and again after the render;
  without the first wait the processor never received it before the render
  ended. Each instance posted 468 reports in the 20 seconds (in
  `scopeReports`), so the scope ran throughout.

### The check

Before the timed cells, the page feeds one Spectre a lone 1.8 kHz click and
reports its left output's RMS in two windows: 0.1 to 0.7 s, after the dry
click has died and up to past Bleep Test's longest delay (500 ms), where
only delays sound; and 0.7 to 4 s, where only feedback does. It runs three
ways (`check` in `measurement.json`):

| Cells | 0.1–0.7 s (delays) | 0.7–4 s (feedback) |
|---|---|---|
| Bleep Test's, handed over | 0.0105 | 0.00035 |
| the same with the feedback lane drawn to zero | 0.0098 | 1.1 × 10⁻¹⁵ |
| none (the processor's fallback) | 0.000012 | 4.6 × 10⁻³² |

So the timed cells run Bleep Test's delay and feedback paths, and the run
before cells (below) ran neither. The moving mode's output level also differs
from the default's (`outputRmsPerInstance`, 0.078 against 0.085), so its
LFO reaches the sound.

## Before cells

The first run, on the breakpoint engine (record
`2026-10-16-spectre-insert`), kept as measured. It ran on the processor's
fallback cells (every band whole, undelayed and without feedback), because
the bench passed only the params and no cells, and its moving mode set two
fields that are not Spectre's, so no LFO slot had any depth: only the
stepped delay shift moved. Every repeat is in
[`measurement-before-cells.json`](measurement-before-cells.json).

| Mode | 1 instance | 4 instances |
|---|---|---|
| default (512 bands, 2×) | 0.0384 ms (1.44 %) | 0.1514 ms (5.68 %) |
| coarse (128 bands, 2×) | 0.0375 ms (1.41 %) | 0.1477 ms (5.54 %) |
| fine (2048 bands, 4×) | 0.0521 ms (1.95 %) | 0.2094 ms (7.85 %) |
| blur | 0.0419 ms (1.57 %) | 0.1629 ms (6.11 %) |
| moving (stepped delay shift; no LFO) | 0.0389 ms (1.46 %) | 0.1515 ms (5.68 %) |

The harness alone read 0.0005 ms. Same machine, browser and backend as
above; the one-minute load average was 2.21 before that run and 2.19 after
(the 15-minute, 28, was a heavier run that had just finished).

## What this does not measure

- **The worst quantum.** A frame's FFTs, band map and delays run in the
  quantum its hop ends in, so the work is bursty: at 512 bands and 2× the
  frame falls every fourth quantum, at 2048 bands and 4× every eighth. The
  mean above spreads that over the hop. A real-time peak reading needs the
  load meter on a running page.
- **Sleep.** The program never falls silent, so the sleep's saving is not
  in these figures.
