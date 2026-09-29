# Advanced Drive skips settled control smoothing

2026-09-30 · windsor#136 · user-approved performance review.

Advanced Drive currently smooths every continuous control on every host
sample, even when its value equals its target. The review measured this
as the largest avoidable cost across all six factory presets on an M1.

1. Build the active continuous-control list once per parameter block in
   constructor-allocated storage. Preserve original key order. Retain a key
   which settles inside a block until the following block, so the audio
   sample loop never removes entries or shifts storage.
2. Keep the exact original recurrence and snap threshold for active keys.
   Compare targets with `Object.is` to preserve changes between signed zeros.
   A settled key's update would leave its value unchanged and can be skipped.
3. Keep oversampling, shapers, filters, modulation cadence, topology fades,
   LFO phase, follower state, bypass and latency unchanged. No patch/song
   format version bump or golden refresh is needed. Coefficient caching and
   FIR work from the review are deferred to separate changes.
4. Compare the rebuilt shipped processor with a forced full smoothing loop,
   independently check the recurrence and its boundaries, and benchmark the
   implemented source against the reviewed original commit. Node throughput
   is evidence for this change, not a new Chrome load-meter percentage.

Evidence and reproduction steps:
`docs/research/2026-09-30-advanced-drive-performance/README.md`.
