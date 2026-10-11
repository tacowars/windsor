# Bounce to Roll, and slide by overlap in the Roll

- **Date:** 2026-10-11
- **Status:** proposed (decisions agreed with tacowars on 2026-10-11; the
  mockup awaits approval)
- **Links:** this record's issue, windsor#732 · the mockup,
  `docs/research/2026-10-11-bounce-to-roll-mockup/mockup.html` · the Roll
  record `2026-10-04-roll-sequencer` · region patterns in
  `2026-09-29-each-region-plays-its-own-pattern` · clip envelopes in
  `2026-10-11-roll-envelope-format` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

Six kinds generate their notes: Euclid, Grid, Chord, Arp, Basslead and
Figure. What they play can't be edited note by note. A skipped step, a
velocity or one wrong pitch in an Arp take can only be changed by changing
the generator, which changes everything else it plays as well. The Roll
(`2026-10-04-roll-sequencer`) holds notes one by one, so a part bounced to
Roll can be edited one note at a time.

This record adds a **Bounce to Roll** command that rewrites a generated
part as a Roll part, in place, holding the notes it played. It also lets
the Roll **slide**: a note that starts while another pitch is still held
slides into it on a mono patch, as the TD-3 and the Elektron sequencers do.
Without that, a bounced acid line would lose its slides.

The decisions were agreed with tacowars on 2026-10-11. The mockup draws the
command and its toasts. Once both are approved they are the spec for the
build tickets, written then.

## Decisions

1. **The command.** A **Bounce to Roll** button in the Song view's detail
   pane header for a part (`head()` in `packages/app/src/songDetailPane.ts`),
   after the summary note (`grid · 16 steps · 1/16 · 1 region`) with a clear
   gap. It is shown for `euclidean`, `grid`, `chord`, `arp`, `bass` and
   `figure` parts, and not for `roll` or `none`. On a part with no regions
   it is drawn disabled, with the title "No regions to bounce".
2. **In place, every region, one undo.** The bounce rewrites every region
   of the part and sets its kind to `roll`, in one `ctx.change`: one undo
   step, labelled "Bounce to Roll" (the build names the step, since
   `stepLabel` would otherwise name it from the partial). There is no
   confirmation dialog, since undo takes it back. Keeping the original
   beside the bounce is a later Duplicate track feature, not this one.
3. **What is rendered.** Each region is rendered as it plays from its
   start: the kind's generator built from the region's pattern
   (`regionPattern`), its stream minted from `hashSeed(seed, regionIndex)`
   as the region gate's entry mints it, and driven through the region's
   ticks under the song's harmony and meter and the part's sequencer lanes.
   The random draws are frozen at that take. A region is rendered as a
   fresh play from its start, so a live edit's restarted epoch (a Figure's
   drift) is not reproduced. The render is a pure engine function exported
   through `@windsor/engine`'s index, so the app never builds notes itself.
   Its ticks are straight: the clock swings the Roll as it swung the
   generator.
