# No worklet warm-up before the first play, for now

- **Date:** 2026-10-16
- **Status:** accepted: tacowars's decision on windsor#837
- **Links:** windsor#837 · windsor#835 ·
  `docs/research/2026-10-16-worklet-warm-up/`

## Context

The first ▶ after the power button dropped out on the pad bench song: the
first notes ran code V8 had never compiled, and the first downbeat's quantum
took 8 to 12.5 ms against a 2.9 ms budget. A second ▶ was clean.
windsor#837 built a warm-up: at construction, each FM part played a short
script on its own patch, and each worklet insert kind's first processor
rendered 16 quanta of noise at its own settings, then each built its state
again from its options, so it was a fresh processor to the bit. The research
folder records what was cold, the design, what was tried, and the numbers,
on a 14-core arm64 desktop in headless Chromium 155. The code lives only on unpushed
WIP commits.

## Decision

1. **No construction-time warm-up for now.** The worklets stay as they
   were; nothing of windsor#837's code is merged.
2. **The research stays**, as the record of the experiment and its
   scripts, so a later attempt starts from its numbers.

## Why

- **The gain is on the pad bench only.** Its first-▶ device underruns fell
  from 3 (0–5) a run, in 11 of 12 runs, to one or two in 3 of 22. The drum
  song, the music Windsor is for, had none to remove, before or after.
- **It costs the drum song.** Its steady render read +15.6 % and +11.6 % at
  44.1 kHz in two rounds of six runs (within noise at 48 kHz), and the
  build's burst on the audio thread more than doubled (23–35 ms of device
  underrun to 58–76 ms).
- **Upkeep.** Every processor would have to keep an `init`-twice rule with
  `declare`d fields, which the compiler no longer checks for definite
  assignment; the same constructor block was pasted into 11 processors; the
  scratch arguments branch on whether the scope is real, so the Node tests
  do not run the path Chromium runs; and it carries V8-tuned special cases
  (the tape's Drive moves in its run, the pump and the plate left out).
- **The false alarm is handled.** windsor#835's settling window stops the
  CPU meter's toast about the first ▶.

## What would reopen it

- A first-downbeat dropout tacowars hears on a drum-heavy song.
- A cheaper mechanism: one that needs no second `init` in every processor,
  runs the same path under the tests as in Chromium, and leaves the drum
  song's steady render unchanged.
