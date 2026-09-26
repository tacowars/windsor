# Harmony v2: document v3 — transport bars, the harmony timeline, regions and the restart rule, per-sequencer seeds

- Date: 2026-09-26
- Area: audio
- Links: epic #703 · issue #705 (T1, the seam) · #704 (T0) · #706 / #707 (the arp and bass performers) · #708 (transport strip) · #709 (Song view) · design transcript `docs/research/harmonysequencerV2.md` · mockups https://claude.ai/artifact/B2shqs9ZnnL6VtqNYKpaTh

## Decision

Epic #703's decisions 2, 3, 5–11 and 15–17 (Pat, 2026-09-26, from the
transcript and the mockups), as the code now states them:

1. **Document version 3, a clean break** (decisions 3, 4). `version: 3` is
   the only version `makeArrangement` reads; a `version: 2` document is
   refused with "version 2 is not supported since #705" and, like every
   other unusable document, falls back to the metronome. No migration; no
   song ports — the placeholder `arrangements/bed-01.json` is rewritten by
   hand and Pat composes fresh songs in the tool.
2. **The song has an explicit length** (decision 5): `transport: { bpm,
   bars }`, `songTicks = bars × TICKS_PER_BAR`. The transport's absolute
   tick never wraps; every timeline lookup is `tick mod songTicks`. 4/4 stays
   the constant (decision 7).
3. **Harmony is a timeline of chord events** (decisions 6, 10, 11):
   `harmony: { root: 0–11, scale, events: [{ start, duration, degree, size:
   3 | 4 }] }`. The root is a pitch class; events are integer ticks, sorted
   and **contiguous** — the normaliser rewrites each duration to the gap to
   the next start (the song end for the last) and reports a written value
   that differed, so the document holds one canonical timeline. An event
   holds until the next; the last holds to the song end; the timeline is
   cyclic, so a first event starting after tick 0 means the last holds from
   tick 0. No rests in the harmony (decision 6): a rest is a gap in a part's
   regions. `harmony/harmonyTimeline.ts` (`chordAt`, `eventBounds`) is the
   one lookup, pure.
4. **Regions and the restart rule** (decisions 2, 9, 17). A part has one
   `sequencer` and `regions: [{ start, duration }]` in ticks, sorted and
   non-overlapping — each end is clamped to the next region's start and the
   song end, a region left with no length is dropped and reported, and a
   part with no `regions` is silent (a missing list is reported). The
   pattern (step position and PRNG stream) restarts when the playhead enters
   a region from outside; a single region covering the whole song is **∞**
   and never restarts — the song wrap is not an entry.
   `sequencing/regionClock.ts` (`regionState → { live, index, entryTick,
   localTick }`) is the one position rule; `sequencing/regionGate.ts`
   applies it between the transport and each generator: it forwards local
   ticks at the generator's divisor with the chord at the transport tick,
   calls `enter(regionIndex)` on an entry and releases the part's held notes
   on the tick its region ends (note-offs land on that tick). Chord changes
   never restart anything.
5. **Seeds are per sequencer** (decision 16): euclidean, grid, arp and bass
   carry `seed`; the stream in a region is `hashSeed(seed, regionIndex)`
   (`generatorSeed.ts`, the same golden-ratio stride as before). The
   arrangement seed and the console's Reroll are gone. A **missing seed is
   reported** and defaulted to 0 — the one absent field that is a correction,
   because the stream a song ships with should be a chosen one — and the
   console's kind switch writes `seed: 0` explicitly for that reason.
6. **The rebuild-vs-reconfigure plan, stated** (the ticket's open question).
   A part rebuilds on a change of its kind, its divisor or its **seed**
   (`generatorSig` in `song/partGenerators.ts`); the Chord Player rebuilds
   on kind only. A `seed` edit therefore **restarts that part's stream
   immediately**, by the rebuild, not at the next region entry — a Reseed
   should be heard when it is pressed, and the rebuild is the mechanism T0
   already used for the arrangement seed. A `regions`, `transport.bars` or
   harmony-event edit reaches every part's gate live
   (`RegionGate.reconfigure`) and rebuilds nothing; a key change (root or
   scale) swaps the sampler live, as before.
7. **The Chord Player is a rhythm** (decision 15): steps are
   `{ kind: 'hit' | 'rest', duration, repeat, inversion, octave }`; a hit
   voices the harmony's chord at that tick through `chordTones` +
   `voiceChord` with the step's inversion and octave and the part's voicing.
   A hit sustaining across a chord boundary keeps its notes to its own end
   (only future onsets change). Semitone is gone. The console's picker is
   one Hit tile — named for, and auditioning, the chord under the playhead
   — and one Rest tile.
8. **Octave convention** (decision 11): a part's `register.octave` is an
   absolute MIDI octave, `noteFor(degree, octave) = 12 × (octave + 1) + root
   + offset` (octave 3 at root 0 is C3 = 48), range −1..9; the kinds open at
   grid 2, chord 3, arp 4, bass 1. `voiceChord` takes the register's root
   note and the step's own octave, plus an optional `maxNotes` for #706.
9. **Arp and bass are normalised in full and performed by stubs**:
   `sequencing/arpSequencer.ts` and `bassSequencer.ts` carry the config
   types, defaults and asserts the epic's decisions 12–14 name; their
   generators emit nothing until #706 / #707 replace the body, each a `case`
   in `song/partGenerators.ts` and a card in the console registry.

## Why

- One position rule and one timeline lookup, both pure and both tested on
  the ticket's named fixtures, are what make "same document, same tick, same
  music" (decision 8's ■ / ▶ identity) provable in a unit test rather than
  by ear; the region gate is the only place the transport tick is read on a
  part's behalf, so a generator cannot drift from the console's playhead.
- Contiguous events with rewritten durations keep the document canonical:
  the Song view draws blocks that meet, and a duration is never a second
  source of truth against the next event's start.
- A seed edit as a rebuild keeps one mechanism for "restart the stream" and
  makes a Reseed audible at once; restarting at the next entry would leave
  an ∞ region — the common case — never reseeding until ■.
- Reporting a missing seed is deliberate friction on the document, not the
  console: the console writes the seed, so a song exported from it is clean,
  and a hand-written song without one says so in the report.

## Punted / alternatives

- Per-region overrides of the pattern (decision 17 names them as a later
  step): every region plays the same pattern today.
- The overlap rule: the epic's "each end clamped to the next start" (the
  earlier region yields) is implemented; the ticket's acceptance line reads
  as the later region's start moving, which is the other resolution of the
  same overlap — flagged in the PR for Pat to confirm.
- `transport.bars` shrinking live: the document is renormalised (regions and
  events clamped) while the running player keeps its merged regions; the
  audible result is the same because `regionState` treats a region past the
  song end as unreachable, and the next export is the normalised document.
- The Harmony tab's event-list editor is a stopgap for authoring a v3 song
  before the Song view (#709), which deletes it.