4. **How events map to Roll notes.**
   - **Pitch** is the note-on's pitch. **Length** runs from the note-on to
     its note-off, at least 1 tick. A note the generator never releases
     ends at the region's end, where the gate's leave releases it.
   - **A Euclid hit's hold** is in seconds, and the clock's ticks are
     swung (`swingTicks` in `sequencing/swing.ts`: tick `n` sounds at
     `swingTicks(n)` straight ticks). The note's release tick is the
     straight tick whose swung time is nearest the hit's onset time plus
     its hold: `unswingTicks(swingTicks(onset) + hold ÷ secondsPerTick)`,
     the inverse of the clock's warp, then whichever of the two whole ticks
     around it sounds nearer that time, the later on a tie. Straight, that is the hold at the
     tempo. A release that is not already a whole tick is rounded, and
     counted with the ratchet roundings ("ticks rounded", decision 8).
     Worked below.
   - **A Euclid tail past the region's end.** A Euclid hit is triggered
     for its whole hold (`part.trigger` in `song/arrangementPlayer.ts`),
     and the region's leave releases only pitched generators
     (`song/partBinding.ts`), so a hold that crosses the region's end rang
     past it. A Roll note is released at its region's end. The bounce cuts
     such a note at the region's end and counts it ("3 Euclid tails cut at
     a region's end"). Worked below.
   - **Velocity** is what the part played divided by the part's Vel. What
     the part played is `partNoteOn`'s velocity: the part's Vel × the
     event's velocity (a Figure cell's, else 1), plus the accent's bump, at
     most 1. If any played velocity is above the part's Vel, the part's Vel
     rises to the highest one across every region, and every note is
     rescaled, so every played level is kept. The Roll plays a note at the
     part's Vel × the note's velocity (`partNoteOn` again, with no accent),
     which gives back the played level, up to one rounding of the last
     bit of a double. A velocity of 1 is written as no key, as the
     normaliser writes it.
   - **Slide.** The note slid from is lengthened to end one tick after the
     slid-to note's onset, so the two overlap and decision 7 slides them.
     A slide onto the pitch already held merges the two into one note.
     The Grid and the Arp already emit nothing for one, as a tie, so the
     held note runs on.
   - **Overlaps that did not slide.** A note held into a later onset of
     another pitch that was not a slide (a Euclid hit held past the next
     hit, with the pitch lane moving) is trimmed to end on that onset when
     the part's patch is mono. The engine cut it there (`cutSounding`), so
     the trim keeps the retrigger. On a poly patch it is kept, as both
     notes sounded and the Roll's slide does nothing there. A note held
     into a later onset of its own pitch is trimmed to end there, the
     normaliser's rule, and counted (decision 8). On a poly patch the
     engine let both sound.
   - **Ratchet.** The engine spaces a ratchet's `N` hits evenly across the
     step's swung span (`rollHits` in `song/rollSpan.ts`), in straight
     time, so the bounce places them through the inverse warp, as it does
     a Euclid release. For a step of `T` ticks starting on tick `s`, the
     span is `S = swingTicks(s + T) − swingTicks(s)` straight ticks, and
     hit `i` sounds at `swingTicks(s) + i × S ÷ N`. Its written onset is
     `unswingTicks` of that time, and its release is `unswingTicks` of
     that time plus the hit's held time. A closed hit (every hit but an
     open last one) is held `g × S ÷ N`, with `g` the roll's gate
     (`NoteRoll.gate`): 1 for a Grid step and the part's Gate for an Arp,
     Basslead or Figure step (`rollOutcome`). A Euclid hit is held the
     lesser of its hold and that slice. An open last hit runs to its
     release, as a plain note does: a Grid's always, and an Arp's,
     Basslead's or Figure's when a tie or slide follows or its gate covers
     the step (`NoteRoll.open`). Each onset or release that is not a whole
     tick is rounded as a Euclid release is, to whichever of the two whole
     ticks around it sounds nearer its time (a tie goes to the later
     tick), and counted (decision 8). A release is at least one tick after
     its onset. Straight, the warp is the identity and this is
     round(i × T ÷ N). A hit still running at the next hit's onset is
     trimmed to end there, as above.
   - **Ratchet hits on one tick.** At 24 PPQ a fast ratchet can round two
     hits of one pitch onto the same tick, and a Roll holds one note per
     pitch per tick (the normaliser drops the second). The bounce writes
     what the grid can hold: a hit whose onset rounds onto the tick of an
     earlier hit of its pitch is merged into that hit's note, which runs to
     the later of their two releases. The merged hit is not heard, and the
     toast counts it ("2 ratchet hits lost", decision 8). A grid finer than
     24 PPQ (windsor#736) is the real fix. Ratchets straight, swung and on one tick are worked below.
   - **Step-mod lanes** become clip envelopes on the same voice targets
     (`2026-10-11-roll-envelope-format`). A part has at most
     `STEP_MOD_LANES_MAX` (4) lanes and a roll at most `ROLL_ENVELOPES_MAX`
     (4) envelopes. Each envelope is read from the note-ons' `stepMod`
     arrays at its row, 0 on a note-on with none. A row that is 0 on every
     note-on in the region is not written. The value changes only at note
     onsets: each onset takes its note's value and holds it to the next
     onset. That is exact for a line that plays one note at a time (see
     "What an envelope is not" below). An envelope's ticks must strictly
     increase, so each change is two points: the old value at the onset −
     1/64 tick, and the new one on the onset, both with bend 0. The first
     onset takes one point. 1/64 tick is a binary fraction, exact in a
     double and in JSON at any tick, and it is under one 128-frame render
     block at 48 kHz at every tempo above 15 BPM (a tick is 20.8 ms at
     120 BPM, so 1/64 is 0.33 ms; at `BPM_MIN`, 20, it is 1.95 ms). A loop
     of `n` onsets writes at most 2n − 1 points, so a loop under the note
     cap fits the 4096-point cap.
   - **The accent's mod bump** has no Roll equivalent yet. It is dropped
     and counted. An accent whose part sends a mod of 0 (`accentMod` 0)
     loses nothing and is not counted.
   - **The part's sequencer lanes** (`seq.gate`, `seq.skipChance`,
     `seq.density`) are read by the render, then removed from the part's
     `automation` in the same change, since a Roll offers none. Every other
     automation lane on the part is unchanged.
