# What a roll's clip envelopes cost the main thread

windsor#702 plays a roll's clip envelopes through the part's voice slots,
tick by tick, from the automation player. Decision 8 of the issue asks for
the main-thread cost per tick with 4 envelopes on each of 8 roll parts,
against no envelopes, in headless Chrome. This note measures it.

**32 envelopes cost about 13 µs per tick**, about 0.41 µs per envelope per
tick. At 120 BPM a tick comes 48 times a second, so the 32 envelopes take
about 0.63 ms of main-thread time per second of music, 0.06 % of one core.
That is the same as 32 song lanes on voice targets (14 µs per tick). **A
song with no envelopes costs what it did**: such a part has no envelope
source, and the player takes its old path.

Measured on an Apple M1 MacBook Air (MacBookAir10,1, 16 GB, macOS 26.7.1),
in HeadlessChrome 155 (the project's chrome-devtools MCP), on an
`OfflineAudioContext` at 48 kHz running the real FM worklet. The page was
not cross-origin isolated, so `performance.now()` reads in 0.1 ms steps;
each run sums 64 timed batches of 24 ticks.

## Method

`bench.mjs` runs in a page of the app's dev server (`npm run dev -w
packages/app`), imported from its `/@fs/` path so Vite compiles the engine's
TypeScript. Each run builds eight real `AudioPart`s with `FmEngine` on a
fresh `OfflineAudioContext`, the real `AutomationPlayer` on a
`TickTransport` over them through the live resolver
(`system/automationResolver.ts`), and plays a 16-bar song at 120 BPM (1536
ticks). The context renders in 0.5 s steps; at each stop the bench issues
the ticks up to the next stop plus the scheduler's 0.12 s look-ahead, as
`render/renderPass.ts` does, so the audio thread consumes the scheduled
events as it would live and the params' timelines stay short. Only the
ticks' fan-out is timed: the player's windows and the AudioParam calls they
make. The arrangement player and the notes are not in the timed path; they
cost the same in every mode.

Every part plays four regions of four bars, each its own roll with a
one-bar loop, so every part crosses a wrap each bar and a region change
every four. The modes:

- `none`: no envelopes;
- `envelopes`: four envelopes on every roll (Cutoff, Resonance, LFO 1
  amount, operator B's level), eight bent points each;
- `lanes`: no envelopes, a bent song lane on each of the same four targets
  of every part (the player's existing path, for scale);
- `summed`: both, so every envelope sums with a song lane in one slot.

Two warm-up rounds of all four modes, then seven rounds, the modes
interleaved so drift lands on all alike.

## Results

µs per tick, all eight parts together:

| Mode | Runs | Median |
|---|---|---|
| `none` | 0.46, 0.59, 0.07, 0.33, 0.13, 0.20, 0.26 | 0.26 |
| `envelopes` (32) | 13.35, 12.43, 13.28, 13.35, 13.54, 13.02, 12.96 | 13.28 |
| `lanes` (32) | 13.93, 14.13, 14.91, 14.06, 13.09, 14.32, 13.80 | 14.06 |
| `summed` (32 + 32) | 24.67, 23.83, 24.15, 24.93, 25.07, 23.70, 23.76 | 24.15 |

- Envelopes over none: (13.28 − 0.26) / 32 = 0.41 µs per envelope per tick.
- Summed over lanes alone: (24.15 − 14.06) / 32 = 0.32 µs per envelope per
  tick. A summed target makes one window for the lane and the envelope
  together, in place of the lane's own.
- `none` is the transport's fan-out with nothing to schedule, under the
  clock's resolution.

The cost is mostly the AudioParam calls: one ramp per envelope per tick,
plus a step's second ramp at a wrap or a region change. The envelope's
value is read with the song lanes' own evaluator. The envelope-only path
is written to allocate nothing per tick (fields and callbacks made once);
that is a property of the code, not something this bench measured.
