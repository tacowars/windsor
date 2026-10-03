# The Grid offers no gate lane

- **Date:** 2026-10-03
- **Status:** proposed, for tacowars's review in windsor#488's PR
- **Links:** windsor#488 (sequencer parameters as lane targets) · the epic
  windsor#483 · `2026-10-03-figure-sequencer` decision 7

## Context

windsor#488's decision 1 and the Figure record's decision 7 give the
Figure, the Grid and the Arp `seq.gate` and `seq.skipChance` lanes. A lane
moves a field the generator already reads: "a generator reads
`event.overrides.gate ?? config.gate` where it reads the field today".

The Grid has no gate. Its config carries no `gate` field, and a Grid note
holds until the next note or rest on the line (#602), with a tie
continuing it. There is no read site for a gate lane to move.

## Decision

`SEQ_AUTOMATION_FIELDS` gives the Grid `skipChance` alone. The normaliser
drops a `seq.gate` lane on a Grid part with a report, as it does a
`seq.density` lane. The Figure and the Arp keep both, and the Bass keeps
`gate` and `density`, as the issue says.

A Grid gate would be a new behaviour, not a lane over an old one: where a
gated Grid note ends, what a tie and a slide do under it, and what a
ratchet's last hit holds for. If tacowars wants one, it is a Grid change
first (a `gate` field, default 1 reproducing today's legato), and then
the lane is one entry in the table.

## Consequences

- The console's picker (windsor#491) lists Skip for a Grid part and no
  Gate.
- Adding a Grid gate later bumps nothing: an additive field whose default
  is today's behaviour, and a table row.
