# Reordering inserts moves the live stages, inside a fade

- Date: 2026-09-22
- Area: audio
- Links: issue #652 · takes up the reordering `2026-09-22-641-strip-inserts-over-a-code-owned-registry` punted · amends `2026-09-22-639-sends-tap-the-strip-tail`

## Decision

A strip's inserts can be reordered from the Mixer tab: each insert box carries
a ◀ and a ▶ beside its name, disabled at the ends, and a press sends the whole
reordered list like every other insert edit. The boxes read left to right in
signal order.

1. **A reorder moves the stages; it does not rebuild them.** When the next list
   is a **permutation of the live kinds**, `InsertChain.set` re-uses the live
   stages, matching each spec to the first unclaimed stage of its kind, and
   only re-wires. A chorus therefore keeps its delay contents and its LFO
   phase, where a rebuild would restart it silent and cost a new set of nodes.
   Two inserts of one kind keep their relative identity, and the settings move
   over them.
2. **Every structural edit happens in silence.** Re-wiring steps the waveform,
   which is a click. The tap gained one `GainNode` at its head, which every
   tapped path passes through; an add, a removal or a reorder ramps it to 0
   over `INSERT_FADE_SECONDS` (12 ms), re-wires once the ramp has landed, and
   ramps back up.
   - **This is a node in the dry path**, which §3 of the 2026-08-31 mixer
     record reserves against *the fader*. It is not the fader, which is still
     the part's k-rate `gain` inside the worklet. It is what makes a structural
     edit quiet, and it costs one multiply per block. It also makes moving the
     tail one edge rather than one per send.
   - The re-wire has to happen after the ramp lands, so it is deferred.
     `routePart` takes the timer (`RouteOptions.defer`, `setTimeout` by
     default), and `AudioSystem` passes its own through, so tests run it
     immediately and assert the settled graph.
   - **Presses coalesce.** While a fade is in flight, a further list replaces
     the one waiting rather than starting a second fade. Inside that window
     even a list matching the *live* order waits, because the chain has not
     moved yet and "matches" would report the pre-edit order — that was a real
     bug the coalescing test caught.
   - A settings-only change is still a plain param write, with no ramp.
3. **An unknown kind is refused on the caller's stack**, before the fade
   starts, rather than throwing inside a timer.
4. **The strip's parts are now three files.** `channelStrip.ts` kept growing,
   so the tap is `stripTap.ts` and the chain is `insertChain.ts` (which also
   holds the fade's `createInsertUpdater`). Test scaffolding moved to
   `__fixtures__/stripRig.ts`, and the reorder tests are `insertReorder.test.ts`.

## Why

Pat, 2026-09-22: "lets say I add chorus and then I want distortion, it adds it
in that order, but usually I would prefer distortion to come before chorus",
and "if we can avoid nasty clicks or pops when doing so that would be good
too". Remove-and-re-add loses the settings, so the arrows are the least
fiddly control that does the job.

Reusing the stages is what makes a reorder cheap and quiet: no node is built,
none is disposed, and a running chorus does not restart. The fade is the
honest answer to the click, because no amount of re-wiring order removes the
discontinuity — only silence around it does.

## Punted / alternatives

- **Drag to reorder.** Two arrows are enough at two inserts per strip, and
  they keep the keyboard path.
- **Crossfading the two orders** instead of fading to silence. The orders
  share the very same nodes, so both cannot be live at once.
- **A fade on a settings change.** Not needed: no edge moves.
- **Tuning the fade length.** 12 ms each way is a guess that measured quiet;
  if a mix edit ever feels sluggish, the constant is one number.
