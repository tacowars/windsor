# The audio system is a facade over five collaborators

- **Date:** 2026-09-29
- **Status:** accepted (windsor#104's decisions, set by the main session;
  the seams below are the worker's, checked against them in review)
- **Links:** windsor#104 (this split) · windsor#99 (the file-level
  `max-lines` disable it removes) · windsor#102 (seek, the next transport
  operation)

## Context

`packages/engine/src/system/audioSystem.ts` held the whole running system in
one class: 354 counted lines against the 350 cap, and a file-level
`max-lines` disable since windsor#99. Every feature that touches the running
system lands there, and seek (windsor#102) is next. The class had twenty
private fields with three different lifetimes, and a reader had to hold all
of them to change any one.

## Decision

`AudioSystem` stays the one facade the console drives, with its public
surface unchanged, and composes five collaborators. Each owns its own state
and takes its dependencies as constructor parameters. None holds a reference
back to the system.

| Collaborator | File | Owns | Depends on |
|---|---|---|---|
| `StandingGraph` | `standingGraph.ts` | the music bus, the song master, the returns, the aux fader and both fader values: what `init()` builds once and `dispose()` tears down. It keeps the signal-chain diagram | the engine, the return specs, the route options |
| `PartStrips` | `partStrips.ts` | every part created, on its strip, by engine name: the music part dry into the bus, the aux part into the aux fader, and `remove` / `dispose` | the engine, the graph, the load meter, the desk, the route options, the render's seed and events hooks |
| `MusicRoster` | `musicRoster.ts` | the song's parts by slot: `music-<slot>` naming, the player's `PartHost`, and the slot-keyed tracks the sidechain desk routes between | `PartStrips` |
| `MusicPlayback` | `musicPlayback.ts` | the loaded `ArrangementPlayer` and the mute flag: start, stop, mute, and the position queries | the scheduler, the audio context |
| `SystemLoadMeter` | `systemLoadMeter.ts` | the `AudioLoadMeter` and the on/off switch: `attach`, `detach`, the metered insert registry, the readout | the audio context, the switch |

The facade keeps construction (the wiring between them), the lifecycle
(`init`, `unlock`, `update`, `dispose`, `isStarted`) and the two document
transactions, `initMusic` and `apply`. It still owns the `SidechainDesk` and
the tempo insert registry, because only those two transactions use them. It
composes `readout()` from the playback's readout and the meter's.
`MusicReadout` still lives in `audioSystem.ts`, now as `PlaybackReadout`
plus `load`, so the engine index is untouched.

## Why these are the seams

- **Lifetime separates the graph from the strips.** The standing nodes live
  from `init()` to `dispose()`. A part's strip lives from its creation to its
  removal, and a live add or removal (#629) builds or tears down just the
  one strip. The issue's first candidate put both under one "graph and
  routing" heading. Split, each class has one lifetime, and the graph needs
  no knowledge of parts.
- **The roster is the song's view, and the strips are the system's.**
  `PartStrips` holds aux parts too and knows nothing of slots or
  `MusicPart`. The roster's slot → `music-<slot>` rule, and the "which
  strips are tracks" view the sidechain desk reads, belong only to the
  song.
- **Playback is where transport operations go.** Start, stop and mute share
  one rule set over the scheduler, the player and the mute flag. Seek
  (windsor#102) is one more rule in that set, so it lands in
  `musicPlayback.ts` with a one-line delegate on the facade, and no longer
  in the facade.
- **Metering is one policy.** The live system meters parts, returns, worklet
  inserts and the output stage. The offline render meters nothing. That
  switch was read in two places (the insert registry and every `meterLoad`
  call). It is now read in one.

## Considered and rejected

- **Moving `initMusic` and `apply` into a collaborator.** Each is one
  transaction across the sidechain desk, the player, the tempo registry, the
  master, the strips and the returns. A class that owns them would need
  seven of the facade's collaborators passed in: a second facade, or free
  functions handed half the class. Composing collaborators is the facade's
  job, so the two transactions stay there.
- **A position-queries class.** `stepAt`, `regionStepAt` and
  `capturePattern` are one-line forwards to the player, each with its
  "no player" answer. A class of forwards would add a layer that owns
  nothing, so they sit in `MusicPlayback` beside the player they read.
- **Passing the player to the transport on every call**
  (`start(player)`, `stop(player)`). Both the facade and the transport
  would then need the player, and `dispose` would have two places to clear
  it. `MusicPlayback` holds the only reference. `initMusic` hands the
  player over with `load`, and `apply` reads it back through the `player`
  getter.
- **A base-class chain, or a `utils` or `helpers` file.** Ruled out by
  windsor#104 decision 3.

## Consequences

- Every existing test passes with no edit. The five collaborators each have
  a focused test beside them.
- `audioSystem.ts` has 233 counted lines, and no file in `system/` needs a
  `max-lines` disable.
- `.claude/skills/windsor-engine/SKILL.md` (the "system and live changes"
  row) and `docs/design/audio-architecture.md` (the `system/` line) still
  name only `audioSystem.ts`. Both are outside windsor#104's owned paths and
  are listed as a follow-up in its PR.
