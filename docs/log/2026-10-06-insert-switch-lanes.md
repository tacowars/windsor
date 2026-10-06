# Insert switch lanes: every insert's on/off on a song lane

- **Date:** 2026-10-06
- **Status:** accepted; the engine seam is windsor#628. The click-free switch
  follows in windsor#629 (the native-node inserts) and windsor#630 (the
  worklet inserts), and the lane's look in windsor#631.
- **Links:** windsor#628 · the lanes record
  `2026-10-01-song-automation-lanes`, whose decision 2 this record amends ·
  the group lanes record `2026-10-05-group-automation-folder-tracks` ·
  format rules in `2026-09-28-format-versions-refuse-never-destroy`

## Context

Decision 2 of `2026-10-01-song-automation-lanes` made each insert's
continuous fields lane targets and left enums, switches and stepped fields
out, to keep version 1 small. Every insert has an on/off switch
(`enabled`), and switching an effect in and out on the beat (a reverb
thrown on the last hit of a bar, a filter on for a break) is a common move
that took a second chain or a hand on the button.

This record lifts the "no switches" line of decision 2 for each insert's
`enabled` alone. Every other switch, enum and stepped field stays out. The
lanes record is history and is not edited.

## Decisions

1. **A new scale, `switch`.** `AutomationScale`
   (`automation/automationLane.ts`) gains `'switch'`. A switch row runs from
   0 to 1 and reads `Off` / `On` (`switchReading`,
   `automation/automationDisplay.ts`). In display space off is the bottom
   and on the top, and a height at or above `AUTOMATION_SWITCH_ON_AT` (0.5)
   reads back as on.
2. **A switch lane holds; it never ramps.**
   - `valueAt` and `segmentValue` give the value of the last point at or
     before the tick, and ignore `bend`. `rampsBetween` gives only the
     points, never a cut inside a segment.
   - The player schedules only `set` for a switch lane, never `ramp`, a
     step's two points included.
   - The normaliser snaps a switch lane's values to 0 or 1 (0.5 and above
     is 1) and its bends to 0, each with a correction.
3. **One row for every kind, added in one place.** `insertKindFields`
   (`automation/automationInsertFields.ts`) appends `INSERT_SWITCH_ROW`
   (`enabled`, label `On`, scale `switch`) to every insert kind whose spec
   has `enabled`, which is all thirteen. `automatableInsertFields` and the
   catalog's lookups (`insertTargetRow`, the target id parser) read it from
   there. `INSERT_AUTOMATION_FIELDS` keeps listing continuous fields only,
   and its header says where `enabled` comes from. Every other `available`
   predicate is unchanged: a field the insert reads only while on stays
   available while off, and the switch is always available.
4. **Handles write what `set` writes for `enabled`, at once.**
   - A worklet kind's lane writes its `enabled` k-rate param, 0 or 1. Its
     `paramOf` names `enabled` as a field (`ownParam`, and the Advanced
     Drive's and the EQ's own).
   - A native kind folds `enabled` into the gains `set` writes for it:
     Classic Drive's wet and dry, Echo's send, wet and dry, Chorus's and
     Ensemble's wet and dry, Plate's send, gate and bypass. Where Mix (or
     Drive, or Width) writes the same gain, the gain goes through the
     shared-param schedule (`inserts/sharedParamSchedule.ts`), which now
     takes two or more fields, so it gets `set`'s own value at each
     breakpoint of any of them. A Drive's wet gain reads Drive, Mix and the
     switch.

   A switch lane is exactly as click-free as the button is today. The
   click-free fade is windsor#629 and windsor#630.
5. **While a lane holds `enabled`,** `set` leaves those params alone (the
   existing `automated` lock), and the release writes the spec's `enabled`
   back. A knob edit to another field of a gain the switch shares (Mix
   beside a switch lane) is that field's new resting value, so the shared
   schedule is written again from the audio clock's now: the edit is heard
   at once, and the lane's later breakpoints still apply.
6. **The fade's constant lands here.** `INSERT_SWITCH_FADE_S = 0.005`
   (`inserts/insertConstants.ts`), unread until windsor#629 and windsor#630
   read it, so those two never edit the same constants file.
7. **Format.** The `switch` scale and the `enabled` target are additive. A
   song with no switch lane serialises byte for byte as it did, and
   `ARRANGEMENT_VERSION` does not change.
8. **What switching off does (tacowars, 2026-10-06).** Switching an insert
   off cuts the effect, its tail included, over a 5 ms fade, and switching
   it on fades it back over the same. It is one constant for every insert
   (decision 6). The native-node inserts get it in windsor#629 and the
   worklet inserts in windsor#630.
9. **The lane's look (windsor#631).** The lane picker lists `On` with each
   insert's continuous fields, on a part and on a group. The lane is drawn
   at two levels, Off and On, with no ramps and no bend handle, and drawing
   writes each change as a step. While a lane holds the switch, the
   insert's power button locks as an automated knob does. The lane reuses
   the existing lane look and the button the knob lock's look, with no
   mockup; tacowars judges both on the PR preview.

## Consequences

- **Amends** `2026-10-01-song-automation-lanes` decision 2: each insert's
  `enabled` is a target. Other switches, enums and stepped fields are not.
- **The engine index exports** `switchReading` and `switchValue`, so the
  app's readout and drawing read a switch as the engine does.
- **Until windsor#631 lands,** the app's picker already offers `On` for
  each insert, since it lists `automatableInsertFields`. A lane on it is
  drawn with the plain lane look, a straight line between its points, and
  its readout is a number (`1.00`), while the engine holds each value to
  the next point; a drawn height lands on 0 or 1 (`fromDisplay`).
- **Offline render needs no change.** It pumps the same clock, so a switch
  lane's sets land in a render as they do live.