5. **The shortest repeating loop.** Each region's `loopTicks` is the
   fewest whole bars of the song's meter, counted from the region's start,
   whose notes and envelopes play the rendered region exactly when the
   Roll's performer loops them. A candidate loop of `L` ticks, shorter than
   the region, is tested as follows:
   - its notes are the rendered notes with an onset before `L`, each cut
     to `min(ticks, L − tick)` as the performer cuts it;
   - repeated at `0, L, 2L, …` across the region, each copy cut at the
     region's end (a partial last repeat is compared as a prefix), they
     must give exactly the rendered notes: pitch, onset, length and
     velocity;
   - its envelopes must read the same value as the rendered envelope at
     every onset.

   A rendered note that crosses a candidate's end therefore rules it out.
   A region that no candidate fits is unrolled: its loop is the region's
   length. A part's single ∞ region (one region covering the whole song)
   becomes a drawn region from bar 1 to the song's end: the region is kept
   as it is. The Roll record clears an ∞ region when a part's kind becomes
   Roll (`2026-10-04-roll-sequencer` decision 5), so that a new Roll starts
   empty, and the bounce does not. The region is rendered over one pass of
   the song. Two things follow:
   - The engine still reads a region covering the whole song as
     free-running (`isInfiniteRegion`). A loop that doesn't divide the song
     drifts across the song's wrap, as a free-running line drifted before.
   - A song-length edit stretches the region, as it does every whole-song
     region (`followSongLength`), and the loop repeats over the new bars.
6. **The note cap.** If any region's loop would need more than
   `ROLL_NOTES_MAX` (2048) notes, the bounce changes nothing and shows an
   error toast naming the region and the count: "Region 3 needs 3104
   notes; a Roll region holds 2048. Split it first." The same holds for a
   region whose loop would be longer than `ROLL_LOOP_TICKS_MAX` (24576
   ticks, 256 bars of 4/4). Only an unrolled region in a long song in
   5/4, 6/8 or 12/8 can reach it: "Region 1 needs a 300-bar loop; a Roll
   loops at most 256 bars of 4/4. Split it first." The bounce does not
   leave the normaliser anything to trim: it refuses a region over these
   caps, and it resolves the same-pitch overlaps and the ratchet hits that
   round onto one tick itself (decision 4), counting what that loses.
7. **Slide by overlap in the Roll.** When the Roll's performer starts a
   note while a note of another pitch is still held, the note-on carries
   `slide`. "Still held" means a note started on an earlier tick whose
   release falls after this tick. Notes that start on the same tick (a
   chord) never slide into each other. Touching notes, one released on the
   tick the next starts, are retriggered as today, since the performer
   releases before it starts. So notes drawn end to end at the Snap length
   do not slide. The engine's slide acts only on mono patches
   (`NoteOnMessage.slide`: the sounding voice is retargeted, its envelopes
   untouched, and rebound to the new handle). A poly patch plays the
   overlap as two notes. The note slid from still sends its note-off when
   it ends. The voice is bound to the new handle by then, so the note-off
   releases nothing. This applies to every Roll note, drawn, recorded or
   bounced. A song whose Roll notes already overlap on a mono patch starts
   sliding there (decision 9).
