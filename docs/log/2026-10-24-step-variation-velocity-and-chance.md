# Step variation: velocity strays both ways, and Chance can roll per effect

- **Date:** 2026-10-24
- **Status:** accepted (the decisions are windsor#945's, agreed with
  tacowars before the work; the control's name, glyph, tooltip and place
  are the mockup tacowars approved on PR windsor#946).
- **Supersedes:** in `2026-10-24-step-variation`, decision 2 (the gate:
  one draw against Probability decides the whole step), decision 3's
  velocity rule (a fraction of the step's velocity of 1, held in
  `[velocityFloor, 1]`), decision 5's draw count (five) and the build's
  choice "Velocity only falls". Everything else in that record stands.
- **Mockup:** `docs/design/chance-per-effect-mockup.html`, with its frames
  `docs/design/chance-per-effect-proposed-*.jpg`.
- **Links:** this record's issue, windsor#945 · step variation,
  windsor#935 and its controls, windsor#936 (record
  `2026-10-24-step-variation-controls`) · format rules
  `2026-09-28-format-versions-refuse-never-destroy` · the listen,
  `docs/research/2026-10-24-step-variation/listen-velocity.mjs`

## Context

Two things in step variation did less than its knobs promised.

- **Velocity only fell.** A varied step sent its velocity as a fraction of
  the part's, `1 + z·σ`, held in `[velocityFloor, 1]`. A Grid or Arp note
  always plays at 1 of the part's velocity, so every upward offset was cut
  to 1: about half of the varied steps kept full velocity and the rest
  played quieter. Vary never made a note louder.
- **One roll decided everything.** A step drew once against Chance, and on
  a pass its velocity, pitch, gate and, with Rests sound on, its rhythm all
  varied together. At a low Chance a few steps changed a lot, and the
  others not at all. A line that wants its velocity to breathe on many
  steps while its pitch moves on few had no way to say so.

## Decisions

1. **A varied velocity is an offset in the part's velocity units.** The
   note-on carries `velocityOffset` (absent means none), and the part plays
   `clamp(velocity × (event.velocity ?? 1) + velocityOffset, velocityFloor, 1)`,
   then adds an accent's bump, at most 1 (`partNoteOn`). The floor comes only
   with an offset, so a Figure cell written at velocity 0 stays silent and a
   Figure line plays exactly as before. The offset is
   `z × velocitySigma × randomness` (`variedVelocity`), sent only when it is
   not 0. `velocitySigma` stays 0.2, now a fifth of the full velocity range,
   up or down. The Grid and the Arp no longer send a `velocity` fraction.
2. **The part's Velocity knob is the headroom.** An upward offset clips at
   1, so at the default 0.8 a strong upward offset plays 1, and at Velocity
   1 every upward offset plays 1: Vary is heard both ways only below full
   Velocity. The Vary knob's tooltip says velocity strays up or down.
3. **A ratcheted varied step plays every hit at its varied velocity.** The
   roll's hits all go through `partNoteOn` with the step's event, offset
   included (`pitchedRoll.ts`).
4. **Bounce to Roll writes a varied note's played velocity**, offset and
   clamp included, over the part's Vel, as it writes any other played level
   (`bounceRenderCapture.ts`, `bounceToRoll.ts`). The capture already plays
   each note through `partNoteOn`, so it needed no code of its own; a test
   pins it.
5. **Per effect: a switch that rolls Chance for each effect.** The Grid and
   the Arp carry `chancePerEffect`, default false.
   - **Off:** the first roll decides whether the step varies, and every
     effect varies together, as before.
   - **On:** each effect rolls Chance on its own draw: the flip (it matters
     only with Rests sound on), velocity, pitch (Octave mode included) and,
     on the Arp, the gate. An effect whose roll fails plays as written. At
     Chance `p` a Grid step then has at least one passing roll with
     probability `1 − (1 − p)²` and an Arp step `1 − (1 − p)³`, with Rests
     sound off: at Chance 0.1, 19 % and 27.1 % (sampled in
     `stepVariation.test.ts`).
6. **Eight draws a step.** Whenever Vary and Chance are both above 0, every
   step makes `STEP_VARIATION_DRAWS` = 8 draws, in this order: the first
   roll (the flip's own roll with the switch on), the flip value, the
   velocity, pitch and gate values, then the velocity, pitch and gate
   rolls. All eight are drawn whatever the switch, the knobs or the step,
   so toggling the switch, moving either knob or editing a step never moves
   another step's draws. The Grid draws a gate value and a gate roll it
   never reads.
7. **Format.** Decision 1 changes what a saved Vary plays and decision 6
   changes every varied stream, so a version-19 song with Vary and Chance
   above 0 plays a different, still repeatable, variation. No upgrade can
   replay the old one. `ARRANGEMENT_VERSION` goes to 20, and
   `SONG_MIGRATIONS[19]` adds `chancePerEffect: false` to every Grid and
   Arp sequencer and region pattern and changes nothing else. No song in
   `songs/` sets Vary above 0. A rack carries no lanes and the normaliser
   fills the new field, so `RACK_FILE_FORMAT` stays.
8. **The control** is a third glyph toggle drawn as Rests sound and Octave
   are (`.seq-icon.variation-toggle`, `aria-pressed`), as the approved
   mockup draws it:
   - **Name** (its accessible name): Per effect.
   - **Glyph:** a die showing three pips.
   - **Tooltip:** "Per effect: Chance rolls separately for velocity, pitch,
     the Arp's gate and, with Rests sound on, a rest or note flip, instead
     of once for the whole step".
   - **Place:** on the Grid it wraps under Rests sound at the pair's 47 px,
     the three centered in the third row of the Vary and Chance column, at
     no width (the device stays 965 px); on the Arp it takes the toggle
     column's empty first row, level with Gate (976 px, unchanged).
   - Chance's tooltip does not change. Like the other two toggles, it has
     no lane.

## Choices made in the build

- **A part at Velocity 0 with Vary up plays its varied notes**, at the floor
  and above, since decision 1's formula adds the offset to 0 and the floor
  comes with any offset. Before, a varied note at Velocity 0 played 0. A
  one-line change in `partNoteOn` if tacowars hears otherwise.
- **With the switch on, a step whose rolls all fail is a step that plays
  as written** (`variationAt` returns null), exactly as an unvaried step
  with the switch off; a step with only the flip's roll passing and Rests
  sound off plays as written too.
- **Octave on folds an Arp cell's own octave shift into the pitch** even on
  a step whose pitch roll failed. The note is the same, since the shift is
  0 octaves.

## The listen

`docs/research/2026-10-24-step-variation/listen-velocity.mjs` renders the
Grid line and the Arp of the first listen, four bars each at 125 BPM in C
minor, at part velocity 0.6 and Vary 1, Rests sound and Octave off: a
reference with nothing varied, then Chance 0.2 and 1, each with Per effect
off and on (10 files), to `~/Desktop/step-variation-velocity-listen/` with
a `pitches.txt` of each file's note-ons and their played velocities per
bar. The voice is `acid-saw` with every operator's velocity sensitivity at
1.
