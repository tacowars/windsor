# Group automation lanes, and groups as folder tracks on the Song tab

- **Date:** 2026-10-05
- **Status:** accepted; the engine seam is windsor#614, the Song tab follows
  in its own tickets.
- **Links:** this record's issue, windsor#614 · the lanes record
  `2026-10-01-song-automation-lanes`, whose decision 2 this record
  supersedes for groups · the group buses record `2026-10-01-group-buses` ·
  format rules in `2026-09-28-format-versions-refuse-never-destroy`

## Context

A song's automation lanes belong to its parts
(`2026-10-01-song-automation-lanes`). Decision 2 of that record put no
lanes on returns, groups or the master. A group bus (windsor#285) has its
own fader, pan and insert chain, and a fade or a filter sweep across a
whole drum kit is what a group is for. On the parts alone, that takes one
lane per member, kept in step by hand.

The Song tab draws one row per part. Groups have appeared only in the
mixer. A group with lanes needs a row of its own, and the members belong
under it, as a DAW's folder track holds its tracks.

This record lifts the "no lanes on groups" line of decision 2 for groups
only. Returns and the master stay without lanes. The lanes record is
history and is not edited.

## Decisions

1. **Lanes live on the group.** `GroupSpec.automation?: readonly
   AutomationLane[]` (`mixer/mix.ts`), the lane type a part carries in
   `DocumentPart.automation`. A group partial's `automation` replaces the
   whole list, as a part's does. The field is additive: absent means none,
   so a song without group lanes writes exactly what it wrote before, and
   `ARRANGEMENT_VERSION` does not change.
2. **Targets are owner-relative, a subset of a part's.** A group lane
   targets `strip.level`, `strip.pan`, or `insert.<insertId>.<field>` on
   one of the group's own inserts. A group has no sends, voice, macros or
   sequencer, so `strip.send.*`, `voice.*` and `seq.*` are not group
   targets (`GROUP_STRIP_TARGETS`, `isGroupTarget`). The ids, rows, bounds
   and scales are the catalog's existing ones (`automationTargets.ts`).
   There is no new id syntax.
3. **Normalising.** `normaliseGroups` normalises each group's lanes with
   `normaliseAutomation`, against the group's normalised inserts and the
   song's length, as a part's are. A lane whose target is not a group
   target is dropped with a correction, as is a lane on an insert the
   group does not hold and a non-list `automation`. There is no lane cap:
   the cap of 8 is for FM voice lanes, which a group has none of.
4. **The player keys lanes by owner, not slot.** `AutomationPlayer` and
   `AutomationResolver` take an owner, `{ part: slot } | { group: id }`
   (`automation/automationOwner.ts`), instead of a bare slot, so a part and
   a group whose numbers are equal never share lanes. The timing rules of
   the lanes record's decision 8 are unchanged and apply to group lanes as
   they are: the hold at a start, a seek, a stop, the loop's jump back, a
   tempo change and a live edit.
5. **The group bus gets handles.** `GroupBus.automation(field)` hands out a
   handle for its level and its pan, built as `PartStrip.automation` builds
   a strip's, so a knob never fights a lane. Its insert lanes resolve
   through `insertAutomationHandle` on the group's own stages. That
   function now takes an `InsertHost` (the specs and the stages), which a
   part's strip and a group bus both are; the part path behaves as before.
6. **Live edits follow the part rules** (`system/songAutomation.ts`):
   - a group added gets its lanes held;
   - a group removed is forgotten, and its lanes go with it;
   - a group's `automation` replaces its lanes;
   - a group's insert list changing drops the lanes of inserts it no longer
     holds and restarts the rest;
   - a structural insert rebuild restarts the group's lanes once the fade
     lands (`GroupBus` tells `insertsRebuilt`);
   - a length edit refits a group's lanes, as it refits a part's.
7. **Membership does not touch lanes.** Routing a part into or out of a
   group changes nothing in the group's lanes, and nothing in the part's.
8. **On the Song tab, a group is a folder track.** This is the design the
   UI tickets build:
   - The group's header row sits at its lowest-slot member, and its members
     are indented under it in slot order.
   - The header's lane shows the union of its members' regions, read only.
   - The header has two folds: one for its own lanes and one for its
     members.

## Consequences

- **Supersedes** the "groups" part of `2026-10-01-song-automation-lanes`
  decision 2. Returns and the master still carry no lanes.
- **The engine index exports** the owner type (`AutomationOwner`,
  `partOwner`, `groupOwner`, `isGroupOwner`) and the group targets
  (`GROUP_STRIP_TARGETS`, `isGroupTarget`), so the app's lane picker can
  offer a group exactly the targets the engine plays.
- **`AudioSystem`** reads a group's lanes with `groupAutomationLanes(id)`
  beside `automationLanes(slot)`, and takes `automation` out of a `groups`
  partial before the group desk reads it, as it does for a part.
- **Offline render and stems need no change.** A group's stem is taken
  after its level and pan, so it hears the group's lanes from tick 0, as
  the master does.
- **Nothing can be clicked or heard** until the Song tab's folder tracks
  land; a song carrying group lanes plays them already.