8. **The summary.** A successful bounce shows an `info` toast:
   "Bounced to Roll: 214 notes in 3 regions", followed by only the
   approximations that are not zero, for example "12 ticks rounded · 2
   ratchet hits lost · 6 accents lost their mod · 4 repeats trimmed · 3
   Euclid tails cut at a region's end · Skip and Gate lanes baked". The
   counts are over the notes written (each region's loop), as the note
   count is. "Ticks rounded" counts each written ratchet onset or release
   and each swung Euclid release that fell between ticks. "Ratchet hits
   lost" counts the hits merged into an earlier hit on the same tick
   (decision 4); a lost hit's own roundings are not counted. "Repeats
   trimmed" counts the same-pitch overlaps of decision 4.
   "Euclid tails cut" counts the written notes whose hold the render cut at
   their region's end (decision 4); a region cuts at most one pass's worth,
   its last. A Figure part that another part's canon follows is a
   leader no longer, and the normaliser drops that canon's source, as it
   does at any kind change of the leader. The toast then names the
   follower: "Pad's canon lost its leader". Undo brings both back.
9. **No format change, by tacowars's decision.** A bounce writes ordinary
   Roll patterns and envelopes, and the overlap rule adds no field. The
   overlap rule does change what existing data means: a saved Roll whose
   notes of different pitches overlap on a mono patch retriggered there,
   and from this build on it slides (decision 7).
   `2026-09-28-format-versions-refuse-never-destroy` bumps the version for
   a changed meaning. tacowars decided on 2026-10-11 to depart from that
   rule here and leave `ARRANGEMENT_VERSION` where it is: old-song parity
   is not required, and the version is not bumped only to protect older
   songs. Old songs still load, play and round-trip; only their mono
   overlaps now slide. No upgrade is provided.
10. **Later**:
    - MIDI lanes for the mod wheel and pitch bend, where an accent's mod
      would go.
    - A grid finer than 24 PPQ (windsor#736), for exact ratchets with no
      hit lost. That is a format change.
    - Duplicate track: a bounce that keeps the original.
    - Accent-mod or slide marks drawn on Roll notes.

## Worked examples

### Velocity (decision 4)

A Grid part at Vel 0.8 with an accent bump (`accentVelocity`) of 0.3:

| Note | `partNoteOn` plays | Written |
|---|---|---|
| plain | 0.8 × 1 = 0.8 | 0.8 ÷ 1.0 = 0.8 |
| accented | min(1, 0.8 + 0.3) = 1.0 | 1.0 ÷ 1.0 = 1 (no key) |

The accented note plays 1.0, above the part's 0.8, so the part's Vel rises
to 1.0 and every note is divided by 1.0. Played back, 1.0 × 0.8 = 0.8 and
1.0 × 1 = 1.0, the levels played before. The clamp at 1 had already eaten
0.1 of the bump, and nothing else is lost.

Where nothing clamps, the rescale shows. At Vel 0.5 with the same bump, an
accent plays 0.5 + 0.3 = 0.8, so the Vel rises to 0.8, a plain note is
written 0.5 ÷ 0.8 = 0.625, and the Roll plays 0.8 × 0.625 = 0.5. A Figure
cell at velocity 0.5 under Vel 0.8, accented, plays 0.8 × 0.5 + 0.3 = 0.7.
In the first part above, where another accent plays 1.0, it is written
0.7 ÷ 1.0 = 0.7. In a part whose highest level it is, 0.7 is below the
Vel, so the Vel stays at 0.8 and the note is written 0.7 ÷ 0.8, which is
0.8749999999999999 in doubles, and 0.8 times that gives back exactly 0.7.
Each product here was checked in doubles (Node 24): every one returns the
level played.

### The loop (decision 5): a Grid that repeats every bar

The Acid Saw line of `docs/research/2026-10-04-acid-ladder-filter/audition/acid-audition.song.json`:
16 steps at 1/16 (6 ticks), A natural minor, register octave 1
(`rootNote(1)` = 33, A1), skip chance 0, no lanes, Vel 0.8, accent bump
0.2, accent mod 1. It is placed here in a 4-bar region (384 ticks) of 4/4.
Each bar plays 12 note-ons:

| Step | Tick | Pitch | Marks | Written note |
|---|---|---|---|---|
| 1 | 0 | A1 33 | accent | 0–6 |
| 2 | 6 | A1 33 | | 6–13: lengthened 1 tick for the slide at 12 |
| 3 | 12 | A2 45 | slide | 12–24: the tie on step 4 holds it |
| 5 | 24 | C2 36 | | 24–30: step 6 rests |
| 7 | 36 | A1 33 | accent | 36–43 |
| 8 | 42 | G2 43 | slide | 42–48 |
| 9 | 48 | A1 33 | | 48–54 |
| 10 | 54 | A2 45 | accent | 54–61 |
| 11 | 60 | D2 38 | slide | 60–72: tie on 12, rest on 13 |
| 14 | 78 | E2 40 | accent | 78–85 |
| 15 | 84 | A1 33 | slide | 84–90 |
| 16 | 90 | A2 45 | | 90–96 |

Step 1 is not a slide, so step 16's A2 is released on the next bar's
downbeat as step 1 starts: it touches the bar line and never crosses it.
In the region's last bar, the gate's leave releases it on tick 384, which
gives the same length. Every bar renders the same 12 notes, so `L` = 96
(one bar) fits: its 12 notes, each cut at 96 (none is), repeated at 0,
96, 192 and 288, give the rendered 48. The region's loop is 1 bar holding
12 notes. The part's Vel rises to 1.0 (an accent plays min(1, 0.8 + 0.2)
= 1.0), the 8 plain notes are written at 0.8 and the 4 accented at 1,
and 4 accents lose their mod of 1.

The same line with `slide` set on step 1 does not loop at a bar. On the
first pass nothing is held at step 1, so it plays plain (a Grid slide
needs a held note). On every later bar it slides from step 16's A2, so
that note is lengthened to end at 97, across the bar line. A Roll note
can't cross its loop's end, so no `L` of 1, 2 or 3 bars fits, and the
region is unrolled: a 4-bar loop of 48 notes.

### The loop (decision 5): an Arp that never repeats

An Arp at 1/16 whose cells are all note cells, with skip chance 0.25 and
seed 0, in region 0, a 4-bar region of 4/4. The Arp draws once per note
cell from its own skip stream (`arpSkipRng(0, 0)`). Its 64 draws skip
these onsets, by bar (`x` skips):

```
xx..........x...   x....x......x...   .....x...xx.x.xx   .......x....x.x.
```

That is 15 skips, so the region plays 49 notes. Bar 1's skips differ from
bar 2's, so `L` = 1 bar fails, and so do `L` = 2 bars (bars 1–2 against
3–4) and `L` = 3 bars (bar 4 against bar 1). The region is unrolled: its
loop is 4 bars holding the 49 notes, exactly that take. A skip-chance lane
on the part would be read as the gate reads it, then removed.

