# #547: render time before and after dormant voices and plate sleep

**Dev-machine indication only. This is not a target reading** (CLAUDE.md
invariant 3). These are Node renders through the worklet harnesses, not an
`AudioWorkletGlobalScope` in Chrome. They show relative cost on one machine
and nothing about audio-thread headroom on the Ryzen 5 5600G / Vega 7 box.
The next audio milestone reading covers that.

## Machine and method

| | |
|---|---|
| Machine | Apple M4 Pro (dev machine), macOS 26 |
| Runtime | Node v24.16.0 via `npx tsx`, V8 JIT, one process per line |
| Before | the base commit `709ece2e`'s worklets and harnesses (the main checkout) |
| After | this branch's worklets and harnesses (`tech-debt/547-…`) |
| Harness | `packages/client/src/audio/__fixtures__/workletHarness.ts` and `reverbHarness.ts`, 48 kHz, 128-frame quanta, no sample collection on the timed renders |
| Statistic | median of 7 or 9 renders, each in a fresh processor. Each figure was taken on at least two alternating before/after passes and agreed within ~2 %. |

The scripts are beside this file. Each takes the checkout root and a label:

```bash
PRESET=score-tin-kalimba npx tsx docs/research/2026-09-15-547-dormant-voices-plate-sleep/bench.mts <root> <label>
npx tsx docs/research/2026-09-15-547-dormant-voices-plate-sleep/rv2.mts <root> <label> impulse
npx tsx docs/research/2026-09-15-547-dormant-voices-plate-sleep/fm2.mts <root> <label> dormant
```

## Results

### Held pluck

A 16-voice part holds 8 notes (MIDI 48, 51 … 69) at velocity 0.9 for 10 s,
with no note-off.

| Patch | Before | After |
|---|---|---|
| `score-tin-kalimba` (carriers sustain 0) | 170 ms | 14.7 ms |
| `score-stone-marimba` (carriers sustain 0) | 170 ms | 9.6 ms |
| `makePatch()` default sine, sustain 0.7 (never dormant: the control) | 160 ms | 159 ms |

The after figure for the plucks is mostly the attack and decay before the
voices go dormant.

Warming the part on the dormant kalimba first and then timing the sustaining
control (`fm2.mts … dormant`) read 162 ms before and 162–164 ms after. So the
skipped path does not slow a part that later plays sustained notes.

### Plate

The plate uses default parameters.

| Scenario | Before | After |
|---|---|---|
| One impulse, then 60 s of silence | 597–601 ms | 95–96 ms |
| 10 s of full-scale noise (never quiet) | 106–108 ms | 101–103 ms |

The impulse render sleeps about 8.6 s in. By then the tail has been under
1e-7 for the 1.6 s span, which is the longest tank line at `MAX_SIZE` plus
the 1 s maximum pre-delay. The noise line is a plate that never sleeps. There
the settled-SIZE skip saves more than the quiet tracking costs.

These plate figures were taken after review pass 1. Pass 1 found that the
first version's settled-SIZE skip never engaged: `_tap` is Float32, its
target is a double, and so a settled tap kept a sub-ulp step that was never
exactly 0. The skip now asks whether one add changes the stored value. With
the skip broken, the same scenarios read 591 ms for the impulse and 105–110 ms
for noise.

## One finding along the way

The first version handled the asleep quantum at the top of `_renderBlock`.
With that, a process that first rendered a plate to sleep and then fed it
noise read **138 ms**, against 105 ms before and 106 ms when the noise came
first. The impulse render regressed with it, from 97 ms to 123 ms. V8
optimised the tank loop on the thin feedback of quanta that returned early,
and it stayed slow.

Dispatching the asleep quantum from a separate `_render` method, so that
`_renderBlock` only ever sees awake quanta, brought loud input back to
106–110 ms, before the settled-SIZE fix above. That is the shipped shape. The decision record is
`docs/log/2026-09-15-silent-voices-and-plate-sleep-floors.md`.

A harness-only regression was also found and fixed before these numbers were
taken. Reading `options.collectSamples` inside `renderReverb`'s per-sample
loop cost ~30 % on the noise render. It is now hoisted to a local.
