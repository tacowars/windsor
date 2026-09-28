# Song swing lives in the transport, as a time warp in the one clock

- **Date:** 2026-09-28
- **Status:** accepted and built in the engine (windsor#14). The header
  control is a separate issue.

## Context

tacowars asked for one global swing that reaches every part and is saved with
the song. Windsor has a single clock: `sequencing/scheduler.ts`'s
`TickTransport` counts 24 PPQ ticks, and the `Scheduler` stamps each one
with an audio-clock time. Every generator reads that clock through its
region gate. So swing can live in one place.

tacowars set the musical decisions on the issue:

- The grid is selectable, 8ths or 16ths. Swing delays the second of each
  pair.
- The amount follows the MPC convention and runs from 50 to 75: the
  off-beat lands at `amount`% of the pair. 50 is straight, 66.7 is a
  triplet feel, and 75 is hard.
- It is saved as `transport.swing = { amount, grid }`. A missing or invalid
  value plays straight (`{ amount: 50, grid: 16 }`).
- It applies to every part, with no per-part opt-out.

## Decision

1. **Swing is a piecewise-linear warp of tick positions within each pair**
   (`sequencing/swing.ts`, tunables in `sequencing/swingTables.ts`). A pair
   of `P` ticks (24 for 8ths, 12 for 16ths) splits at its midpoint. Each
   tick interval in the first half lasts `2a` straight ticks, and each in
   the second half lasts `2(1 - a)`, where `a = amount / 100`. The off-beat
   lands at `a·P` and the pair still totals `P`. At 75 the slowest interval
   is 0.5 of a straight tick, so the map is strictly monotonic. A note off
   the grid (an arp, a Euclidean onset, a chord event) moves in proportion
   and never passes its neighbour.
2. **The clock accumulates the warped intervals.** `TickTransport.advance`
   and `Scheduler.update` add `secondsPerTick × swingSlope(tick)` per tick.
   They do not add a displacement to a straight time. So a tempo change,
   even mid-pair, can never make a later tick sound earlier. The phase is
   the tick's, and a song is a whole number of bars that every pair
   divides. That keeps pair boundaries on the grid through a tempo change
   and the song-end wrap. No allocation per tick.
3. **Straight is the old clock, bit for bit.** At 50 every slope is exactly
   `1`, and `swingTicks`/`unswingTicks` short-circuit to the identity. The
   stamps, `event.seconds` and `audibleTick` are therefore the same numbers
   as before. The goldens and player tests are unchanged.
4. **`audibleTick` reads the stamps that were actually issued.** The
   scheduler records each tick's time in a preallocated ring
   (`sequencing/tickStamps.ts`, sized in `schedulerConstants.ts`). The
   playhead is the last recorded tick whose stamp has passed. A live swing
   or tempo change therefore moves only the ticks queued after it, and the
   playhead never runs backward while the old queue drains. Before a run's
   first tick sounds, it falls back to counting back from the queue's head
   through the inverse warp.
5. **A resume keeps the accumulated song time.** `Scheduler.start` at the
   tick where the queue stopped leaves the transport's seconds alone. Those
   seconds carry every swing and tempo already played, and the Euclidean
   LFO reads them. Only a start at another tick (a seek or a stop) recomputes
   them, under the current swing. `TickTransport` clamps every swing handed
   to it through `playableSwing`, whether through the constructor, the
   `Scheduler` options or the setter.
6. **In the document, absent stays absent.** `transport.swing` is optional
   in the `Transport` type. The normaliser writes it only when the document
   has one. A song from before swing therefore imports and exports byte for
   byte as it came, and plays straight. A present swing has its amount
   clamped to 50–75 and its grid checked against 8|16, and each repair is
   reported as a correction.
7. **The player always carries a swing.** `ArrangementPlayer` writes
   straight into its live copy when the document has none, so a live
   partial such as `{ transport: { swing: { amount: 62 } } }` has a field to
   merge into, either field alone. It hands the clock
   `playableSwing(merged.transport.swing)`, which clamps whatever the clock
   could not play. A partial that bypassed the normaliser therefore cannot
   make an interval zero or negative.
8. **What the app gets.** `@windsor/engine` exports the `Swing` and
   `SwingGrid` types, `STRAIGHT_SWING`, `SWING_AMOUNT_MIN` and
   `SWING_AMOUNT_MAX`, and `SWING_GRIDS`. A live edit is
   `ctx.change({ transport: { swing: { amount, grid } } })`. A reader of a
   document takes `transport.swing ?? STRAIGHT_SWING`.

## Consequences

- `event.seconds` is warped too. The Euclidean LFO reads it and stays
  continuous. `event.secondsPerTick` stays the straight tick length.
- A swing edit mid-pair gives that one pair a length other than `P`. This
  is like a tempo change: tick phase is unaffected, and every later pair is
  exact again.
