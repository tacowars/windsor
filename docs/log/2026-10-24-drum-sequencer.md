# The Drum: a step sequencer kind of its own for written drum lines

- **Date:** 2026-10-24
- **Status:** accepted (the decisions are windsor#948's, agreed with
  tacowars before the work; the defaults are proposed values for
  tacowars's listen, not settled ones).
- **Links:** this record's issue, windsor#948 (Drum sequencer 1/4) · the
  device mockup, windsor#949 (2/4) · the pattern bank, windsor#950 (3/4) ·
  the device build, windsor#951 (4/4) · step variation, records
  `2026-10-24-step-variation` and
  `2026-10-24-step-variation-velocity-and-chance` · ratchets, record
  `2026-10-01-sequencer-rack-devices` decision 6 · region patterns, record
  `2026-09-29-each-region-plays-its-own-pattern` · format rules
  `2026-09-28-format-versions-refuse-never-destroy` · the listen,
  `docs/research/2026-10-24-drum-sequencer/listen.mjs`

## Context

tacowars's music is drum-heavy, and until now a drum line in Windsor was
either a Euclid, whose hits are generated rather than written, or a Grid,
which is pitched by scale degree and holds each note to the next step. A
drum pattern is neither. It is written hit by hit, at one fixed note, each
hit with its own velocity (a ghost note is a quiet hit, not another sound),
an accent, sometimes a roll, and on a tuned drum sometimes a pitch; and a
hit releases at a gate, not at the next note. Bending the Grid to that
would mean a degree that means nothing, a tie and a slide a drum machine
has no use for, and no velocity per step. The Euclid has no written line at
all. So the Drum is a kind of its own: one part, one patch, a written line
of up to 32 steps.

With it tacowars programs a kick, a snare with ghost notes, a hat pattern
with rolls, a tom roll that falls in pitch, or a bassline on a long kick,
each on its own part.

## Decisions

1. **The kind is `drum`**, appended to `SEQUENCER_KINDS` and `SEEDED_KINDS`
   (it draws for step variation). Its label in the app is **Drum**, and its
   lane tone is `perc`, as the Euclid's.

2. **The config** (`DrumSequencerConfig`, `sequencing/drumSequencer.ts`):
   - `divisor`: a note divisor, default a sixteenth.
   - `steps`: 1 to `GRID_STEPS_MAX` (32) written steps; `length`: the loop,
     1 to `steps.length`. Steps past `length` stay in the document, as the
     Grid keeps them. A new part starts with one bar of sixteenths in the
     song's meter (16 in 4/4), all rests but hits on local steps 0, 4, 8
     and 12 at velocity 1, so a new Drum part sounds; `length` is the same
     count.
   - `note`: the base MIDI note, 0 to 127, default 60, where the drum bank
     is tuned.
   - `gate`: the fraction of a step's swung span a hit is held,
     `[GATE_MIN, 1]`, default `DRUM_GATE_DEFAULT` = 0.5. A gate, not the
     Euclid's hold in seconds, so the `seq.gate` lane works and a hit
     follows the tempo.
   - `accentVelocity` and `accentMod`, as the Grid's.
   - The five step variation fields: `randomness`, `probability`,
     `restsSound`, `octaveMode`, `chancePerEffect`, at their defaults.
   - `seed`, and `lanes`: step-mod lanes as the Grid's, kept as long as
     `steps` by the normaliser.

   Its own tunables are `sequencing/drumConstants.ts`: `DRUM_GATE_DEFAULT`
   0.5, `DRUM_PITCH_MAX` 24 and `DRUM_DEFAULT_HITS`.

3. **A step** (`sequencing/drumSteps.ts`) is `{ kind: 'rest' }` or a hit:
   `{ kind: 'hit', velocity?, accent, pitch?, ratchet? }`. `velocity`
   scales the part's, 0 to 1, absent 1; `pitch` is whole semitones added to
   `note`, within ±`DRUM_PITCH_MAX`, absent 0; `ratchet` is 1 to
   `RATCHET_MAX`, absent one hit. No tie and no slide: a hit's length is the
   gate. The normaliser clamps velocity, pitch and ratchet and reports junk,
   as the Grid's step normaliser does.

4. **What a hit plays.** At local step `s = count mod length`, a hit strikes
   `note + pitch` at the step's tick, moved by whole octaves into 0 to 127
   when the sum leaves it, through `partNoteOn` with the step's velocity as
   the note-on's `velocity` (as a Figure cell's), the accent's bump and mod
   when accented, and the step-mod lanes' offsets at `s`. Its note-off
   comes at `gate` of the step, as the Arp holds a cell with its gate, and
   never later than the next step's tick. A ratchet of `n` plays `n` hits
   spaced evenly over the step's swung span, each held `gate × span / n`,
   at the step's velocity and accent, through the same roll the Grid's and
   the Arp's ratchets play (`rollSpan.ts`, `pitchedRoll.ts`). A rest plays
   nothing and releases nothing, since a hit has already released at its
   gate.

