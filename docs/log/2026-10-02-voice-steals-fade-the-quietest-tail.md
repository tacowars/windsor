# A voice steal fades over 30 ms and takes the quietest released tail

- **Date:** 2026-10-02
- **Status:** accepted and built (windsor#410). Awaits tacowars's listen.
- **Research and measurements:** `docs/research/2026-10-02-voice-stealing/README.md`
- **Deferred:** counting the limit in held notes, windsor#411

## Context

A slow pad with a long release popped on every chord hit once its tails
filled the part. Ambient Evolving Strings (`spread: 11`, two voices a note)
under a Chord sequencer playing a triad every bar needs 6 voices a hit, and
a music part sounds 12. From the third hit on, the part stole 4 released
tails, still at a good level, with a 4 ms linear fade. The fade was the
pop: a headless render measured the hit's second difference at 5x to 20x
the pad's own motion. The pool held the limit plus 4, so the fifth and
sixth steal of a hit found no free slot and cut a voice outright.

Other synths fade a stolen voice over 10 to 50 ms (Kontakt 10 ms, Surge XT
about 11 ms, Helm 20 ms, Vital 50 ms), and the Juno-X's LOUDEST priority
turns off the lowest-volume voice first. Windsor's 4 ms was the shortest
fade found.

## Decision

1. **A steal fades over 30 ms** (`STEAL_FADE_SECONDS`, `fmConstants.ts`),
   from the level the voice plays at, through `stealVoice` in
   `voiceSteal.ts`. 30 ms sits inside the range other synths use, and holds
   the pad's hits to its own motion.
2. **The quietest released voice is stolen**, not the oldest: its carriers'
   amplitude ramps summed (`voice.amp`, velocity and envelope included),
   the older of two equal ones. With no released voice the oldest held one
   is stolen, as before, and a dormant voice is still taken first and
   killed (#547).
3. **The reserve is at least the limit and at least 16**
   (`STEAL_RESERVE_MIN`), so the pool is the limit plus
   `max(limit, 16)`, built once at construction. The issue expected a
   reserve of the limit. At the music part's 12 that pool (24) still cut 6
   voices over the eight-bar loop for an eight-note chord with `spread`,
   which steals 16 voices at once; a reserve of 16 (a pool of 28) cuts
   none. At the
   processor's default of 16 voices and above, the reserve is the limit.
4. **An exhausted pool cuts the fading voice nearest the end of its fade**
   (`nearestFadeEnd`), not the oldest voice.
5. **The sounding limit stays at 12** for a music part. Counting it in held
   notes is windsor#411.
6. **The reserve past the pool's first four slots seeds from its own
   stream** (`reserveRandom`). Each voice draws two seeds from the part's
   random stream as it is built, so 12 more voices would have moved every
   seeded note's free phase and pan jitter, and every golden with them.
   Those voices draw their seeds from a stream seeded by the last streamed
   voice and play from the part's stream, so a render that never steals is
   bit-identical.
7. **The 4 ms `Voice.steal` stays for the mono cut (#453) and a held End
   level (windsor#7).** Neither is a full pool's steal. A 30 ms overlap
   under a mono retrigger would smear the new note's attack, and both are
   pinned by tests the issue keeps.

## Consequences

- A chord over a full part plays the stolen tails out over 30 ms. Up to 16
  more voices can sound for that time, and the CPU bars show them.
- A part's pool grows from the limit plus 4 to the limit plus
  `max(limit, 16)`: 28 voices for a music part. Construction allocates
  them; the render still allocates nothing.
- Goldens, kernel parity and the allocation tests are unchanged.
