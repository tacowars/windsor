# Game-only audio hooks removed

- **Date:** 2026-09-27
- **Status:** accepted

## Context

Aotearoa204 drove `AudioSystem` from a game loop with a debug console,
a frame overlay and an automated bench. Several engine APIs existed only for
those callers, and nothing in Windsor's console calls them:

| API | Its Aotearoa204 caller |
|---|---|
| `AudioSystem.startWithoutGesture()` | the `?bench=1&audio=1` run, launched with autoplay allowed |
| `AudioSystem.suppressMusic()` and the `suppressed` flag | `?music=0`: build the graph, never start the transport |
| `AudioSystem.toggleMute()` | `__a204.audio.toggleMute` in the debug console |
| `AudioSystem.loadReadout()`, `costReadout()` | the overlay and the bench collector |
| `cost/audioCost.ts`, `cost/schedCost.ts`, `cost/playbackStats.ts`, and the `now` option | the combined readout, the main-thread scheduling cost timed around `update()` (#275), and `AudioContext.playbackStats` underruns (#275) |
| `FmEngine.partCount`, `FmEngine.maxVoices` | the bench header (#445) |

## Decision

Remove them. Pat agreed on 2026-09-27. The load readout the console shows
stays: `cost/audioLoad.ts`, reported by every worklet and read through
`AudioSystem.readout().load`, and the tests' `meteredProcessors` hook with
it. `update()` now just pumps the scheduler.

## Consequences

- The constants that only fed the removed modules are gone:
  `AUDIO_STATS_SETTLE_MS` and `AUDIO_SCHED_WINDOW_SECONDS`, `_MAX_SAMPLES`
  and `_QUANTILE`.
- `docs/design/audio-architecture.md` §7 describes the one remaining
  readout. The research records under `docs/research/` keep the history of
  the removed ones.
- If Windsor ever wants a dropout readout, `AudioContext.playbackStats` is
  the place to start. The 2026-09-14 probe in `docs/research/` records its
  units and lag.
