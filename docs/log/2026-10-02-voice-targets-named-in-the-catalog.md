# Voice targets are named in the automation catalog

- **Date:** 2026-10-02
- **Status:** accepted and built (windsor#424, windsor#426)
- **Supersedes:** the "label in the app's `stepModLaneTables.ts`" part of
  the extension-point consequence in `2026-10-02-one-voice-target-table`

## Context

`2026-10-02-one-voice-target-table` kept each voice target's display data
in two places: its look in the automation catalog and a second label in
the app's `stepModLaneTables.ts`, held together by a parity test.
windsor#424 deleted the app's label table, so the step-lane header now reads
the catalog. The record still names the deleted table as part of the
extension point. The app and the engine tests also spelled the voice
target id format (`voice.<path>`) by hand, and the step lanes looked a row
up by scanning the whole target table.

## Decision

1. **One name source.** A voice target's name, scale and unit live in the
   automation catalog: `VOICE_LOOKS` and `OPERATOR_LOOKS` in
   `automation/automationTargetTables.ts`. Song lanes, step lanes and the
   picker all read them through `catalogRow`.
2. **One id format.** `automation/automationTargets.ts` owns the voice
   target id. `voiceTargetId(path)` builds one and `voicePathOf(id)` reads
   the path back, beside `parseTargetId` and `formatTargetId`, and that
   file also puts each look under its id as `VOICE_AUTOMATION_ROWS`.
   `VoiceTargetId` is typed from the same prefix.
3. **One row lookup.** `voiceTargetRow(path)` in
   `worklet/fm/voiceTargetTables.ts` returns the table's own row through
   the path-to-code lookup, allocating nothing.

## Consequences

- **The extension point.** Adding a target means a row in
  `voiceTargetTables.ts`, its field in `layoutVoiceTargets`, its look in
  the catalog's `VOICE_LOOKS` or `OPERATOR_LOOKS`, and a read of
  `liveValues` at its point of effect. There is no app label to add.
- A label must fit the Grid's step-lane header as well as the Song tab's
  lane header. `Filter Env Amt` became `Filt Env Amt` for that reason.
