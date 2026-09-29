# Generative sequencing: one 24 PPQ transport, three modulator kinds, pitch sampled from a scale

- Date: 2026-08-31
- Links: builds on
  `docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md` ·
  follows #52 / PR #59 (Dattorro reverb) ·
  extends `docs/design/audio-architecture.md` §3 ·
  scope exception on the terms of
  `docs/log/2026-08-31-audio-enters-tech-demo-scope.md`

A design conversation with tacowars, recorded before any code exists. No
implementation was written; this record is the brief the sequencing ticket
works from.

The mixer record settled where sound *goes*. Nothing yet decides what makes
sound: no code calls `createMusicPart` or `createSfxPart`, so the client has
always been silent. This record specifies the first four parts and the
machinery that plays them.

tacowars's brief, verbatim in substance: a dry kick and a hi-hat with a little
delay, both driven by Euclidean sequencers whose density is modulated to create
movement over time; a short synth arpeggiator into a medium hall, up/down or
random with random misses; and a fourth part on a step sequencer with a
selectable step length from a whole bar down to 1/32, so that at slow settings
it plays long drones with the pad. tacowars notes the Euclidean sequencers are
wanted for gameplay rhythm regardless, so they are built as reusable
generators, not as music-only fixtures.

## Decision

### 1. One transport at 24 PPQ, fanning out to subscribers

`Scheduler` becomes a transport. Today it carries a single nullable `onStep`
handler (`scheduler.ts:26`) and one fixed `stepsPerBeat` — one clock, one rate,
one listener. Four sequencers at four rates need many subscribers, each holding
its own divisor **in ticks**.

The grid is 24 pulses per quarter note — the MIDI-clock standard — so every
step length tacowars asked for is an exact integer:

| Step | Ticks | | Step | Ticks |
|---|---|---|---|---|
| 1 (bar) | 96 | | 1/8 | 12 |
| 1/2 | 48 | | 1/16 | 6 |
| 1/4 | 24 | | 1/32 | 3 |

Triplets (1/8T = 8, 1/16T = 4) and swing (±1 tick) are then available without
touching the transport, though neither is built now. Cost is nil: at 96 bpm the
callback fires ~38 times a second and does an integer modulo per subscriber.

A single clock is the point. Everything stays phase-locked, which is what makes
the hat land *with* the kick rather than near it. Per-part `Scheduler`
instances were rejected for exactly that reason — they free-run and drift
audibly inside a bar.

### 2. Generators and bindings are separate

A sequencer emits *onsets*; a binding maps an onset to a part, a note and a
velocity. `EuclideanSequencer` knows nothing about `AudioPart`.

This is what makes the same generator drive a horde's footfall rhythm later
without dragging the synth in, and it is the seam that lets the sequencers be
tested headlessly against tick counts rather than against sound.

### 3. Euclidean density takes one of three modulator kinds

Each percussion sequencer holds `E(k, n)` with `n` fixed and `k` modulated
between bounds. The modulator is a tagged union, chosen per sequencer — tacowars
asked for all three rather than one scheme:

```ts
type DensityMod =
  | { kind: 'lfoBars'; bars: number; shape: 'tri' | 'sine' | 'saw' }
  | { kind: 'lfoHz'; hz: number; shape: 'tri' | 'sine' | 'saw' }
  | { kind: 'walk'; stepChance: number };
```

- **`lfoBars`** — bar-synced. The density peak lands on a downbeat, so the
  movement reads as a phrase. Coprime periods across parts (say 8 bars against
  3) give a long cycle before the two agree again.
- **`lfoHz`** — free-running on wall-clock time, deliberately unsynced. Density
  changes land mid-figure; that is the point, not a defect.
- **`walk`** — `k` drunk-walks ±1 per bar within bounds. Never repeats, no
  phrase structure.

**The pattern regenerates only on a bar line**, whichever modulator is chosen,
so a density change never re-cuts a figure mid-flight.

Rotation was offered as a fourth modulated parameter and declined. A static
`rotate` field on the pattern stays available; nothing modulates it.

### 4. Pitch is sampled from a weighted scale, not written

There is no chord progression and no fixed part. A shared sampler holds a root,
a scale, and a weight per degree; parts draw from it. Harmony emerges from the
weights and the register split rather than from an authored arrangement.

