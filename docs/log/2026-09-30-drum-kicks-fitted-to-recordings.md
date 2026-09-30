# The 808 and 909 kicks are fitted to recordings

- **Date:** 2026-09-30
- **Status:** proposed (awaiting tacowars's listen in the PR preview)
- **Amends:** the kick paragraphs of `docs/design/drum-bank.md`

## Context

tacowars heard the drum bank's kicks as lacking the machines' punch and
presence, and asked whether the engine could not do it or the patches did
not. The bank's kicks were built from circuit write-ups, never compared with
the machines. tacowars supplied clean digital recordings of both (Samples
From Mars, a commercial pack), and measured against them the old patches
were 1.3–1.5 semitones RMS off in pitch (808) and 4–5 semitones and 4–5 dB
off (909). The engine was not the limit: the pitch-envelope shapes, the
909's body hold, the attack clicks and the random start phase were
(`docs/research/2026-09-30-kick-fit/`).

## Decisions

1. **The kick patches are fitted numerically to recordings.** Each is fitted
   to one hit, accent off, the other knobs at their middle, by Nelder–Mead
   over the pitch envelope, the body envelope, start phases and the click
   operator. The structure of each patch is chosen by hand. The pack is not
   committed, only the numbers and the method; the scripts are in the
   research folder.
2. **Three Decay variants per machine, plus 909 Kick Hard.**
   `tr808-kick-short`, `tr808-kick`, `tr808-kick-long` fit the 808's Decay
   B, C and E; `tr909-kick-short`, `tr909-kick`, `tr909-kick-long` fit the
   909's Short, Medium and Long. `tr909-kick-hard` becomes the Long kick
   at full Attack instead of a driven variant. Existing ids keep their
   meaning (a song embeds its own snapshot, so no saved song changes).
3. **Kick operators are phase-locked.** `phaseFree: false` on every
   operator of these seven patches, as both circuits start the same way
   every hit. The console has no control for it; the Patch JSON dialog
   reaches it.
4. **An attack edge is a `Square D` at a locked phase.** An operator's
   amplitude ramps over a 32-sample control block, so an envelope cannot
   make an edge sharper than about 0.67 ms. A square at a fixed frequency,
   phased so its step falls after that ramp and gated by a few-millisecond
   envelope, gives the sharp edge.
5. **The machines' pitch is 52 Hz on G#3.** The recordings settle at
   50–52 Hz; the descriptions name G#3 for both, where the 808's used to
   say A3.
6. **No engine change.** The engine's limits found here (the 0.67 ms ramp,
   drive only inside the filter, no pitch-envelope curves or Init in the
   console) are recorded in the research note, not addressed.

## Consequences

- The seven files, `patches/index.ts` and the golden table
  (`fmGolden.json`, refreshed under Node 24) change; the render of every
  other patch does not.
- The 909 kicks are about 4 dB louder than the old 909 Kick; the 808s match
  the old 808 Kick's level within about 0.2 dB.
- Fitting a patch whose shape uses Init, curves or phase lock gives a
  sound the console can play but not fully edit: the pitch envelope's Init,
  Peak, End and curves and the operators' phase have no controls.
