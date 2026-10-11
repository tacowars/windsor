# A clip envelope's slot is relative: its 0 floors nothing

- **Date:** 2026-10-11
- **Status:** accepted (windsor#718, under epic windsor#699's decisions)
- **Links:** windsor#718 · windsor#702 / PR #705 (envelopes on voice slots) ·
  windsor#347 (the decay floor)

## Context

A song lane is absolute. Over a decay time or an LFO rate below its row's
floor (1 ms, 0.02 Hz), a lane at or below the floor sends offset 0, and the
worklet plays the floor for any such target a slot maps (`partFloors`,
windsor#347). A roll's clip envelope is relative: its 0 is the patch's own
value. On the same slot, an envelope at 0 over a patch decay or rate of
exactly 0 played 1 ms or 0.02 Hz instead of 0.

windsor#718 preferred a fix outside the worklet: hold the slot back while
the envelope reads 0 over a target below its floor, or give it back there.
A slot map is not timed. It reaches the processor at the next quantum,
while the envelope's values are queued up to the scheduler's look-ahead
(0.12 s) ahead. So taking or freeing the slot at the envelope's 0 plays the
floor for up to that look-ahead before each rise and after each return to 0.
Only an envelope at 0 throughout would be exact.

## Decisions

1. **The slot map carries a `relative` flag per slot**
   (`VoiceSlotsMessage.relative`, `ProcessorOptions.voiceSlotsRelative`).
   `mapVoiceSlots` sets no floor for a relative slot, so its offset of 0
   plays the patch's own value. A nonzero offset still takes its ratio from
   the floor, so the target moves as soon as the envelope leaves 0.
2. **A slot is relative while a clip envelope writes it with no song lane
   on its target.** With a lane, the slot is the lane's and stays absolute
   and floored, exactly as before. A lane's `schedule` or `hold`, and a
   release, set it back. The flag goes in the map only while some slot has
   it, so a song with lanes and no envelopes posts the same messages as
   before.
3. **Song lanes are unchanged.** Their floor behaviour is windsor#347's.
   `fmProcessorGolden` and the lane tests did not change.
4. **An envelope takes a slot only when it can change the sound**
   (`envelopeSounds`): it is on, it has a point inside the loop, and its
   target has a handle (no macro maps it) on a value the patch has (a macro
   past the patch's count has none). A resync runs the rule again, and the
   slots the lanes leave go to the envelopes in the roll's order. So an
   envelope that a preset switch makes audible takes its place ahead of the
   envelopes after it.
