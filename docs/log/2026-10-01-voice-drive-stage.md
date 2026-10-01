# The voice's own drive stage

- **Date:** 2026-10-01
- **Status:** accepted (the decisions of windsor#300, from tacowars's
  direction of 2026-10-01)
- **Refines:** `2026-09-28-format-versions-refuse-never-destroy` (one
  song upgrade now ships, 5 → 6)
- **Links:** windsor#300 · the sound-match report on Medium C 03 (PR #292)
  · measurements in `docs/research/2026-10-01-voice-drive/README.md`

## Context

Drive lived inside the filter. `filter.drive` fed a symmetric soft clip
ahead of the state-variable filter, and only while the filter was on. Every
fitted kick kept a wide-open lowpass just to be driven, and a symmetric
clip can't make even harmonics: the 909 kick's body is lopsided (its
negative half-cycle is 1.19× its positive, with H2 about 10 dB above ours).
A biased shaper is the circuit-like way to get that, and tacowars wants it
as a synth improvement, not a drum fix.

## Decision

1. **The drive is its own patch block**, `patch.drive = { gain, shape,
   bias, tone }`, and `filter.drive` is retired. `gain` is the input gain
   (1 is unity, clamped to 0..64 so `gain · x` stays finite), `shape` an id from `DRIVE_SHAPE`, `bias` a DC offset
   before the shaper (−1..1), `tone` a lowpass after it (0..1, 1 open).
2. **Signal order:** carriers → drive → filter (if on) → steal fade. The
   drive no longer needs the filter. Unity gain with no bias bypasses the
   stage with no work done, whatever the shape and tone.
3. **Bias never makes sound from silence:** the stage is
   `shape(gain · x + bias) − shape(bias)`, as Advanced Drive's shaper is,
   with no DC blocker.
4. **Shapes**, ids from 0: `soft` (the filter's old soft clip, operation for
   operation, the default), `hard`, `diode`, `tube` and `fold`, the last four
   Advanced Drive's curves of those names.
   - Advanced Drive's curves call `Math.tanh`, `Math.sin`, `Math.asin` and
     `**`, which V8's arm64 and x64 builds round differently, so the voice
     keeps its own copy in IEEE arithmetic: tanh through
     `inserts/tapePortableMath.ts`, the diode's powers through
     `worklet/fm/portablePowers.ts` (a base-2 log and power in place), the
     fold by a floor. `voiceDrive.test.ts` holds each to Advanced Drive's
     within 1e-13 (relative past |x| = 1), and pins the shared constants
     (`tubeEven`, `diodeKnee`) equal.
   - Advanced Drive's `soft` is a different curve (a clipped sine); the
     voice's `soft` is the old soft clip, so the library is unchanged.
   - No oversampling in the voice: `hard` and `fold` alias, by design.
5. **Tone** is a one-pole TPT lowpass after the shaper, its cutoff
   `1000 · 2^(4.25 · tone)` Hz with g = π·fc/sampleRate (not prewarped), and
   bypassed at exactly 1. The curve is in `fmConstants.ts`; the coefficient
   is set once per control block.
6. **Format:** `PATCH_FILE_FORMAT` 2 → 3, with the upgrade in
   `patchMigrations.ts`: with the filter on, `drive = { gain: filter.drive,
   shape: soft, bias: 0, tone: 1 }`; with the filter Off, `gain: 1`, since a
   filter-off drive was never heard. `filter.drive` is deleted.
   `ARRANGEMENT_VERSION` 5 → 6, because a song's snapshot carries no
   `format` and is read at the format its version implies (decision 4 of
   `2026-09-28-format-versions-refuse-never-destroy`): `SONG_MIGRATIONS[5]`
   runs the patch table's 2 → 3 step over each embedded patch that declares
   no format of its own. Versions 2 to 4 stay refused.
7. **Every library patch keeps its sound bit for bit.** The goldens did not
   change. The library files were rewritten to format 3 by the format's own
   upgrade and nothing else (no default the loader fills was written in),
   each file loaded before and after and compared leaf for leaf, as the last
   commit after rebasing on main.
8. **The hot path:** the stage's state is the voice's preallocated
   `VoiceDrive`. Both render loops write the stage out, `soft` and the tone
   pole inline and any other shape through one call whose operand and result
   pass through a field. A first version called a `run()` method per sample;
   it cost the soft-driven bank about a third of its render, so the loops
   carry it instead (the research note).
9. **The engine only.** The console's Drive knob edits `drive.gain` where it
   stood, in the filter section. Moving it out and adding Shape, Bias and
   Tone is a separate ticket.

## Consequences

- A patch with the filter Off can now be driven: setting `drive.gain` above
  1 is heard whether or not a filter runs. A Drive knob turned on a
  filter-off patch in the console now changes the sound, where before it did
  nothing.
- A voice whose tone pole is running is quiet only once the pole is, so
  dormancy and the end of a release wait on it as they wait on the filter.
- A version-5 song opens as version 6 with no correction and plays as it
  did; it is saved as version 6, which an older build refuses.
- `svf.ts` no longer owns the soft clip; `voiceDrive.ts` does.
