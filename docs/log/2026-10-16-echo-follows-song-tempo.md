# The Echo follows the song's tempo, synced at a dotted eighth by default

- **Date:** 2026-10-16
- **Status:** proposed in windsor#816; accepted when tacowars approves the PR
- **Links:** windsor#816 · the Echo insert (windsor#171) · song automation
  lanes `2026-10-01-song-automation-lanes` · the Pump's synced length
  `2026-10-13-pump-insert` · format rules
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

The Echo's card had a "Sync to N bpm" picker. It worked out the time in
seconds when the user picked a note value and saved that number. A later
tempo change left the repeats off the beat until the note value was picked
again. Dub Delay and the Pump already follow the song's tempo. Send B
carries an Echo in every song, so the same behaviour should be the default
there, and following the tempo must cost nothing per block.

## Decisions

1. **The spec gains `sync` and `division`.** `EchoSpec` gains
   `sync: boolean` and `division`, a key of Dub Delay's `DELAY_DIVISIONS`
   (beats per note value, `D` dotted and `T` triplet), which Echo imports
   unchanged. `delayTime` stays in seconds as the free time. A synced Echo
   keeps it, so turning Sync off brings it back, and a free Echo keeps its
   `division`. `DEFAULT_ECHO` is `sync: true, division: '1/8D'`, so a new
   Echo and Send B's default play a dotted eighth: 0.375 s at 120 bpm. While
   synced the loop plays `60 · beats / bpm`, clamped to the line's 5 s, and a
   BPM that is not a positive number reads 120 (`echoTempo.ts`'s
   `echoSeconds`). The tempo arrives through the stage's `setTempo`, which
   `tempoInsertRegistry.ts` already calls when the stage is created, when a
   song loads and on every apply. The stage is still native nodes, and a
   tempo change writes one param.
2. **Old songs load free, with no format bump.** In `normalise`, an absent
   `sync` reads `false` and an absent `division` reads `'1/8D'`, so an Echo
   saved before this change plays its saved seconds exactly as before. The
   fields are additive and their absent defaults reproduce the old
   behaviour, so `ARRANGEMENT_VERSION` is not bumped and there is no
   migration. Only `normalise`'s default for an absent `sync` differs from
   `DEFAULT_ECHO`'s, and a comment there says so.
3. **A time change while synced glides.** A tempo change, a note value
   change, or turning Sync on moves the delay line's `delayTime` with
   `setTargetAtTime`, with a time constant of `ECHO_SYNC_GLIDE_S` (60 ms, the
   same as Dub Delay's time smoothing), rather than jumping. The repeats bend
   in pitch for a moment instead of clicking. `setTempo` writes nothing when
   the BPM has not changed, when Sync is off, or when the clamped time has
   not moved. The free knob, and its lane, write the time at once as before.
4. **The Time lane is offered only while Sync is off.** This follows the
   Pump's Length. In `automationInsertTables.ts`, Echo's Time row is wrapped
   in `when(..., (spec) => !spec.sync)`, and the Song tab's inactive-lane
   note reads "the Echo is synced". The note value is not a target, as
   record `2026-10-01-song-automation-lanes` decision 2 already says of
   stepped and chosen fields. If a lane is drawn in free mode and Sync is
   turned on afterwards, the lane stays as it is and goes inert. No code
   converts it.

## Consequences

- Send B's default sound changes from a 280 ms repeat to a synced dotted
  eighth. A song saved before this change keeps its 280 ms (decision 2).
- The switch's wait for the loop to empty (`echoSwitchSettle.ts`) reads the
  time the loop plays, which while synced is the note value's length at the
  current BPM, not `delayTime`.
- The card has a Sync switch beside Time. While synced, Time is a stepped
  knob over the sixteen note values in length order, labelled with the note
  value (`1/8D`), and its title gives the length in ms at the song's BPM.
  The "Sync to N bpm" picker is gone. The return's tempo buttons
  (`returnControls.ts`, `TEMPO_DIVISIONS`) are unchanged.
