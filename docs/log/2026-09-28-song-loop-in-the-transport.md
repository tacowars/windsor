# The song loop lives in the transport, and the clock's counter wraps it

- **Date:** 2026-09-28
- **Status:** accepted and built in the engine (windsor#15). The loop
  button and the ruler brace are a separate issue.

## Context

Pat asked for a loop over a bar range that is saved with the song. While
the loop is on, playback wraps from the loop's end back to its start. Pat
set the musical decisions on the issue:

- It is saved as `transport.loop = { start, end, on }` in ticks. The range is
  normalised: start before end, both inside the song, snapped to at least a
  beat. A missing loop means off.
- ▶ starts at the loop's start while the loop is on, and ■ rewinds there.
- The wrap behaves like today's wrap at the song's end: notes that straddle
  the loop's end are released the same way.
- Shrinking Bars below the loop clamps it, or turns it off when nothing is
  left.
- It works with swing (windsor#14).

Windsor has one clock. `sequencing/scheduler.ts`'s `TickTransport` counts
ticks that never fold. Each part's region gate reads `tick mod songTicks`,
and so does the console's playhead.

## Decision

1. **The clock's counter jumps back at the loop's end.** `TickTransport`
   takes a `TickLoop { start, end, songTicks }`. `followingTick` issues
   `start` in place of the tick whose song position is `end`, which is the
   same place the song's end folds to 0. The counter still counts past the
   song's end as before, so a loop switched on while the playhead is past
   its end plays on to the song's end, folds to bar 1, and wraps from the
   loop's end after that. The transport's seconds keep running across the
   jump. The points sit on beats and every swing pair divides a beat, so
   swing keeps its phase across the wrap.
2. **A loop over the whole song is handed to the clock as nothing.**
   `tickLoopOf` returns null for a loop that is off, absent, or covers the
   whole song. That last case already happens through the song's own wrap,
   so it plays today's wrap bit for bit. That includes the ∞ region, which
   keeps free-running.
3. **The player treats the jump as every part's region entry.** It
   subscribes to the clock before any gate. On the loop's jump
   (`isLoopJump`), every pitched part releases what it holds on the new
   tick, and every gate forgets its region. The new tick is then an entry,
   and each part mints its stream again, as it does when a region is
   re-entered on the song's wrap. So every pass of the loop after the first
   plays the same notes, the ∞ line included. Any other discontinuity (a
   restart at another tick) is left to the caller, as before.
4. **The rest position follows the loop.** `Scheduler.loop` is live. While
   the scheduler is rewound and not started, setting the loop moves the
   rewound tick to the loop's start (or back to 0). `Scheduler.reset()`
   defaults to the loop's start. That puts ▶ and ■ on the loop's start with
   no change to `AudioSystem`. A paused (muted) transport keeps its tick.
   `audibleTick` reads the rewound tick before anything sounds.
5. **The stamps the playhead reads carry their tick.** `TickStamps` held
   stamps by tick number, which assumed ticks only increase. It now holds
   them in issue order, each with its tick. The fallback count-back starts
   from the oldest held stamp, so a jump queued after it is not counted.
   The app's playhead reads `audibleTick`, which is already inside the
   loop, so its `tick mod songTicks` rule stays as it is.
6. **One fitting rule, in `song/songLoop.ts`.** `fitLoopRange` orders the
   points, snaps them to the nearest beat (`LOOP_GRID_TICKS`), keeps at
   least a beat, and clamps them into the song. It returns nothing when the
   start is at or past the song's end. The document normaliser reports
   each repair and drops an empty loop, since absent means off. The player's
   live copy is re-fitted on every partial, so a live Bars edit plays what
   its normalised document will. The live copy always carries a loop (the
   whole song, off, when the document has none) so that a partial like
   `{ transport: { loop: { on: true } } }` has a field to merge into, as
   swing does.
7. **No format version bump.** The field is additive and a missing loop
   reproduces the old behaviour, so `ARRANGEMENT_VERSION` stays
   (`2026-09-28-format-versions-refuse-never-destroy`). A song without a
   loop imports and exports byte for byte as before.

## Consequences

- The first pass of a loop started from bar 1 can differ from the later
  passes for a generative part, because its stream was minted at its region
  entry, not at the loop's start. Every pass from the first wrap on is the
  same.
- The console's playhead and position readout need no change for the wrap.
  The button, the brace and any display of the range come from the separate
  UI issue, which reads `transport.loop`, `playStartTick` and `tickLoopOf`
  through the engine's index.
