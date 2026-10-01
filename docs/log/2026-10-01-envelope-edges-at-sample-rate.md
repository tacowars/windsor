# Operator envelope edges at their own samples

- **Date:** 2026-10-01
- **Status:** accepted (the decisions of windsor#301)
- **Links:** windsor#301 · the sound-match report on `tr808-kick` against
  `BD A 808 Decay C 06` (PR #292) · measurements in
  `docs/research/2026-10-01-fast-envelope-edges/README.md`

## Context

Every envelope advanced once per control block of `CTRL_INTERVAL` (32
samples), and the voice ramped each operator's amplitude linearly to the
block-end level, so no edge was faster than about 0.67 ms at 48 kHz,
whatever the envelope said. A segment that ended inside a block landed on
its target at the block's end, the next segment started at the following
block, and every segment had a floor of 0.5 ms (`MIN_SEG_TIME`). The 808's
opening click is the defining sound of the machine, and its first 5 ms
above 2 kHz sat far below the recording's; the same floor softened the
claps', rims' and claves' edges.

## Decision

1. **Envelope times mean what they say.** When an operator's amplitude
   envelope segment ends inside a control block, its per-sample ramp
   reaches that segment's target at the segment's own sample, then runs on
   the next segment's slope for the rest of the block. An attack of 0 is a
   step at the note-on sample; an attack of 0.1 ms peaks about 5 samples
   in. It holds for every segment: attack, decay and release.
   - The envelope keeps the remainder: a segment that ends 4.8 samples into
     a block hands the other 27.2 to the next (`Envelope.advanceExact`),
     where it used to start the next segment at the next block.
   - Each end inside the block is a **knot** at the nearest sample, at the
     segment's target times the operator's level, velocity, key scaling and
     LFOs for the block. An end that rounds to the block's first sample is
     a step before it; one that rounds to its end is left to the block-end
     level. Two ends on one sample keep the later.
   - A block records at most four ends (`ENVELOPE_BREAKS_MAX`): an attack,
     a decay and a release with one to spare. A later end in the same block
     is still timed; the last ramp runs across it to the block-end level.
   - The operator envelope has no floor: a segment of 0 ends on the sample
     it starts on. A block walks at most 64 segments
     (`ENVELOPE_PASSES_MAX`), so a looping envelope whose attack and decay
     are both 0 cannot spin.
2. **Cost:** one counter per operator (`ampBreak`, samples to the next
   knot) and its knot slot (`ampKnot`), and three preallocated rows of four
   knots per operator, in the voice. The sample loops test the counter
   after each amplitude step and, at a knot, land on its level and take the
   next ramp. The generic loop and the kernel do the same operations in the
   same order (the kernel's knot test also keeps an operator with a knot
   ahead out of its silent-operator skip). Allocation free: the envelope
   keeps its remainder in a field, since a loop-carried local born of the
   integer `n` was a tagged phi that V8 boxed on each pass (found by
   `fmProcessorAllocation.test.ts`'s burst run). Measured against main in
   the research note.
3. **The pitch envelope, filter envelope and LFOs stay at control rate**,
   with their old timing: `Envelope.advance` is unchanged, the 0.5 ms floor
   included.
4. **Library sound changes are expected, and listed** in the research note
   with each patch's peak difference and its change above 2 kHz in the
   first 5 ms. No patch was changed to hide one. The goldens are refreshed.
5. **No format change.** The fields are unchanged; only their timing is
   exact. Neither `PATCH_FILE_FORMAT` nor `ARRANGEMENT_VERSION` moves.

## Consequences

- A block in which no operator segment ends renders as before, to the bit:
  `advanceExact` takes `advance`'s one phase step and the ramp is the old
  `(target - amp) / n`. 55 of the factory bank's golden renders, the pads
  and score patches whose segments end outside the golden's window, kept
  their hashes.
- A segment longer than a block now also ends at its own sample, and the
  next segment starts there rather than at the next block, so a patch whose
  long segments end inside blocks moves too, by a fraction of a millisecond
  of timing. Strictly, decision 1 changes those patches as well, so "a patch
  with no sub-block segment is bit-identical" holds only where its segment
  ends fall outside the render or on block boundaries; the research note
  lists every patch that moved, and by how much.
- The note-off is still read at the next control block; a fast release
  starts there.
