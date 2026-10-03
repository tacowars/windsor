# The part meter bank

- **Date:** 2026-10-03
- **Status:** accepted: the decisions in windsor#540, with the three
  choices below made while building it
- **Links:** windsor#540 · windsor#533
  (`docs/research/2026-10-03-always-on-part-meters/`) · windsor#528 ·
  `packages/engine/src/mixer/partMeterBank.ts` ·
  `packages/engine/src/worklet/meter/`

## Context

tacowars chose real meters for the part strip's chips on every tab. windsor#533
measured one worklet node with an input per part at 0.54–0.67 of the cost of
one strip meter (`createPeakMeter`) per part, with one message a report for
every part. windsor#540 ships it in the engine as the part meter bank:
`createPartMeterBank(context)`, owned by the system as
`AudioSystem.partMeters`, with `MusicRoster` attaching each music part's
tap (the rotation's output, where the strip meter taps) on its slot.
windsor#528 lights the chips and the Song mixer from it.

## Decision

1. **The bank's processor shares the meter bundle.** `worklet/meter/`
   bundles from `meterProcessors.ts`, which imports the strip meter and the
   bank, to the same `generated/peak-meter-processor.js`. The engine's one
   `addModule` for the meters (`PEAK_METER_WORKLET_URL`) loads both, so
   `FmEngine`, its URL options and the app change nothing, and the context
   fetches no second script. A harness picks a processor by its registered
   name (`generatedProcessor`'s and the allocation probe's `processor`).
2. **The message carries an acknowledgement.** It is the parts' reports,
   `parts × 5` floats in `PeakReport`'s order, then one more float: the
   sequence number of the last `reset` or `clear` the processor had handled.
   The main thread zeroes a slot at once when it resets or detaches it, and
   ignores that slot in any report from before the processor saw it. Without
   it, a report already in flight would put a removed part's clip latch on
   the part that next takes its slot, and the app's latch would keep it. The
   number is a float32, exact to 2^24 resets and clears in one activation;
   it starts over at each `setActive(true)`.
3. **One copy of the ballistics, with silence in its own loop.** Both
   meters run each channel through `ChannelPeak` (`worklet/meter/channelPeak.ts`),
   the strip meter's per-sample loop on one channel. Its reports are
   unchanged: the strip meter's posts were compared, report for report,
   against the previous bundle over 20 000 quanta of random stereo, mono,
   missing and over-full-scale input with latch resets, at 44.1, 48 and
   96 kHz, and `partMeterBankProcessor.test.ts` compares the two meters the
   same way. The shipped loop read `samples?.[i] ?? 0`, and once a channel
   had been missing (an inactive source) V8 merged every sample with the
   integer 0 and boxed it: 16 bytes a sample, about 4 KB a quantum for one
   strip meter in Node 24. Reading a missing channel in a loop of its own
   allocates nothing (`partMeterBankAllocation.test.ts`), and the strip
   meter gets the same fix. This is a candidate for windsor#533's
   unexplained collections per tapped part; it was not measured in Chrome.

## Consequences

- The strip meter (`createPeakMeter`) stays for the Mixer tab and its other
  users; moving the Song mixer and the chips to the bank is windsor#528.
- Slot `k` is input `k`, so reordering the song's part list moves nothing.
