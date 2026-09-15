# Dormant voices and plate sleep: the guards the ticket did not state

- Date: 2026-09-15
- Area: audio
- Links: issue #547 · research `docs/research/2026-09-15-547-dormant-voices-plate-sleep/`

## Decision

#547 fixed the floors: 1e-9 on carrier amplitude, SVF state and plate input,
and 1e-7 on the plate's wet output. They are named constants in the two
worklets. The implementation made four more calls that the ticket did not
state:

1. **A note-off ends a dormant voice only when its release is silent too.**
   `releaseVoice` kills a dormant voice only if every carrier's `endLevel` is
   0. Otherwise it releases the voice as before. The ticket says a note-off
   "ends it directly". But a release that rises towards a non-zero end level is
   sound, and the console exposes that knob. No factory preset sets one today.
   `fmProcessorDormancy.test.ts` "releases rather than ends a dormant voice
   whose release rises to an end level" pins this.
2. **The plate's output floor is read at wet 1.** The ticket's "wet output
   sample" is read before the wet gain, as the tap sum times `OUTPUT_TRIM`.
   Read after the gain, a plate at wet 0 would sleep 1.6 s into a tail it
   still holds. Turning wet up again would then find silence.
   `reverbSleep.test.ts` "does not sleep through a tail it holds at wet 0"
   pins this.
3. **Sleep also resets the write heads and the modulation phases.** Clearing
   the delay lines alone leaves a head far from 0. A fractional read's
   position is summed against that head, so its last bit rounds differently
   from a fresh plate's. The second impulse then renders within a few ulps of
   a fresh plate rather than bit-identically. With the reset, the test asserts
   exact equality.
4. **Where the checks sit.**
   - Dormancy is read when a voice's `ctrlCount` is 0 at the start of a render
     segment (a block, or the span up to an event). That keeps the render loop
     inside lint's `max-depth`. A voice that crosses the floor mid-block
     renders one more ≈0 chunk before it is skipped. Waking has the same
     granularity as a per-control check, because a rebind arrives between
     quanta.
   - The plate's asleep quantum is dispatched in `_render`, outside
     `_renderBlock`. Folded into `_renderBlock`, it cost loud input ~30 % on
     the dev machine after a plate had slept. That is a JIT feedback effect,
     and the research record has the numbers.

## Why

The ticket's binding line is that anything which changes audible output is
out of scope. Guards 1 and 2 close the two paths where the literal wording
would change output. Guards 3 and 4 make the stated tests exact and keep the
saving from costing the loud case.

## Punted / alternatives

- Wet 0 could be treated as "never sleep". That was rejected because it
  would forfeit the saving on a muted return, and reading before the gain
  costs nothing.
- `cutSounding` (mono) still fades a dormant voice like any other, as the
  ticket asks. Killing it outright would be equally silent and slightly
  cheaper, but it was left alone.
