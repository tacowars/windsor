# Noise draws descend in both render loops

- **Date:** 2026-10-02
- **Status:** accepted (tacowars, 2026-10-02, windsor#389)
- **Follows:** windsor#382 (PR #388) and its research,
  `docs/research/2026-10-02-noise-operator-cost/` ("The proposal",
  option 2)
- **Refines:** `2026-09-15-fm-voice-kernel-fixed-index-bit-identical` (the
  kernel's noise rule) and
  `2026-09-18-drum-bank-ratio-floor-and-two-noise-algorithms` decision 2,
  which stand as history

## Context

A voice's Noise operators share one noise generator. The fixed-index kernel
evaluates the operators D, C, B, A, so it draws a sample's noise D..A. The
generic loop drew where each Noise operator came in the algorithm's
evaluation order. The two orders differ on most algorithms, so the kernel
took a voice with two or more Noise operators only when they happened to
draw D..A in the generic loop too (windsor#382's `noiseDrawsDescend`). Sixty
of the 121 multi-Noise operator sets fell back to the generic loop, at
2.5–2.9× the kernel's cost, Additive (A|B|C|D), the natural snare and hat
algorithm, among them. A two-Noise snare shape measured about 66 ns/sample
there against about 27 for a one-Noise voice on the kernel.

## Decision

1. **The noise draw order is D..A in both loops.** At the top of each
   sample the generic loop draws its Noise operators' values in descending
   index order into the voice's `noiseDraw` slots (a `Float64Array(4)`
   allocated with the voice), then evaluates the algorithm in its usual
   order, and each Noise operator reads its slot. The kernel keeps drawing
   D..A where it stands. `noiseDrawsDescend` and the kernel's refusal on it
   are gone, so every voice whose algorithm the kernel takes (all eleven
   today) takes the kernel, whatever its Noise operators.
2. **Seeded renders of a multi-Noise voice may change.** The generator, its
   seeding and its sequence are unchanged; only which Noise operator takes
   which draw changes, on the algorithms whose evaluation order is not D..A.
   Live playback seeds every voice's generator from `Math.random`, so
   nothing audible changes: the noise was a different random sequence on
   every note before and still is. No shipped patch has two Noise
   operators, so the FM golden does not move.
3. **No format version bump.** No field changes, and no song or patch loads
   differently.

## What it gives up

A user's multi-Noise patch rendered with a fixed seed (an offline render, a
test, the sound-match harness) no longer gives the bits it gave before this
change, on an algorithm whose evaluation order is not D..A. The new noise is
statistically the same: the same generator and seed, its draws dealt to the
Noise operators in a different order.

## Rejected

- **Draw ahead in the kernel, in the generic loop's order** (option 1 of the
  research's proposal, its recommendation). When the generic loop's order
  is not D..A, the kernel would draw each sample's noise at the top into
  preallocated slots in that order and read them per operator, behind a
  hoisted flag. It keeps every seeded render bit-identical, at the price of
  a second kernel path and a per-voice draw order set at bind time. Since
  live noise is random on every note anyway, keeping old seeded renders of
  user patches identical was not worth the extra path; the generic loop,
  the reference that is rarely live, takes the change instead, and the
  kernel stays as it was.

## Consequences

- `fmProcessorKernel.test.ts` renders all 121 multi-Noise operator sets on
  the kernel against the generic loop to the bit, with the boundary cases
  (no Noise operator, one, all four, one at level 0, one falling to level 0
  and back, a voice going dormant and waking).
- The kernel's code is unchanged, so a voice with one Noise operator or none
  costs what it did; the before-and-after measurements are in
  `docs/research/2026-10-02-noise-operator-cost/` ("windsor#389: draws
  descend in both loops").
- Sound design may use two or more Noise operators on any algorithm without
  leaving the kernel (`.claude/skills/windsor-engine/references/synth-behavior.md`).
