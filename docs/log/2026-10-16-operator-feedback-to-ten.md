# Operator feedback runs to 10, on a knee curve

- **Date:** 2026-10-16
- **Status:** proposed (windsor#842, awaiting tacowars's listen and a turn of
  the knob on the PR preview)
- **Links:** windsor#842 · the bipolar feedback (#529) · the format record
  `2026-09-28-format-versions-refuse-never-destroy` · the knob ranges record
  `2026-10-02-knob-ranges-from-the-catalog` · the lane display record
  `2026-10-01-song-automation-lanes` (decision 5)

## Context

An operator's self-feedback depth is the setting times the operator's own
amplitude: `y × feedback × 1.25 rad`, on the two-sample average of its last
outputs (`voiceKernel.ts`, `FEEDBACK_SAW_CYCLES`). With the ceiling at 1, a
quiet operator, or one whose envelope is decaying, can only reach a
near-sine: 0.06 rad at −20 dB, where classic FM feedback 7 reaches 0.63 rad.
One operator can't start gritty on the attack and settle through saw to
sine as it decays. The classic FM voices that translation research surveyed
lean on this: 68 of 96 use feedback 5–7, which the converter now has to
clamp or bake into a static wave.

## Decision

1. **The stored value keeps its meaning.** `feedback` stays `y × fb × 1.25
   rad` with the two-sample average. The DSP loops do not change, so every
   value in −1..1 renders bit-identical and the goldens do not move.
2. **The range becomes −1..10.** `FEEDBACK_RANGE` in
   `worklet/fm/patchDefaults.ts` is `{ min: -1, max: 10 }`. The negative
   (square) side stays at −1. The value that matches classic feedback `n`
   is `20.1 × 2^(n − 8)`, so feedback 7 is 10.05, rounded to 10. That one
   constant drives the worklet's clamp in `normalisePatch`, the voice
   target row, the catalog row and the knob's bounds. The clamp and the
   row live in the FM bundle, so `generated/fm-processor.js` changes in
   exactly two data constants (the range's top and the row's span) and in
   no code line.
3. **No patch format change.** Every stored patch value is within −1..1
   and keeps its meaning. A macro mapping stores its `min` and `max` in
   target units (`macroShape.ts`), and a lane its points, so neither
   changes meaning. `PATCH_FILE_FORMAT` stays at 4.
4. **A step's span is 5.** The voice target row's `span`, the offset a full
   step adds, goes from 1 to 5, about half the travel, so a step or clip
   envelope can sweep a sine into noise. A song's stored step offsets on
   feedback now play five times deeper, so `ARRANGEMENT_VERSION` goes from
   16 to 17 with no upgrade: a version-16 song is refused, never loaded
   wrong. tacowars keeps no song to carry.
5. **A knee for the knob and the lane.** On a linear −1..10 knob today's
   useful range would get 18 % of the travel. The automation scales gain a
   `knee` scale, and a row a `knee`: the first `at` of the height (the
   knob's travel) runs linearly from the row's `min` to the knee's `value`,
   the rest geometrically from `value` to `max`. `automationDisplay.ts`
   holds the one map; the Parts tab's knob builds its sweep from that map
   on its catalog row (`knobScale.ts`), so a lane point and the knob sit at
   one height. A straight lane segment across the knee is a curve in
   feedback units, so the player cuts it into ramps, as it does a log row's.
   The numbers are a table, `FEEDBACK_KNEE` in
   `automation/automationTargetTables.ts`, and are proposals for tacowars
   to try:

   | Knee | Proposed | What it gives |
   |---|---|---|
   | `at`, its place on the travel | 0.6 | −1..1 over the first 60 %, 0 at 30 % |
   | `value`, the feedback there | 1 | 1..10 over the last 40 %, √10 ≈ 3.16 at 80 % |

6. **The comment says noise is reachable.** The comment above
   `FEEDBACK_SAW_CYCLES` says that past about 2.5 rad the loop turns to
   noise, and that from this change that is reachable on purpose, at the
   top of the range or on a loud operator.

Out of scope: the converter (research code, outside the repo), the other
engine changes the translation research lists, and the negative range.

## Consequences

- Every shipped patch, and every song's patch snapshot, renders as before.
- A song saved at version 16 is refused with the standard message.
- A full-level operator at feedback 10 renders finite output whose peak
  stays within the operator's ±1 before the voice gain, at A2 and A6
  (`synth/fmProcessorFeedback.test.ts`).
- If the knee's place or value is wrong under the hand, the two numbers in
  `FEEDBACK_KNEE` are the whole change, and the lane follows the knob.
