# Step variation: Randomness, Probability, Rests sound and Octave on the Grid and the Arp

- **Date:** 2026-10-24
- **Status:** accepted (the decisions are windsor#935's, agreed with
  tacowars before the work; the tunables are proposed values for
  tacowars's listen, not settled ones).
- **Links:** this record's issue, windsor#935 (step variation 3/4) · the
  Arp's per-cell gate, windsor#933 · sequencer lanes, windsor#488 · format
  rules `2026-09-28-format-versions-refuse-never-destroy` · the listen,
  `docs/research/2026-10-24-step-variation/listen.mjs`
- **Replaces:** Skip (`skipChance`) on the Grid and the Arp. The Figure
  keeps its Skip.

## Context

A Grid line and an Arp's cells play exactly as written, and the only thing
either could do on its own was Skip: a note rests at random. For techno that
is the wrong tool more often than not. It breaks the groove, the one thing a
drum-heavy track needs to keep, and it does nothing to the pitch, the
velocity or the length, which is where a written line most wants to breathe.
Step variation replaces it with two amounts and two switches per part:

- **Randomness** sets how far a step strays.
- **Probability** sets how often a step strays.
- **Rests sound** sets whether the rhythm may change at all.
- **Octave** sets whether a varied pitch moves by whole octaves of the
  step's own note instead of borrowing another step's pitch.

With Rests sound off the groove is exactly as written, and only pitch,
velocity and, on the Arp, gate vary. The console's controls for them are
the next step of this work; this one is the engine, the format and the
lanes.

## Decisions

1. **Four config fields on the Grid and the Arp.** `randomness` 0–1,
   default 0; `probability` 0–1, default 0; `restsSound`, default false;
   `octaveMode`, default false. They are per part, with no song-level value,
   and the two switches are independent. The normaliser fills each when
   absent and clamps or reports junk (`stepVariationFields`).

2. **The gate.** Each step draws once against Probability. Under it the step
   varies at strength Randomness; otherwise it plays as written. At either
   amount 0 nothing varies and nothing is drawn, so a part that never turns
   them up plays event for event what a Skip-0 part played.

3. **What a varied step does.**
   - **Velocity.** A normal offset, σ = `velocitySigma × randomness`, about
     the step's velocity of 1, sent as the note-on's `velocity` (the
     fraction of the part's velocity a Figure cell already sends). It is
     held in `[velocityFloor, 1]`, so a varied note never goes silent.
   - **Pitch, Octave on (Grid and Arp).** The step's own note moves by
     `round(z × octaveSigma × randomness)` octaves, so the note name never
     changes. Up and down are equally likely whatever the note: the
     rounding is symmetric about 0. A shift that would leave MIDI 0–127
     takes the nearest number of octaves inside it. No other step's pitch is
     borrowed and the Arp's list is not jumped.
   - **Pitch, Grid, Octave off.** The step borrows the degree and octave of
     the step a normal offset away, σ = `stepJumpSigma × length ×
     randomness` steps, wrapping over the loop's `length`. When that step is
     a rest or a tie, the nearest note step lends instead (searching out
     both ways, the earlier first at a tie). The pitch goes through the
     scale sampler, so it stays in key and follows the Harmony tab.
   - **Pitch, Arp, Octave off.** The onset plays the list neighbour a normal
     offset from the walked note, σ = `listJumpSigma × list length ×
     randomness`, wrapping over the list. The walk and `previous` keep the
     walked pitch, so no later pitch moves.
   - **Gate, Arp.** The played gate (windsor#933) moves by a normal offset,
     σ = `gateSigma × randomness`, held in `[GATE_MIN, 1]`.

4. **Rhythm, only with Rests sound on.** A varied step may flip: a note
   rests, and a rest sounds. A beat (a local step that is a multiple of
   `onBeatEvery`) flips at `flipOnbeat × randomness`, any other step at
   `flipOffbeat × randomness`, so the downbeats hold better than the steps
   between them. A tie never flips. A rest that sounds plays the nearest
   note step's degree and octave on the Grid and the walked pitch on the
   Arp, with no accent, slide or ratchet. A silenced note plays no ratchet
   hit and releases what is held, as a rest does.

5. **Streams.** Variation draws from a stream of its own per region, minted
   at region entry like every generator's. The Arp keeps its walk on
   `streamRng(seed, region)`; its variation stream takes over the salted
   seed the skip stream had (`arpVariationSeed`, salt
   `ARP_VARIATION_STREAM_SALT`). The Grid, whose only draw was Skip, draws
   from `streamRng(seed, region)`. Whenever both amounts are above 0, every
   step makes the same fixed number of draws (`STEP_VARIATION_DRAWS`, five:
   the gate, the flip, then velocity, pitch and gate values), whatever it
   plays, a tie and a rest included. So editing a step, flipping either
   switch or moving either knob above 0 never moves another step's draws.

6. **A normal value is one uniform draw through the inverse normal CDF.**
   The draw `u` is mapped into `[zTail, 1 − zTail]` as
   `zTail + u × (1 − 2 zTail)` and put through P. J. Acklam's rational
   approximation of the inverse normal cumulative distribution function
   ("An algorithm for computing the inverse normal cumulative distribution
   function", 2003; relative error under 1.15 × 10⁻⁹). At `zTail` = 1/254,
   `|z|` stays under 2.657: a bounded bell with no rare far-out value, whose
   standard deviation is 0.968 (sampled in `stepVariation.test.ts`). A
   two-uniform transform with unbounded tails is not used.

7. **Tunables** live in `stepVariationConstants.ts` (`STEP_VARIATION_TABLE`),
   which the logic takes as a parameter, as values for tacowars to listen
   to:

   | Field | Value | Meaning |
   |---|---|---|
   | `velocitySigma` | 0.2 | σ of the velocity offset at Randomness 1 |
   | `velocityFloor` | 0.05 | the quietest a varied note plays |
   | `stepJumpSigma` | 0.2 | the Grid's borrow σ, per step of `length` |
   | `listJumpSigma` | 0.25 | the Arp's borrow σ, per note of the list |
   | `gateSigma` | 0.25 | σ of the Arp's gate offset |
   | `flipOffbeat` | 0.5 | an off-beat step's flip chance at Randomness 1 |
   | `flipOnbeat` | 0.25 | a beat's flip chance at Randomness 1 |
   | `onBeatEvery` | 4 | local steps per beat for the flip |
   | `octaveSigma` | 1 | σ of the octave shift at Randomness 1, in octaves |
   | `zTail` | 1/254 | the bound on a normal draw |

   The listen renders Octave at `octaveSigma` 1 and 2.25.

8. **Skip is removed from the Grid and the Arp:** the config field, its
   check, its normaliser key, `skipCell`, the Grid's skip draw and the
   `seq.skipChance` lane rows for both kinds. The Figure keeps its Skip and
   its lane.

9. **Lanes.** `seq.randomness` and `seq.probability` are lane rows for the
   Grid and the Arp, linear 0–1, read on the step through the region gate's
   overrides as `skipChance` was (windsor#488). The Arp keeps `seq.gate`.

10. **Format.** `ARRANGEMENT_VERSION` goes to 19. `SONG_MIGRATIONS[18]`
    deletes `skipChance` from every Grid and Arp sequencer and region
    pattern, and drops a Grid or Arp part's `seq.skipChance` lanes; a
    version-18 song then loads with the four new fields at their defaults,
    nothing varied. Neither song in `songs/` sets a non-zero skip or holds a
    skip lane, so nothing audible is lost there.

## Choices made in the build

These follow from the decisions but were not spelled out in them; each is a
line to change if tacowars hears otherwise.

- **Randomness scales the borrow too.** Decision 3 in the issue gives the
  Grid's and the Arp's borrow σ as `stepJumpSigma × length` and
  `listJumpSigma × list length`, without Randomness, while every other σ
  and the issue's goal ("Randomness sets how far a step strays") carry it.
  The build multiplies both by `randomness`, so at Randomness 0.5 a varied
  pitch borrows from nearer steps than at 1. Dropping the factor is a
  one-word change in `jumpOffset`'s two callers.
- **A flip happens only on a varied step**, so the flip rate a listener
  hears is `probability × flip chance × randomness`; the beat-to-off-beat
  ratio stays one half.
- **A rest that sounds then varies like any varied note:** its pitch can
  borrow or move by octaves, and its velocity and gate vary.
- **Velocity only falls.** A Grid or Arp note plays at 1 of the part's
  velocity, so the clamp to `[velocityFloor, 1]` leaves an upward offset
  at 1; about half of the varied steps keep full velocity and the rest play
  quieter.
- **Octave on folds an Arp cell's own octave shift into the pitch** before
  the variation's shift, and the nearest-octave rule then keeps the sum
  inside MIDI.
- **A varied slide keeps its rule:** a borrowed or shifted pitch equal to
  the note held is a tie, as a written one is.
- **The console** shows a slide's hold as uncertain (`skip`) while step
  variation can flip a rest (`variationFlipsRests`), as it did while Skip
  was above 0. The Grid and Arp devices lose their Skip knob; Randomness,
  Probability, Rests sound and Octave controls come with the next step.

## The listen

`docs/research/2026-10-24-step-variation/listen.mjs` renders a Grid line
and an Arp, four bars each at 125 BPM in C minor, at amounts 0, 0.5 and 1
(Randomness and Probability together), with Rests sound off and on and
Octave off, on at `octaveSigma` 1 and on at 2.25: 26 files, written to
`~/Desktop/step-variation-listen/` with a `pitches.txt` of each file's
note-ons per bar. The voice is the shipped `acid-saw` with its operators'
velocity sensitivity at 1, so velocity and gate are heard.