The arpeggiator and the step sequencer are **the same sampler at different
rates and registers** — the arp draws every 6 ticks in an upper octave, the
drone every 96 in a low one. That is the whole difference between them.

Consequences accepted: this is the least controllable of the options weighed,
and a note that sounds wrong is a weighting problem rather than an edit. In
exchange the bed never repeats, which for an ambient layer under a horde game
is the property that matters.

Each generator draws from its **own seeded PRNG stream**, so one part's
randomness cannot shift another's, and any pattern is reproducible in a test.

### 5. The arpeggiator holds a pool, then walks it

tacowars asked for both generative pitch and "up/down with random misses". These
reconcile if the arp does not hold a written figure but a **pool**: it samples
a few weighted degrees from the scale, refreshes the pool every few bars, and
walks that pool in `up | down | updown | random` with a per-step skip
probability.

"Random misses" is therefore one number — the chance a step rests — and it is
the same idea as Euclidean density arriving from the other direction.

### 6. The step sequencer is the drone

The fourth part is a step sequencer whose step length is selectable across the
six scales above. At 1/16 it is a sequencer; at 1 bar per step it holds one
note for a bar, which with `sub-drone` or `pad-drift` is a drone. There is no
separate drone system — a drone is this sequencer with a large divisor and a
gate at or near 100%, so notes tie rather than retrigger.

Gate length is a fraction of the step, and it must be allowed to reach 1.0 for
exactly this reason.

### 7. The four parts, and what they prove

| Part | Preset | Driver | Send |
|---|---|---|---|
| kick | `kick` | Euclidean | none — dry |
| hat | `hat` | Euclidean | a little delay |
| arp | `lead-bell` | pool + walk | medium hall |
| drone | `sub-drone` / `pad-drift` | step sequencer, slow | hall |

The set is chosen so that wiring it exercises every send state in the mixer
record — dry, delay-only, reverb, heavy reverb — rather than merely making
noise. It is the audible proof of a mixer that otherwise ships silent.

## Why

Two ideas carry most of this.

**One clock, many divisors.** Rate is the only difference between a hi-hat and
a drone, so it should be the only thing that differs in the code. A 24 PPQ tick
grid with per-subscriber divisors collapses what would otherwise be a drum
machine, an arpeggiator and a drone generator into one transport and three
divisors, and it keeps them phase-locked for free.

**One pitch source, many rates.** The same argument again, applied to notes.
The arp and the drone differ in draw rate and register, nothing else.

Both leave the seam in the right place for the gameplay use tacowars flagged: a
generator that emits onsets against a tick grid is as useful to a horde's
rhythm as to a hat, precisely because it knows nothing about audio.

Unchanged constraints: **audio never feeds back into simulation state**
(CLAUDE.md invariant 1 — "audio observes; it never decides"), so a sequencer
reading gameplay is fine and a sequencer *driving* it is not. Any frame-rate or
CPU claim about this needs a target-machine reading (invariant 3); none is made
here.

## Punted / alternatives

| Rejected | Why not |
|---|---|
| 1/32 base grid (`stepsPerBeat` 8) | Covers the six scales and nothing else — no triplets or swing without redoing the clock |
| 1/16 classic drum-machine grid | Puts the 1/32 hat tacowars asked for out of reach |
| A `Scheduler` per part | Free-running clocks drift audibly within a bar |
| Modulated rotation drift alongside density | Offered and declined; static `rotate` remains, unmodulated |
| A written key + chord progression module | Declined in favour of emergent harmony |
| Root + scale with fixed roles (arp on degrees, drone on root/fifth) | Static harmony; declined for the same reason |
| Absolute MIDI note arrays per sequencer | Transposition means editing every part, and nothing keeps parts consonant |
| Triplets and swing in the first build | The 24 PPQ grid leaves room; neither is needed to hear the bed |
| A patch-editor mixer/sequencer page | Deferred with the rest of the tooling question — see the mixer record §9 |

Key, scale, degree weights, register split and the LFO periods are all
deliberately left unset here. They are tuning by ear, not decisions by
interview; they land as defaults in the arrangement module and move when tacowars
listens.