### A ratchet (decision 4)

A Grid step at 1/16 (6 ticks) with a ratchet of 4, straight: the engine
spaces the hits 1.5 ticks apart and holds each closed hit 1.5 ticks
(gate 1). The onsets fall at 0, 1.5, 3 and 4.5, and the closed hits'
releases at 1.5, 3 and 4.5. A half is a tie, which goes to the later
tick, so the hits are written 0–2, 2–3, 3–5 and 5–6: the open last hit
runs from 5 to the step's end, where the next note or rest releases it.
Four positions fell between ticks (hit 1's release, hit 2's onset, hit
3's release and hit 4's onset): "4 ticks rounded". A ratchet of 3, or of
4 at 1/8, divides evenly and rounds nothing.

### A ratchet across the swing's off-beat (decision 4)

At 75% sixteenth swing a pair is 12 ticks, a tick in its first half lasts
1.5 straight ticks and one in its second half 0.5. A Grid step at 1/8
(12 ticks) on the downbeat, tick 0, with a ratchet of 4, spans the whole
pair: `S` = `swingTicks(12)` − `swingTicks(0)` = 12 straight ticks. The
engine plays its hits at straight times 0, 3, 6 and 9, each closed hit
held 3. Through `unswingTicks` the onsets are ticks 0, 2, 4 and 6 (9 is
the off-beat, `unswingTicks(9)` = 6), and the closed hits' releases at 3,
6 and 9 are ticks 2, 4 and 6. The open last hit runs to the step's end,
tick 12. So the hits are written 0–2, 2–4, 4–6 and 6–12, all whole ticks,
and nothing is rounded. Played back they sound at `swingTicks` 0, 3, 6
and 9, the engine's times. Spacing the hits evenly in ticks (0, 3, 6 and
9) would play them at 0, 4.5, 9 and 10.5.

