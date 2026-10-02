# One voice target table for song lanes and step lanes

- **Date:** 2026-10-02
- **Status:** accepted and built (windsor#419). The step-lane picker's new
  targets await tacowars's listen.
- **Supersedes:** the two target lists of windsor#17 (`stepModTables.ts`)
  and windsor#346 / windsor#347 (`voiceOffsetTables.ts`)

## Context

Song automation lanes and step lanes each kept their own list of voice
targets: 29 rows for the lanes, 24 for the steps. Each list had its own
code layout and its own hand-written binding on the voice
(`bindLiveValues`, `bindStepMod`), and the voice kept scalar copies of six
values beside both (`envAmount`, `cutoff`, `resonance`, `opLevel`,
`opFeedback`, `opWidth`). The cutoff was a third path: its song lane wrote
the part's `cutoffMod` parameter in octaves instead of a slot. A new
target meant edits in both lists, both bindings and their tests, and a step
lane could not reach the vowel, the LFOs or the pitch envelope at all.

A modulation matrix is coming. Its sources (free LFO routes, then
anything else) need one set of target codes to address.

## Decision

1. **One table.** `worklet/fm/voiceTargetTables.ts` (data only) holds one
   row per target, 30 in all: the filter's cutoff, envelope amount,
   resonance, envelope decay and vowel; each operator's level, decay, decay
   curve, feedback and width; both LFOs' amount and rate; the pitch
   envelope's amount. The row's index is its target code everywhere: a song
   lane's slot maps to it, a note-on's step array carries one value per row
   in that order, and the voice keeps its values by it. A row carries its
   patch path, curve, `min`, `max`, `floor`, step `span` and `slideKeeps`.
   Display data (label, scale, unit) stays with the automation catalog and
   the app's step-lane labels, keyed by path. Their parity tests keep them
   in step with the table.
2. **Two curves.** `add` is `base + offset`. `ratio` is `max(base, floor) ×
   2^offset`, the offset in octaves. Both are then clamped to the row's
   bounds. A step value `v` in -1..1 is the offset `v × span` in the row's
   own curve, so a ratio row's span is in octaves. An offset of exactly 0
   leaves a value as it was.
3. **The cutoff is an ordinary ratio row reached through a slot.** The
   part's `cutoffMod` parameter, `CUTOFF_MOD_OCTAVES` and
   `CUTOFF_MOD_RANGE` are gone, and so is the cutoff's term in the filter's
   octaves. `FM_LANES_MAX` stays 8; the cutoff lane already counted against
   it. In the Formant mode a cutoff lane or step now does what the Cutoff
   knob does there, which is leave the peaks alone. The vowel lane moves
   them.
4. **One per-voice layout.** The voice holds `ownValues` (the patch's values
   with the note's step offsets, bound at a note-on, a retarget and a
   rebind) and `liveValues` (those with the part's lane offsets, each
   control block), both `Float64Array`s by code. `layoutVoiceTargets`
   (`voiceTargets.ts`) is the one place on the audio thread that maps a
   path to a code. Every consumer reads `liveValues`. The envelopes' decay
   time and curve, the feedback ramp and the LFOs' `rateMul` stay the
   special application points they were, driven from `liveValues`.
5. **A step pushes from where a lane holds the value.** Where a lane moves
   a target, `liveValues` is the lane's absolute value (the patch's value
   moved by the offset and clamped, as the main thread reckons it), with
   the step's push applied over it in the same curve. windsor#405 decided
   this for the decay times so that a push is heard over a lane, and over a
   patch decay of 0. It now holds for every row.
6. **Step lanes may name any target.** `StepModParam` became
   `VoiceTargetPath`, the table's path type. The song's step-lane
   validation, the sequencers and the app's picker accept every row. The
   new rows' spans follow the old rule, about half the knob's travel: the
   vowel 2, an LFO amount 0.5, an LFO rate half its log travel, the pitch
   envelope 48 semitones. None of them is `slideKeeps`.
7. **Formats.** Lane paths are unchanged and the set only widens, so
   `ARRANGEMENT_VERSION` is not bumped. The patch format is untouched. No
   migration is provided, following the greenfield direction.

## Consequences

- **The extension point.** Adding a target means a row in
  `voiceTargetTables.ts`, its look in `automationTargetTables.ts` and its
  label in the app's `stepModLaneTables.ts` (the parity tests fail until
  both exist), its field in `layoutVoiceTargets`, and a read of
  `liveValues` at its application point. Future sources address the same
  codes.
- **Renders without offsets are unchanged.** A part with no slot mapped and
  a note with no step offsets render bit for bit as before:
  `fmProcessorGolden` and `fmProcessorKernel` pass without a refresh.
- **Step values on a log row drift by float rounding.** The old `log` curve,
  `base × (max / min)^(v × span)`, is now `base × 2^(v × span′)` with
  `span′ = span × log2(max / min)`. That is the same curve, rounded
  differently. The goldens carry no step offsets.
- **A step on a decay time is heard over a patch decay of 0.** The old step
  curve scaled 0 to 0, and that clamped to 1 ms. The ratio curve takes the
  decay from its 1 ms floor, so a step of +1 over a decay of 0 plays about
  141 ms.
- **Clamping order changed where a step and a lane meet.** The old add rows
  added the lane to the clamped step value. Now the step pushes from the
  clamped lane value. The two differ only where a clamp bites.
- **The decay rows are bounded 1 ms to 20 s** in the table, the step-mod
  table's old bounds. The lane's old bottom of 0 was never reached, since a
  lane's ratio is taken from the 1 ms floor; the catalog still draws the
  lane from 0, with 1 ms as its display floor.
- **A ratio row's step readout is in octaves.** In the app, a decay time's
  step now reads `+2.5 oct` where it read the raw lane value.
