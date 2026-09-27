# Drum patches: kick bodies at ratio 0.25, two-noise voices on a D..A algorithm

- Date: 2026-09-18
- Area: audio
- Links: `docs/design/drum-bank.md` · `2026-09-15-561-patch-library-file-shape`
  · #587 (Coarse / Fine) · #548 (the fixed-index kernel)

## Decision

The 37-patch drum bank (`tr808-*`, `tr909-*`, `efm-*`) is authored against
two engine and console facts rather than around them:

1. **A note-tracking drum body never goes below ratio 0.25.** The console's
   Coarse / Fine pair floors the stored ratio at `RATIO_MIN` 0.25 and
   `ratioSplit.test.ts` round-trips every library ratio through `join`, so a
   52 Hz body on C4 (ratio 0.199) cannot be a factory patch. Kick and tom
   bodies sit at ratio 0.25 (65.4 Hz on C4) and the descriptions name the
   note that gives the machine's pitch: A3 for the 808's 55 Hz, G#3 for the
   909's 52 Hz. The percussion default note stays C4.
2. **A voice with two Noise operators uses algorithm 0, 3 or 8.** The
   worklet draws both from one per-voice stream in evaluation order, and the
   fixed-index kernel only takes such a voice when the topological order is
   D..A; `fmProcessorKernel.test.ts` holds every factory patch to the kernel.
   The 808 and 909 claps (burst noise plus tail noise) sit on algorithm 8,
   Series + Tap, with A and B as the two carriers and C, D silent. A patch
   that needs three carriers and two noises (the first draft of the 909
   snare) is reshaped to one Noise operator instead.

## Why

Both constraints are the console's and the engine's promises, not the
bank's: a ratio the knobs cannot show would export as 0.25 the first time
Pat touched it, and a patch that silently took the generic loop would be the
one factory sound the kernel test does not cover. Naming the note that gives
the machine's pitch costs nothing musically — a drum part plays whatever
note its grid says — and keeps the library's invariants intact.

## Punted / alternatives

- Lowering `RATIO_MIN` to 0.125 for sub-bodies: a console change with a
  knob-range consequence for every existing patch; a ticket if the 65 Hz
  floor on C4 turns out to matter in play.
- Teaching the kernel a second noise stream so any algorithm qualifies: a
  DSP change with a bit-identity proof; not worth it for two claps.
- The 909 snare's separate fixed noise burst: folded into the snappy's 24 ms
  hold, which overlaps it almost entirely on the machine.