### A ratchet whose hits round onto one tick (decision 4)

A Grid step at 1/32 (`T` = 3) with a ratchet of 4, straight: the hits
start at 0, 0.75, 1.5 and 2.25, each closed hit held 0.75. Rounded to the
nearer tick, the onsets are 0, 1, 2 and 2. Hit 1 is written 0–1 and hit 2
1–2 (its release, 1.5, is a tie and goes to 2). Hit 3 starts on tick 2,
and its release, 2.25, rounds to 2, so the one-tick minimum makes it 2–3.
Hit 4, the open last hit, also rounds onto tick 2: it is merged into hit
3's note, which runs to the later release, the step's end at tick 3. The
bounce writes three notes, 0–1, 1–2 and 2–3, where the engine played
four hits, and the toast says "5 ticks rounded · 1 ratchet hit lost" (hit
1's release, hit 2's onset and release, hit 3's onset and release). At
24 PPQ a 1/32 step has three ticks for four hits, so one is always lost;
windsor#736 would give them a tick each.

### A Euclid hold under swing (decision 4)

A Euclid part at 75% sixteenth swing: a pair is 12 ticks and its off-beat
lands at 75% of it, so a tick in the pair's first half lasts 1.5 straight
ticks and one in its second half 0.5. A hit on the downbeat (tick 0) whose
hold lasts six straight ticks (`hold` = 6 × `secondsPerTick`) is released
at straight time 6 by `trigger`. `unswingTicks(6)` = 6 ÷ 1.5 = 4, a whole
tick, so the note is written 0–4 and nothing is rounded. Played back, the
clock reaches tick 4 at `swingTicks(4)` = 6 straight ticks, the hold's
end. Converting at the tempo alone would write 0–6, and tick 6 is the
delayed off-beat at `swingTicks(6)` = 9: three straight ticks too long.

A hold of four straight ticks from the same downbeat inverts to tick
2.667. Its neighbours sound at `swingTicks(2)` = 3 and `swingTicks(3)` =
4.5, and 4.5 is nearer 4, so the note is written 0–3 and counted as one
tick rounded. Straight, both holds convert at the tempo and round nothing.

### A Euclid tail cut at the region's end (decision 4)

A Euclid part at 1/16 (6 ticks), 16 steps, with a hit on step 16, in a
one-bar region (ticks 0–96 of 4/4) at 120 BPM, straight: a tick is
20.83 ms. Its hold is 0.25 s, 12 ticks. The step-16 hit starts on tick 90
and `trigger` holds it to tick 102, six ticks past the region's end, and
the leave does not release it. The bounce writes 90–96, the region's end,
and the toast counts "1 Euclid tail cut at a region's end". In a longer
region the same hit on each earlier bar's step 16 runs into the next
bar's step-1 hit, if there is one, and is trimmed there by decision 4's
overlap rules; only the last bar's is cut by the region's end.

## Boundary cases

- **A part Vel of 0.** Every plain note plays at 0. With no accent, no
  played velocity is above the Vel, so the Vel stays 0 and each note is
  written at the event's own velocity (a Figure cell's, else 1) in place
  of 0 ÷ 0. The Roll then plays 0 × that = 0, as before. The Roll skips
  only a note whose own velocity is 0, so these notes still go out at
  velocity 0. They sound on a patch whose carriers' `velSens` is below 1
  (`velAmp = 1 − velSens + velSens × velocity`), as the generator's did.
  With accents, the Vel rises to the largest accented level (the bump),
  and a plain note's 0 ÷ bump is 0, which the Roll treats as a rest. Those
  notes are kept, written at 0, and counted ("5 notes at velocity 0
  silenced"). On a patch with full velocity sensitivity they were silent
  anyway.
- **A region that is all rests** (or all skipped) renders no notes. Its
  roll is empty and its loop is the region's length, as a newly drawn
  region's empty roll has (`2026-10-04-roll-sequencer` decisions 5 and
  14), so the loop keeps following the region when it is trimmed. It
  counts toward the regions in the toast. A part whose every region is
  empty bounces to "Bounced to Roll: 0 notes in 2 regions".
