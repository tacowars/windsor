# Each region plays its own pattern

- **Date:** 2026-09-29
- **Status:** accepted (Pat, 2026-09-29, epic windsor#70 "Design";
  decision 7 by the main session while Pat was away)
- **Links:** epic windsor#70 · windsor#73 (this seam) · windsor#74 (the
  player) · windsor#75, windsor#76 (the console)
- **Closes:** the deferred line of
  `2026-09-26-harmony-v2-document-v3-timeline-and-regions` ("Per-region
  overrides of the pattern (decision 17 names them as a later step): every
  region plays the same pattern today"), which stays as history

## Context

Since #705 a part has one `sequencer` and a list of `regions`, and a region
is only a window, `{ start, duration }`, where that one pattern is live.
Changing a chord step's inversion, the steps, the octave or the base step
in one region changes every region of the part. Pat wants regions to work
like clips in Ableton: two regions of one chord part, one under each of two
harmony events, can voice and rhythm their chords differently. The same
holds for every sequencer kind: chord, grid (with its step modulation
lanes), arp, bass and euclid.

## Decision

1. **Clip-style, not overrides.** A region carries its own complete
   pattern: the kind's whole config (for chord `divisor`, `gate`,
   `voicing`, `register` and `steps`; for grid its steps, flags and
   `lanes`; for euclid `note` and `hold` too). A region never holds a
   partial set of fields layered over the part's.
2. **What stays on the part:** the sequencer `kind` (a part is one kind
   across all its regions), the `seed`, the patch, the velocity, the name
   and the slot. Each region's stream stays `hashSeed(seed, regionIndex)`,
   so a region needs no seed of its own. Changing a part's kind converts
   every region, as changing the kind does today.
3. **The schema.** `MusicPart.regions` is `readonly PartRegion[]`, where
   `PartRegion = Region & { readonly pattern?: RegionPattern }` and
   `RegionPattern` is the part's `SequencerSpec` without `seed`
   (`song/arrangement.ts`). `Region` in `sequencing/regionClock.ts` stays
   `{ start, duration }`: the clocks and the gate read only those two
   fields.
4. **The pattern is optional on the region.** A region without `pattern`
   plays `part.sequencer`. The console gives a region its own full copy
   the first time the region is edited, split or drawn, so what Pat sees
   is clip-style throughout, and `part.sequencer` is never edited again
   except by a kind change. A drawn region copies its left neighbour (the
   nearest region that starts before it); a split gives both halves a
   copy; deleting a region deletes its pattern.
5. **One accessor.** `regionPattern(part, regionIndex): SequencerSpec`
   (`song/regionPattern.ts`, exported through the engine index) returns
   the region's pattern with the part's `seed` for a seeded kind, or
   `part.sequencer` when the region has none, the index names no region,
   or the pattern's kind is not the part's. The player and the console both
   read a region's pattern through it.
6. **Normalising.** `normaliseRegions` (`song/timelineNormalise.ts`) keeps
   each surviving region's `pattern` with it through the sort, the clamp
   and the drop, and `normaliseRegionPattern` (`song/sequencerNormalise.ts`)
   normalises it with exactly the rules `part.sequencer` gets for that
   kind, reported at the pattern's own path. A pattern whose `kind` is not
   the part's is dropped and reported, and so is one that is not an
   object. A `seed` inside a pattern is dropped silently. A region without
   `pattern` stays without one: the normaliser never copies
   `part.sequencer` into a region. The player's `fitTimelines` runs the
   same rule over every merged live partial.
7. **No format bump.** The field is additive, and a song without it plays
   exactly as before, so `ARRANGEMENT_VERSION` stays 3
   (`2026-09-28-format-versions-refuse-never-destroy`, decision 1).

## Why

- **Clip-style over overrides.** An override layer needs a rule for every
  field (does a region's `steps` replace the part's or merge with it? what
  does a region inherit when the part's gate changes?). A whole pattern per
  region has none: what a region plays is what it holds. It is also what
  Pat asked for: two regions of one part, each set on its own and each
  heard on its own.
- **Optional on the region.** A required pattern would have to be written
  into every region of every song at once, by a migration and a format
  bump, and every PR in the chain (this seam, the player, the console)
  would have to land together to keep the app building and playing. With
  the pattern optional, each lands alone: after this seam nothing plays
  differently, after the player a region with a pattern is heard, and
  after the console Pat can make one.
- **The seed on the part.** The stream per region is already the part's
  seed hashed with the region's index, so every region already plays its
  own stream; a seed per region would add a second way to say the same
  thing, and a Reseed would have to reach every region.
- **One accessor.** The fallback (`pattern ?? part.sequencer`) and the seed
  rule are the two things a reader could get wrong; living in one pure
  function, they can't drift between the player and the console.
- **A kind mismatch drops the pattern.** A part is one kind. A pattern of
  another kind cannot build the part's generator, and the part's own kind
  is the one the author chose, so the pattern is the one that goes.

## Punted / alternatives

- A "copy this region's pattern to all regions" command, and linked
  regions (several regions sharing one pattern). Either can follow if
  editing regions one by one gets tedious (epic windsor#70, out of scope).
- A required `pattern` with a version-4 upgrade that copies
  `part.sequencer` into every region. It is the cleaner end state, and it
  may follow once the chain has landed; it is not needed for Pat to hear
  and edit regions separately.
