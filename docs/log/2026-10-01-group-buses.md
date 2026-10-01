# Group buses

- **Date:** 2026-10-01
- **Status:** accepted (tacowars, 2026-10-01)
- **Links:** epic windsor#283 · the issues are listed at the end

## Context

A part's Output offers two choices, Master and Sidechain only
(`2026-09-23-667-post-fx-sidechain-routing`). Every part that is heard
goes straight into the music bus. Drums are usually processed as one
instrument: the kick, snare, hats and percussion are summed and run
through one compressor, tape and EQ, so they move together. Windsor
can't do that today. The only shared chains are Send A and Send B, and
they hold a copy of the signal at an amount, which suits a reverb, not a
drum bus.

The word "aux" is already taken: aux parts and the aux fader carry the
audition and the UI's sounds outside the song
(`2026-09-27-aux-bus-replaces-the-game-sfx-route`). The new bus is
called a **group**.

## Decision

1. **A group is an Output choice, not a send.** A part routed to a group
   sends its whole dry signal there instead of to the music bus:
   post-fader, post-low-cut, post-insert and post-pan. The part's own
   inserts process it before the group hears it.
2. **The song owns its groups.** A new song has none. Groups are added,
   renamed and removed on the Mixer tab, up to `MAX_GROUPS`, which is 8.
   Each has a stable numeric `id`, so a rename touches nothing else, and a
   name that is only a label.
3. **A group strip** has a level, a pan, mute, solo, an insert chain of up
   to `MAX_INSERTS` from the same registry as a part's, and a peak meter.
   It has no low cut, because the EQ insert does that, and no sends.
4. **The signal path:**

   ```
   part fader ─▶ low cut ─▶ part inserts ─▶ gate ─┬─ pan ─▶ group input ─▶ group inserts ─▶ pan ─▶ level ─▶ gate ─▶ music bus
                                                  └─ sends ─▶ Send A / Send B (as today)
   ```

   A group feeds the music bus, so it gets the music bus's 30 Hz highpass
   as an ungrouped part does. A group can't feed another group.
5. **A grouped part keeps its own sends,** taken before the group as they
   are now. A snare can have more plate than a kick, and the group's
   compressor doesn't change what the reverb hears.
6. **Mute and solo cover the group:**
   - Muting a group silences its members, their sends included, so a
     muted drum group leaves no reverb behind.
   - Soloing a group counts as soloing every member.
   - Soloing a member keeps its group open. The other members are soloed
     out as usual.
   - A sidechain key is tapped before every gate, as now, so none of this
     changes what a detector hears.
   - The one solo rule (`soloRule.ts`) decides this for playback and for
     renders, so they can't disagree.
7. **Deleting a group sends its members back to Master** in the same undo
   step. A document whose part names a group that doesn't exist loads
   with that part on Master and a correction, and is never refused.
8. **Sidechains stay with the parts in this epic.** A compressor on a
   group keys from its own input, as a send bus's does, and a group is
   not offered as a sidechain source. Group sidechains are a later epic.
9. **Stems:** each group renders one stem, after its inserts, pan and
   level, through a copy of the music bus's highpass, as a part's stem
   does. Its members get no stem of their own, so the stems still add up
   to the master with its inserts and output stage bypassed.
10. **The UI:**
    - A **Groups** section on the Mixer tab, after the send buses. Each
      group is a row like a send bus's: a head with the name, Level, Pan,
      M, S, the activity and clip lights, the members and Remove, beside
      its insert chain. "Add group" sits under the last one.
    - The part's Output select on the Song tab lists Master, then the
      groups in order, then Sidechain.
    - Groups get no row in the Song tab's lanes in this epic.
11. **The format.** The document gains a `groups` list, and a strip's
    `output` gains `{ group: <id> }`. Both are additive, and an absent
    `groups` with every Output on Master or Sidechain plays as it does
    today, so `ARRANGEMENT_VERSION` doesn't change
    (`2026-09-28-format-versions-refuse-never-destroy`).

## Consequences

- The solo rule now looks at groups as well as parts. Every caller of
  `isHeard` passes the document's groups.
- Changing a part's Output moves the edge from its pan to the new
  destination inside a fade, so switching the group doesn't click.
- A group with no inserts costs a few native gain nodes. A group's
  inserts cost what the same inserts cost on a part.
- Group sidechains, groups feeding groups, group sends and group rows on
  the Song tab are left for later.

## Issues

- windsor#284: the `groups` format, the group Output and the solo rule
  (seam)
- windsor#285: group buses in the engine's graph
- windsor#286: one stem per group
- windsor#287: the Groups section on the Mixer tab, and groups in the
  Output select
