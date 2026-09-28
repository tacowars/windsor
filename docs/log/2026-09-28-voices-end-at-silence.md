# A voice ends at silence, never by cutting its filter's ring

- **Date:** 2026-09-28
- **Status:** accepted and built (windsor#7, PR windsor#20). The fixes for
  the steal and for a held End level are measured. The stop/pause fix awaits
  Pat's listen.
- **Measurements:** `docs/research/2026-09-28-voice-clicks/README.md`

## Context

Pat heard clicks in two demo songs, `clicks.json` and `clippy.json`. They
sounded like an envelope or a voice cutting in or out. Each click was
traced to a way the FM part ended a voice with its per-voice filter still
ringing.

- **Steal:** a mono retrigger, or a full pool, fades the old voice over
  4 ms and then kills it. The fade was applied to the filter's input, so a
  low cutoff was still ringing when the kill came. `renderBlock` then went
  on rendering the killed voice to the end of the segment, with `kill()`
  having reset its fade to 1. The ring came back at full level, and the
  segment's end cut it to 0.
- **Release end (stop, pause, any note-off):** a released voice was freed
  as soon as its carriers' envelopes ended. At that point the last
  amplitude ramp had not been rendered, and a resonant filter was still
  ringing.

## Decision

1. **The steal fade multiplies the filter's output, not its input**
   (`voiceRender.ts`, `voiceKernel.ts`). The fade is the same operation in
   the same place in both loops, so the kernel still matches the generic
   loop to the bit.
2. **A killed voice stops rendering.** `renderBlock` re-reads `active`
   before each chunk (`fmProcessor.ts`).
3. **A released voice stays active until nothing is left to hear.**
   `Voice.finished` requires every carrier's envelope to have ended, its
   amplitude ramp to be within `DORMANT_AMP` of 0, and the filter to be
   quiet. `filterQuiet` is the test dormancy already used (#547), now shared
   by both.
4. **A released voice whose envelopes end at a held End level fades out.**
   An End level above 0 never goes quiet, so once every carrier's envelope
   has ended and one ended above 0 (`Voice.holdsEndLevel`), the part runs
   the 4 ms steal fade on it and kills it at the end. The part neither
   waits on the amplitude nor cuts the voice.

## Measured

These are harness renders on Node at 48 kHz, as the largest
sample-to-sample step in the left channel. Clicks are judged against a
threshold of 0.05, twice the demo's own largest step away from any note
boundary.

| Case | Before | After |
|---|---|---|
| `clicks.json` line, mono retrigger (0.026 is the signal's own) | 0.244 | 0.027 |
| Poly, one note retriggered, pool of 1 | 0.145 | 0.002 |
| `clippy.json`, stop at step 7 / step 15, end of the release | 0.121 / 0.074 | 0.034 / 0.038 |
| Release to End 0.5, then past it (`fmProcessorDormancy`) | never ends (round 2) | fades out and ends, no step over 0.05 |

Decisions 1 and 2 are both needed. Moving the fade alone gave 0.548, and
stopping the render alone gave 0.253.

## Golden changes

`fmProcessorGolden` was refreshed on Node 24. It changes 85 presets in all
three paths:

- **The 53 presets with `mono: true`** (decisions 1 and 2). The golden's
  four-note chord steals in mono, and those steals now end without the
  cut.
- **48 filtered presets** (decision 3). The golden's 0.6 s tail now keeps
  the filter ring that it used to cut at the end of the release.

Sixteen presets are in both groups: 53 + 48 − 16 = 85. Every other
preset's render is bit-identical. Decision 4 changes no golden, because no factory preset has
a carrier End level above 0.

## Rejected

- **Smoothing the accent's filter sweep in the engine.** `clippy.json`
  also ticked on accented steps. The accent (`filter.modWheelDepth` 6)
  opened a Q-4.8 low-pass about ten octaves over a 2 ms filter attack.
  Updating the engine's controls every sample, to stand in for per-sample
  cutoff interpolation, cut the step at the accent's onset from 0.17–0.23
  to only 0.11–0.15, about a fifth of the click. That was not worth a
  coefficient recompute per sample in the hot loop. The sweep is the
  patch's own, and the patch is where it was fixed.
- **Hard-cutting a voice that holds an End level.** A cut is the click this
  record exists to remove, and waiting on its amplitude never ends.

## Pat's verdict

On the round-1 build Pat heard clearly fewer clicks than main; the accent
click was resolved in the patch (1 ms filter attack; Pat rejected 10 ms as
an audible ramp); the round-2 stop/pause fix awaits Pat's listen.