- **A slide on the region's last step.** The note slid from is lengthened
  to the slid-to onset + 1. The onset lies inside the region, so that end
  is at most the region's end, where the gate would have released it
  anyway, and the overlap is never less than the tick decision 7 needs.
  The slid-to note runs to the region's end. A slide
  over a loop's seam (from the last step of one bar into step 1 of the
  next) makes a note cross the bar line, which unrolls the region, as the
  second Grid example shows.
- **A note crossing the loop's end.** A Roll note is cut at its loop's end
  (the performer's `min(ticks, loopTicks − tick)`). So a rendered note
  that crosses a candidate loop's end rules that loop out, and the region
  falls back to a longer loop, or to its own length. A Grid tie on step 1
  does the same: on the first pass it ties to nothing and is silent, while
  on every later pass it carries the last note across the bar line. A
  note crossing the region's end can't happen: the gate releases a
  generator's notes there, and the bounce cuts a Euclid hold there
  (decision 4).
- **Several notes on one tick** (a Chord part's chord) are written as
  they are. Decision 7 never slides notes
  that start together.
- **Envelopes.** If the step values change at an onset but the loop
  wraps first, the wrap is a step that the clip-envelope player de-clicks
  (`clipEnvelopeTracks.ts`). A release tail still sounding across the
  wrap hears it. That is part of the gap below.

## What an envelope is not

A step's offsets are fixed on the voice at its note-on and held for that
note's life (`voiceStepMod.ts`). A clip envelope is part-wide: it moves
the part's voice slot, and every sounding voice follows it. The two agree
where one note sounds at a time. They differ in three places:

- **A release tail.** A note's tail hears the next onset's value, from
  1/64 tick before that onset.
- **Overlapping notes** on a poly patch (a chord, a long Euclid hold) all
  follow the latest onset's value.
- **A slide.** A slide keeps the `slideKeeps` rows (decay curve,
  feedback) of the note it slides from, while the envelope moves them at
  the slid-to onset.

An envelope also takes one of the part's 8 voice slots, shared with the
part's song lanes on voice targets (`clipEnvelopeAdmission.ts`). A part
whose lanes already hold all but fewer than 4 slots plays only the
envelopes that find one, while a step's offsets needed no slot. The build
counts an envelope that finds no slot ("1 envelope has no voice slot").

## The mockup

The mockup is today's Song view detail pane for a Grid part, captured
from the dev build in the project's headless Chrome on 2026-10-11 at a
1440 px window with the acid audition song loaded (Acid Saw, Grid, 16
steps at 1/16, 2 regions). Its header row and sequencer device are that
build's markup and styles. It proposes:

- **Bounce to Roll** after the summary note, 16 px clear of it, drawn as
  the console's `btn` at the size of the device's own buttons
  (Randomize, Reverse), so it sits in the 22 px header row without
  growing it. A toggle shows tacowars's other candidate, directly after the
  fold arrow. The mockup recommends after the note. The title then stays
  where it is on every pane (a chord's pane has no fold), the command sits
  beside the summary it acts on, and it stays clear of the fold arrow,
  which is pressed far more often.
- The states: enabled on a Grid part; disabled on a part with no regions,
  titled "No regions to bounce"; absent on a Roll part; the success toast
  (the captured song bounces to "Bounced to Roll: 24 notes in 2 regions ·
  8 accents lost their mod"); and the note-cap error toast.

## Consequences

- The build tickets, written once the mockup is approved, cover:
  - the render and the loop search: the engine function and its tests,
    with these examples as fixtures, and parity tests against the
    played part: a last-step Euclid hit whose hold crosses the region's
    end (written cut at the end, and counted); a swung Euclid hit (its
    written release sounds at the hold's end, to the nearest tick); a
    swung eighth-note ×4 ratchet across the off-beat (its hits sound at
    the engine's times, as worked above); and a 1/32 ×4 ratchet (three
    notes written, one hit counted lost);
  - the overlap slide in `RollSequencer`;
  - the command, its toasts and its undo label.
- `2026-10-04-roll-sequencer` listed per-note slide as not in v1, and its
  decision 6 plays overlaps as overlaps. The build amends it for decision 7;
  this record does not edit it.
- A bounced part's Vel may rise (decision 4). A note recorded into it
  afterwards (`2026-10-09-roll-recording`) is scaled by the new Vel.
- A bounce can only be undone. Re-generating a bounced part means undo,
  or setting its kind back and rebuilding the pattern, until Duplicate
  track lands.
