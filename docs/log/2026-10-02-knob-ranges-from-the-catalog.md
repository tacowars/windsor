# Knob ranges and picker groups come from the catalog

- **Date:** 2026-10-02
- **Status:** accepted and built (windsor#436)
- **Supersedes:** for the voice rows, the parity-test arrangement of
  `2026-10-01-song-automation-lanes` decisions 5 and 6, which held each
  voice row to a range the app's knob table stated a second time

## Context

The automation catalog (`VOICE_AUTOMATION_ROWS`) already gives each voice
target its range, scale and name (`2026-10-02-voice-targets-named-in-the-catalog`).
The app still stated two of those things again. `patchKnobTables.ts`
repeated the min, max and curve of every knob over a voice target, and
`automationTargetParity.test.ts` kept the two in step. The song-lane picker
sorted voice rows into groups with prefix tests and a regex over each
row's id.

## Decision

1. **A Parts-tab knob over a voice target takes its range from the
   catalog row.** `knobRangeOf(row)` (`packages/app/src/patchKnobRange.ts`)
   gives the row's `min` and `max`, a log knob for any scale but `linear`,
   and the row's `floor` as `logFloor` where the row has one. The table
   entry keeps only the label, the step and the readout. An entry that
   serves every operator or envelope slot takes operator A's row, since
   the target table builds every operator's rows from one. A test holds
   each knob to its own path's row and pins every range.
2. **The picker's groups come from the catalog.** Each voice row carries
   its patch `path` and its `section` (the filter, operator *i*, the LFOs
   or the pitch envelope), read from the target table's code layout. The
   app maps a section to its group label and lists the groups in the
   catalog's order.

## Consequences

- Adding a voice target no longer touches `patchKnobTables.ts` or
  `songAutomationTables.ts`, unless the target is a brand-new knob.
- The voice half of `automationTargetParity.test.ts` is gone; the strip
  half stays, since the mixer knobs still state their own ranges.
