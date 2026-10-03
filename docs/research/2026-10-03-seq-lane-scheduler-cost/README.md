# What sequencer lanes cost the scheduler

windsor#488 makes `seq.gate`, `seq.skipChance` and `seq.density` lane
targets, read by each part's region gate on the tick it issues. This note
measures what that costs the main-thread scheduling path, before and after,
as the issue's last acceptance line asks.

**A part with no lanes costs what it did.** On both songs the branch with
no `seq.` lanes reads within the run-to-run spread of `origin/main`.

**A part with lanes costs about 0.12 µs per tick per laned part** on this
machine, for one or two bent lanes: the gate reads every lane with
`valueAt` on every tick it forwards and hands a fresh overrides object on.
At 120 BPM a part hears 48 ticks a second, so a laned part spends about
6 µs of main-thread time per second of music.

Measured on an Apple M1 MacBook Air (MacBookAir10,1, 16 GB, macOS 26.7.1),
Node 24.21.0. No browser and no audio backend is involved: the transport,
the gates and the generators are plain JavaScript on the main thread, and
the bench drives them with recording parts in place of `AudioPart`s.

## Method

`bench.mjs` (run from the repo root) bundles the real `ArrangementPlayer`
with `packages/app/lib/audioBundle.mjs`, normalises the song with
`makeArrangement`, and times only the transport's advance over every tick
of the song: eight warm-up runs, then 60 runs on a fresh player each, and
the median. The baseline is the same bench over `origin/main`'s engine
source at 77865db (`git archive origin/main packages/engine/src`, bundled
through `AUDIO_DIR`). Baseline, branch and branch with lanes ran
interleaved, five rounds per song, so drift lands on all three alike.

`lanes` adds, before normalising, every sequencer lane each pitched part's
kind offers, each a bent ramp over the whole song: two on an Arp, a Bass or
a Figure, one on a Grid (the Grid has no gate). The issue asks for three
per pitched part; no kind offers three, so this is the most a part can
carry. The Chord and Euclidean parts carry none.

The issue names "the engine's scheduler cost counter (`engine/cost/`)".
`engine/cost/` holds only the worklets' duty-cycle load sampler
(`audioLoad.ts`), which never sees the scheduler, so the scheduler is timed
directly instead.

## Results

Median of the five rounds' medians, in ms for the whole song; each round's
quartiles spanned about 1–2 ms.

| Song | Parts (laned) | Ticks | `origin/main` | Branch, no lanes | Branch, lanes |
|---|---|---|---|---|---|
| Life in Transformation | 16 (6: 1 grid, 4 arp, 1 bass; 11 lanes) | 12096 | 21.35 | 21.58 | 30.19 |
| Tapes for Sixteen Players | 14 (9: 5 grid, 2 arp, 2 bass; 13 lanes) | 9216 | 22.89 | 22.83 | 32.29 |

Rounds (no lanes, `origin/main` / branch):

- Life in Transformation: 21.34 / 21.36, 21.88 / 21.36, 21.71 / 21.74,
  21.24 / 21.58, 21.35 / 21.94.
- Tapes for Sixteen Players: 22.77 / 23.65, 22.89 / 22.94, 23.24 / 22.39,
  22.92 / 22.83, 22.76 / 22.25.

The lanes' cost per laned part per tick: (30.19 − 21.58) ms over
12096 × 6 part-ticks is 0.119 µs; (32.29 − 22.83) ms over 9216 × 9 is
0.114 µs.

## If it ever matters

The gate reads a part's lanes on every tick it forwards, though an Arp, a
Bass or a Figure reads them only on its onsets. Handing the generators the
reader and the position instead of the values would read them once per
onset, at the price of a less plain event. At these numbers it is not
worth it.

The songs are tacowars's, not in the repo: `life-in-transformation.json`
and `tapes-for-sixteen-players.json`.
