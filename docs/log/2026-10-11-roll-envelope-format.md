# The Roll's clip envelopes in the song format

- **Date:** 2026-10-11
- **Status:** accepted with windsor#701 (the format seam of epic windsor#699)
- **Links:** issue windsor#701 · epic windsor#699 · the Roll record
  `2026-10-04-roll-sequencer` · the song lanes record
  `2026-10-01-song-automation-lanes` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

Epic windsor#699 gives the Roll clip envelopes, stored on the roll as
`RollSequencerConfig.envelopes`, and windsor#701 binds their shape: the
type, the ranges, the normaliser's repairs and an evaluator built on the
song lanes' `automationEvaluate.ts`. Building it raised three questions
the issue left open. This record settles them.

## Decisions

1. **A cap of 4096 points per envelope** (`ROLL_ENVELOPE_POINTS_MAX`,
   `sequencing/rollEnvelopeTables.ts`). windsor#701 asked for the song
   lanes' cap, but song lanes have none. 4096 is one point per sixteenth
   (6 ticks) across the longest loop (`ROLL_LOOP_TICKS_MAX`, 24576 ticks).
   The normaliser keeps the first 4096 after sorting, and reports the trim.
2. **Of two points on one tick, the normaliser keeps the later in the
   list.** At a song lane's step, the tick reads the later point's value,
   so keeping that point leaves the value at the tick and after it
   unchanged.
3. **The type and check stay on the generators' pure side; the evaluator
   does not.** `generatorBoundary.test.ts` holds `rollSequencer.ts` to
   imports from a pure set. `automation/automationLane.ts` and
   `automationEvaluate.ts` are outside that set, because `automationLane.ts`
   imports `automationTargets.ts` and so the insert registry. So:
   - `sequencing/rollEnvelope.ts` holds `RollEnvelope`,
     `ROLL_ENVELOPES_MAX` and `assertRollEnvelopes`, and joins the pure set.
     It restates the point as `RollEnvelopePoint` (`{tick, value, bend}`).
     That type has the same shape as `AutomationPoint`, so either type can
     stand for the other wherever a value is passed.
   - `sequencing/rollEnvelopeTables.ts` (the cap and `ROLL_ENVELOPE_ROW`,
     a linear −1..1 row) imports nothing, and joins the pure set.
   - `envelopeValueAt` lives in `sequencing/rollEnvelopeValue.ts` and calls
     `firstPointPast` and `valueAt` from `automationEvaluate.ts`, with no
     copy of the curve. It takes an optional third argument, `loopTicks`.
     Points at or past `loopTicks` are not read, and past the last point
     inside the loop the value holds.

## Consequences

- The song format change is additive, and `ARRANGEMENT_VERSION` is not
  bumped. A roll without `envelopes` is written exactly as before, and an
  empty list is written as no key.
- Envelope ticks strictly increase. A song lane's vertical step (two
  points on one tick, which the square shape stamps) does not fit in an
  envelope. When the UI tickets stamp shapes into an envelope, they must
  place a step's two points on different ticks (fractional ticks are
  allowed).
- `fitEmptyRoll` (app) treats a roll with no notes as empty even when it
  holds envelopes, so the loop still follows the region's length. Points
  left past a shrunk loop are kept and silent. The UI tickets can decide
  whether envelopes should count as content.
