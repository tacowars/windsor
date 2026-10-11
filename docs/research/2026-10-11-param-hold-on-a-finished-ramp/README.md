# A param hold after a finished ramp (windsor#694)

Measured on 2026-10-11 on an Apple M1 MacBook Air (MacBookAir10,1, macOS
26.7.1) in the project's headless Chrome (HeadlessChrome/155.0.0.0) and in
headless Firefox 157.0.1. The question: does `holdAt` followed by a 12 ms
`linearRampToValueAtTime` ramp from the value at `now`, or does it step?

## Method

A `ConstantSourceNode` (offset 1) feeds a `GainNode` into the destination,
at 48 kHz. Each change runs at `now` = `currentTime`, then ramps the gain
over 12 ms (576 frames).

- **Chrome:** an `OfflineAudioContext`, with each change made inside
  `suspend(now)`. The suspend is quantum-aligned, as `currentTime` is in a
  running context.
- **Firefox:** it has no `OfflineAudioContext.suspend` and no
  `cancelAndHoldAtTime`. The same changes ran in a realtime `AudioContext`,
  recorded through a `ScriptProcessorNode`, three runs per case.

The three cases:

- **(a) after a finished ramp:** a ramp 0 → 1 over 0–100 ms, then a change
  at 1 s.
- **(b) mid-ramp:** a ramp 0 → 1 over 0–1 s, then a change at 0.5013 s.
- **(c) a fresh param:** `gain.value = 1`, as the strip's gate is built,
  then a change at 0.5013 s.

## Chrome, offline: the value at `now` and the ramp

Columns are the sample before `now`, the sample at `now`, then `now` plus 1,
2, 4, 64, 288 and 576 frames.

| Hold | Case | before | at `now` | +1 | +2 | +4 | +64 | +288 | +576 |
|---|---|---|---|---|---|---|---|---|---|
| `cancelAndHoldAtTime` (the old `holdAt`) | a | 1 | **0.01316** | 0.01314 | 0.01311 | 0.01307 | 0.0117 | 0.00658 | 0 |
| | b | 0.50131 | 0.50133 | 0.50046 | 0.49959 | 0.49785 | 0.44563 | 0.25067 | 0 |
| | c | 1 | **0.02338** | 0.02334 | 0.0233 | 0.02321 | 0.02078 | 0.01169 | 0 |
| read `value`, cancel, set | a | 1 | 1 | 0.99826 | 0.99653 | 0.99306 | 0.88889 | 0.5 | 0 |
| | b | 0.50131 | 0.50131 | 0.50044 | 0.49957 | 0.49783 | 0.44561 | 0.25066 | 0 |
| | c | 1 | 1 | 0.99826 | 0.99653 | 0.99306 | 0.88889 | 0.5 | 0 |

`cancelAndHoldAtTime` adds nothing when no event lies after `now`. The next
ramp then runs from the last event: the end of the finished ramp in (a), and
in (c) the event that setting `value` made at time 0. The gain steps almost
to its target at `now`. Chrome's realtime context showed the same steps, a
jump of about 0.978 at `now` in two runs each of (a) and (c).

## Chrome, offline: reversals swept across offsets

Each render is a fade from 1 to 0 at a quantum boundary, made with the hold
under test, then a reversal to 1 made the same way some quanta later. A
jump between neighbouring samples of more than 1.5 ramp steps (1/576 each)
counts as a fault, or 2.5 steps for the engine's own code.

- **Sweep 1:** five start times, reversals 1 to 11 quanta later (the first
  fade finishes after 4.5) and 200 quanta later, plus a fresh param per
  start time: 65 renders per hold.
- **Sweep 2:** the gain built with `value = 1`, as the gate is, at seven
  start times, with reversals 1, 2, 3, 4, 5, 6, 9 and 50 quanta later, or
  none: 63 renders per hold.
- **`fadeRamp`:** the module itself, at five start times, with reversals
  1, 2, 3, 4, 5, 6, 9, 50 and 200 quanta later: 45 renders.

| Hold | Faults |
|---|---|
| `cancelAndHoldAtTime` alone (sweep 1) | 41 of 65: every reversal after the first fade had finished, and one mid-ramp frame dropped to 0 |
| read, `cancelScheduledValues`, set (sweep 2) | 5 of 63: a one-frame spike to the cancelled timeline's earlier value, up to 0.89 |
| `fadeRamp` as merged in PR #693 (computed value, cancel, set) | 5 of 45: the same one-frame spikes, up to 0.89 |
| read, `cancelAndHoldAtTime`, set: the new `holdAt` (sweeps 1 and 2) | no step or spike in 128. One render passed 1.5 steps, at 0.0033 (1.9 steps), where the value read was one frame behind |

The engine's own gate after the fix, with mute, solo, Output and dry-edge
moves at 21 offsets each, rendered no jump above 2.5 ramp samples in 84
changes. `fadeRamp` through the new `holdAt` rendered none in 45.

## Firefox, realtime

| Hold | (a) | (b) | (c) |
|---|---|---|---|
| read `value`, cancel, set | ramps | ramps | ramps |
| cancel, read `value`, set | ramps | **steps to 0** (3 of 3) | ramps |

Firefox reports `value` from the timeline as it stands, so a read after
`cancelScheduledValues` no longer sees the cancelled ramp. Mid-ramp it read
0, and the fade stepped by the whole of its value. The four `fadeTo` sites
(`stripTap`, `returnBus`, `masterStrip`, `groupBus`) cancelled before they
read.

A separate effect hit every approach alike in both browsers' realtime
contexts: an occasional jump of 128 to 256 frames' worth of the ramp, when
the render thread had already passed `now` before the events arrived. That
comes from scheduling at `currentTime`, not from the hold, and it is not
changed here.