5. **Step variation** maps onto the Drum as onto the Arp, through
   `stepVariation.ts`'s helpers, with the same eight draws a step in the
   same order whenever both amounts are above 0, rest included:
   - **Velocity:** a velocity offset (the Chance record's decision 1) over
     the hit's own velocity.
   - **Pitch, Octave on:** the played note moves by whole octaves, kept
     inside MIDI.
   - **Pitch, Octave off:** the hit borrows the `pitch` of the hit a normal
     offset away (σ `stepJumpSigma × length × randomness` steps, wrapping
     over the loop), the nearest hit when that step is a rest.
   - **Gate:** the played gate moves by `gateSigma × randomness`, held in
     `[GATE_MIN, 1]`, as the Arp's.
   - **Rests sound on:** a hit may rest and a rest may sound, at the beat
     and off-beat rates. A rest that sounds plays the nearest hit's `pitch`
     and `velocity` with no accent and no ratchet, so a ghost region stays
     ghostly. A silenced hit plays no ratchet hits.
   - **Per effect** rolls each effect on its own draw, as the Chance
     record's decision 5.

6. **Lanes.** `drum` offers `seq.gate`, `seq.randomness` and
   `seq.probability`, read on the step through the region gate's overrides
   as the Arp reads them. Step-mod lanes ride on each hit's note-on as the
   Grid's do.

7. **Regions and the player.** The Drum is a generator `partGenerators.ts`
   builds, rebuilds, reconfigures live and releases. It ticks through the
   region gate, its stream `hashSeed(seed, regionIndex)` minted at region
   entry; its `stepAt` is the local step mod `length`, for the device's
   playhead, and `regionStepAt` reports it. A region's pattern carries the
   whole config but the seed, as every kind's does. A rack may carry a
   `drum` sequencer, since the rack loader takes any kind in
   `SEQUENCER_KINDS`.

8. **Format.** Additive: a new kind that no saved song or rack names.
   `ARRANGEMENT_VERSION` and `RACK_FILE_FORMAT` do not move.

9. **The app compiles and the registries pass.** `KIND_LABELS.drum` is
   "Drum"; a stub `drumCard.ts` draws the hint "The Drum device is on its
   way." in `SEQUENCER_CARDS`; `songViewTables.ts` has the Drum's
   `LANE_TONE` (perc), `REGION_SUMMARY` (`drum · <length> steps ·
   <divisor>`) and `CYCLE_TICKS` (`length × divisor`). The sequencer select
   then offers Drum, which is intended. The device itself is windsor#951.

## The plan

1. windsor#948, this record: the engine's kind, the normaliser, the player
   wiring and the minimum the app needs to compile, with the listen.
2. windsor#949: the Drum device's mockup, for tacowars's approval.
3. windsor#950: the pattern bank, thirty-three rhythm presets for the Drum.
4. windsor#951: the Drum device, built to the approved mockup.

## Choices made in the build

These follow from the decisions but were not spelled out in them; each is a
line to change if tacowars hears otherwise.

- **The gate rounds to whole ticks**, at least one and at most the step,
  as the Arp's does: at a sixteenth (6 ticks) gate 0.5 holds 3 ticks and
  `GATE_MIN` 1 tick. The note-off goes out on that local tick, which the
  clock issues at its swung time, so the hold is the gate's share of the
  swung step wherever the step sits inside one half of a swing pair (every
  sixteenth on the 16th grid). A ratchet's hits are placed and held in
  seconds over the swung span, as every roll is, with no rounding.
- **A ratcheted hit leaves nothing held.** Every hit of its roll is a fixed
  note held `gate` of its slice, the last one too, so at gate 1 the last
  hit ends on the next step's start. A region end or a loop jump inside the
  roll drops the hits past it, as for every roll.
- **The normaliser reads a hit's absent fields as a plain hit**: a step
  with no `kind` is a hit, a `tie` (the Grid's word) becomes a hit with a
  report, and a `velocity` of 1, a `pitch` of 0 or a `ratchet` of 1 leaves
  no key, so an export carries no default.
- **A hit sends degree 0 on its note-on.** The Drum is not drawn from the
  scale; nothing that plays a Drum part reads the degree.
- **The Drum does not bounce to a Roll yet**, and offers no pattern actions
  (Randomize, Reverse, Reseed) on the Song lane's menu: both come with the
  device, windsor#951, and the engine's and the app's `BOUNCE_KINDS` leave
  it out until then.
- **The Drum bounces to a Roll** (windsor#958): `drum` is in both
  `BOUNCE_KINDS`, and the bounce's own capture writes its hits, ratchets,
  varied steps, baked `seq.*` lanes and step-mod envelopes, with nothing
  Drum-specific added.
- **A rest that sounds then varies like any varied hit**, as on the Grid:
  its pitch may borrow or move by octaves, and its velocity and gate vary.
- **The new part's four hits sit on steps 0, 4, 8 and 12** whatever the
  meter's bar: a 12-step bar in 3/4 keeps 0, 4 and 8, a 24-step bar in
  12/8 has nothing past 12.

## The listen

`docs/research/2026-10-24-drum-sequencer/listen.mjs` renders four bars at
128 BPM per file, each line on its own shipped patch with every operator's
velocity sensitivity at 1 and the part at velocity 0.8: a kick line with a
quiet hit on the last sixteenth, a snare with accented backbeats and ghost
notes, a closed hat of three velocity levels with rolls of 2 and 3, a tom
roll falling in pitch, a bassline on a long kick at gate 0.9, then the snare
at Vary 0.5, Chance 0.5 with Rests sound on, and the hat at Vary 0.5,
Chance 1 with Per effect on: seven files, written to
`~/Desktop/drum-sequencer-listen/` with a `hits.txt` naming each file's
hits per bar (step, played velocity, played note).
