# The Pump insert: a drawn gain shape that a sidechain retriggers

- **Date:** 2026-10-13
- **Status:** accepted. tacowars tested Pump in the app and approved it on
  2026-10-13; the PR still goes through review
- **Links:** windsor#803 · sidechain routing (the compressor's,
  windsor#660) · the insert slot rules `2026-10-11-wet-path-slot` · format
  rules `2026-09-28-format-versions-refuse-never-destroy`

## Context

Dance pumping in Windsor meant a compressor keyed from the kick, then
guessing threshold, release and makeup until the duck sat right. A pump is
a volume shape, not dynamics. The direct tool draws that shape, starts it
on every kick, and shows the kick under the shape while you draw.

## Decisions

1. **A new kind, `pump`, in the Dynamics group.** It keys like the
   compressor. Its spec carries `sidechain` (Internal, a part's slot, or
   disconnected), and the mixer's routing treats every kind whose spec does
   (`isKeyedSpec`) the same way: cycles are refused, a bus or group keys
   from its own input, and a slot child is forced to Internal.
2. **Onsets, not a clock, start the cycle.** A fast peak follower of the
   key (0.2 ms attack, 15 ms release) is set against a slow 60 ms follower
   of the fast one. A trigger fires when the fast one stands a set rise above
   the slow one and above −60 dBFS. Sens maps 0..1 to a rise from 24 dB to
   3 dB. Hold (10–500 ms) is the least time between triggers, and the
   detector re-arms when the gap falls to half the rise. All of this runs on
   linear ratios, with no log on the audio path. Measured on the bundle, a
   kick on the key starts the cycle within 1 ms (`pumpDsp.test.ts`). The
   program is not delayed, so there is no latency to compensate.
3. **The shape is breakpoints with a rational bend.** It holds up to 16
   points (`at`, `level` and `bend`), the first at 0 and the last at 1. Each
   segment's curve is `u / (u + β(1 − u))` with `β = (1 − bend)/(1 + bend)`:
   straight at 0, mirrored by the sign, one division a sample. The worklet
   and the card evaluate the same expression (`pumpCurves.ts`), and
   `pumpDsp.test.ts` pins the played gain against `pumpLevelAt` sample for
   sample. After the cycle, and before the first trigger, the shape holds its
   last level.
4. **Every control is a k-rate param.** The shape travels as `count` plus
   `at<i>`, `level<i>` and `bend<i>` for 16 slots. The worklet rebuilds its
   segments only when one of them moves. The length is one `lengthMs` param:
   while synced, the main thread folds the division and the song tempo into
   it (`setTempo`). Depth, Length (unsynced only), Sens, Hold and Smooth are
   automation rows. The shape, the division, Sync and the source are not.
5. **Gain is `1 − depth·(1 − level)` through a one-pole slew of `smoothMs`**
   (0–10 ms, default 1.5 ms). That one control removes clicks from a
   retrigger and from a drawn vertical step, and it adds no latency. The
   switch fades the gain toward unity over `INSERT_SWITCH_FADE_S`, so fully
   off is the input to the bit.
6. **The card draws the shape over the key.** The editor is a 384 × 160
   canvas. Press to add or move a point, drag a diamond to bend a segment,
   double-click to remove a point or straighten a segment, and hold Alt to
   move off the 1/16 grid. Behind the shape the card draws the key's peak
   level in dB (−48 to 0), in 96 bins across the last cycle from its
   trigger, with older cycles fading. A playhead runs while the cycle runs.
   The worklet posts this only while the card is on screen, as the
   compressor's meter does.
7. **Additive to the song format.** It is a new kind, so there is no
   version bump.

## Not done

There is no free-running, tempo-locked mode, because a worklet never learns
song time; a kick track drives it instead. There are no bands, no presets
and no MIDI trigger.
