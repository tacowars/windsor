Yes. With those decisions, the design is much tighter. I’d now treat this as a **clean replacement of the current harmony/generative sequencing layer**, not an evolution of the old one. Since you explicitly do not need old song documents to load, we can remove the legacy `arp`, `step`, degree-weight harmony behavior, and any compatibility normalization rather than carrying parallel semantics. That is especially useful here because the current architecture still explicitly defines `arp` and `step` as key-driven generators and `chord` as its own progression owner. 

## Provisional design

### 1. Global musical transport

Add a compact transport strip across the top of the console, visually closer to the Ableton example you showed:

```text
120.00   4 / 4   1 Bar       C   Natural Minor       1 . 1 . 1    ▶  ■
 BPM     TIME    LOOP/GRID    KEY      SCALE          POSITION
```

I would make this persistent across tabs rather than belonging to Harmony.

For the MVP:

* BPM is global.
* Time signature defaults to **4/4**.
* Position is displayed as **bar.beat.subdivision**.
* Play and Stop are always visible.
* Harmony and sequencers use musical time, never seconds.
* Bars are the principal arrangement unit.
* The existing 24-PPQ transport can remain the actual timing substrate; this is mostly a clearer musical abstraction over it. The architecture already has the central scheduler/tick model we need. 

I would **not support time-signature changes within a song in the first version**. One song has one meter.

---

# 2. Harmony becomes the authoritative timeline

The Harmony tab stops being:

> key + scale + weighted degrees

and becomes:

> key + scale + arranged chord progression

For example:

```text
C Natural Minor

BAR        1        2        3        4        5        6
        ┌────────┬────────┬───────────────┬──────────────┐
        │   i    │   VI   │      III      │     VII      │
        │  Cm    │  Ab    │      Eb       │      Bb      │
        └────────┴────────┴───────────────┴──────────────┘
```

Each harmony event owns:

```ts
{
  degree: 0,
  start: ...,
  duration: ...,
  chordSize: 3
}
```

Eventually:

```ts
chordSize: 3 | 4
```

can be chosen **per chord**, exactly as you described.

For MVP, though, I'd be comfortable making every chord a triad and leaving the schema capable of carrying `chordSize` later.

Because the present chord theory already generates diatonic tertian stacks, we should reuse that directly rather than storing chord quality or chord names in the document. 

So:

```text
key + scale + degree + chordSize
```

determines the pool.

---

# 3. Harmony events are deterministic, not generative

I agree with you here: **there should be no runtime randomization of the chord progression.**

The timeline is authored.

If later we want:

> Generate me an 8-bar progression

that should be an **editor command** which writes a concrete progression into the timeline. Once written, it is no longer random at playback time.

That keeps the musical structure reproducible and understandable.

---

# 4. Chord changes affect only future note-ons

This is now a firm semantic rule:

> A harmony change changes the note pool used by subsequent note-on events. Existing voices continue naturally.

So if a pad has:

```text
Cm: C3 held for four seconds
```

and Harmony changes to A♭ while C3 is still sounding, we don't kill or retune C3.

That's both musically sane and much simpler for the voice lifecycle. Your synth already treats sustained notes as independent voices with their own release/lifecycle behavior, so we don't need to introduce pitch mutation into that layer. 

---

# 5. Replace legacy Arp with a new Arpeggiator

I would build this from scratch rather than mutate the old one.

Its pitch input is:

```text
active Harmony chord
          ↓
     chord-tone pool
          ↓
      arp voicing
          ↓
       arp style
          ↓
    rhythmic note-ons
```

So if Harmony says:

```text
C minor = C Eb G
```

the arp might turn that into:

```text
C3 Eb3 G3 C4 Eb4 G4
```

depending on its voicing/range.

Then a Style chooses traversal.

### MVP styles

Borrowing from the Ableton model, I'd start with a useful subset:

```text
Up
Down
UpDown
DownUp
Converge
Diverge
Random
Random Other
Random Once
```

The schema should use a string enum so adding:

```text
Up & Down
Pinky Up
Thumb Up
Play Order
Chord Trigger
...
```

later is trivial.

I don't think we need to clone every Ableton behavior immediately.

### Arp controls

Something roughly like:

```text
Style        UpDown
Rate         1/8
Gate         50%
Octaves      2
Voicing      Close
Retrigger    Off
Seed         18472931       [Reseed]
```

Possibly velocity/accent later.

The important conceptual separation is:

**Harmony determines which notes are valid.**

**Arpeggiator determines where those notes sit and in what order/timing they are played.**

---

# 6. Random arp behavior is deterministic

I like your seed idea.

I would make **the seed belong to the sequencer itself** rather than having only one song-global random seed.

Example:

```ts
sequencer: {
  kind: "arpeggiator",
  seed: 284193725,
  style: "randomOther",
  ...
}
```

Then:

```text
Reseed
```

just writes a new value into the song document.

That means:

* reopen the song → identical pattern,
* export/import → identical pattern,
* restarting transport → identical pattern,
* hit Reseed → new pattern,
* changing the bass seed does not unexpectedly alter the arp.

This is cleaner for authoring than coupling every generator to the arrangement's one current PRNG seed. The existing system currently derives generator streams from an arrangement seed, so this would intentionally simplify/change that ownership. 

One detail I'd make explicit: restarting playback from bar 1 should restart the generator's PRNG sequence, so identical transport position + identical document always produces identical music.

---

# 7. Replace Step with Bass / Drone

This also deserves a completely new sequencer.

I think Scaler's distinction gives us a very good foundation, but we can make it slightly more general.

I'd give it three pitch behaviors:

### Follow Root

```text
Cm → C
Ab → Ab
Eb → Eb
Bb → Bb
```

Traditional bass-follow behavior.

### Follow Chord

Uses the entire active chord pool but biases selection toward the root:

```text
Root Bias: 80%
```

So over Cm:

```text
C  C  G  C  Eb  C ...
```

This covers the richer bass-line behavior you mentioned.

### Fixed

A pedal note independent of Harmony:

```text
Fixed: C2
```

Harmony might do:

```text
Cm → Ab → Bb → Fm
```

while bass remains:

```text
C C C C
```

That's exactly the cinematic/pedal behavior you're after.

I like those better than making `rootOnly` a separate Boolean because they form one understandable musical choice:

```ts
pitchMode:
    "followRoot"
  | "followChord"
  | "fixed"
```

and `rootBias` only applies to `followChord`.

---

# 8. Bass/Drone also owns rhythm

To replace Step properly, it needs more than pitch selection.

I'd envision:

```text
Pitch Mode      Follow Chord
Root Bias       80%

Rate            1/4
Gate            70%
Octave          2
Density         65%
Seed            527192       [Reseed]
```

But I'd make the rhythmic model deliberately simple at first.

There are two useful extremes:

**Bass**

```text
shorter gate + repeated triggers
```

**Drone**

```text
long gate + slow rate / sustained notes
```

That means we probably don't actually need separate "Bass" and "Drone" engines. They're two uses of the same sequencer.

---

# 9. Grid remains explicitly composed

Still no change here.

Grid continues to mean:

> These exact scale-relative pitches were written by the composer.

It does **not** get forced into current chord tones.

That's useful because otherwise we'd have no straightforward way to write passing notes, suspensions, melodies or deliberate non-chord tones.

The current Grid already represents authored scale-degree steps, so this preserves that distinction. 

Later:

```text
Pitch interpretation:
Written
Chord-relative
```

could be interesting, but not MVP.

---

# 10. The current Chord sequencer becomes a performer

This follows our earlier conclusion.

It should no longer own:

```text
i → VI → III → VII
```

because Harmony owns that.

Instead, it receives:

```text
activeChord
```

and decides how to sound it.

So eventually it might have:

```text
Rhythm
Gate
Repeat
Voicing
Octave
Velocity
Strum
```

The current implementation already separates chord construction from inversion/voicing/range after the fact, which makes this refactor conceptually clean. 

I would probably rename this from `chord` to something like:

```text
Chord Player
```

inside the UI even if the internal kind remains `"chord"`.

---

# 11. Clean song document

Because this is intentionally a clean break, I'd increment the document version and remove dead concepts outright.

Something along these lines:

```ts
{
  version: 3,

  transport: {
    bpm: 120,
    numerator: 4,
    denominator: 4
  },

  harmony: {
    key: 0,
    scale: "natural-minor",

    events: [
      {
        start: 0,
        duration: 4,
        degree: 0,
        chordSize: 3
      },
      {
        start: 4,
        duration: 4,
        degree: 5,
        chordSize: 3
      }
    ]
  },

  parts: [
    {
      slot: 0,
      sequencer: {
        kind: "arpeggiator",
        style: "upDown",
        rate: "1/8",
        gate: 0.5,
        octaves: 2,
        voicing: "close",
        seed: 1938271
      }
    },

    {
      slot: 1,
      sequencer: {
        kind: "bass",
        pitchMode: "followChord",
        rootBias: 0.8,
        rate: "1/4",
        gate: 0.8,
        seed: 772913
      }
    }
  ]
}
```

Illustrative only, but that is the conceptual shape I'd target.

And because you don't want migrations:

```text
version 2 → unsupported
version 3 → new engine
```

Delete the compatibility code when we cross that boundary rather than keeping obsolete paths alive.

---

## Remaining decisions

I think we're down to a much smaller set now. None needs to block the overall architecture, but I'd settle these before writing the implementation ticket:

1. **Harmony timeline granularity.** I recommend allowing chord boundaries on the existing musical tick grid, but having the UI snap to **bars by default**. That gives you simple `1 bar / 2 bars / 4 bars` arranging while still allowing half-bar or beat-level changes later without changing the data model.

2. **Loop ownership.** I recommend a song-level loop region in the transport, independent of the Harmony progression length. Harmony can simply repeat its timeline across the song/loop. This is more flexible than making "progression length" equal "song length."

3. **Gaps in Harmony.** I recommend **no gaps**. Extending/moving one event should always leave an active chord. The previous harmony event effectively holds until the next one. It avoids an awkward meaning for "no chord" in arp/bass generators. We can deliberately add `N.C.` maybe. but I need the ability to mute/silence a sequencer on a chord step because dub chords echo for a long time sometimes. a rest mechanism that can stop feeding notes to a specific sequencer is needed. 

4. **Fixed Bass representation.** tacowars's note: ChatGPT recommended an actual MIDI note such as `C2`, not merely scale degree `0` saying "Fixed" should mean genuinely fixed. If we later transpose the whole song, we can decide whether a separate transpose operation moves pedal notes too. But I'm not sure I understood the motive for this and it seems to complicate matters. if fixed bass is difficult we can save it for later.

5. **Arp voicing semantics.** I recommend using the same underlying voicing vocabulary as the Chord Player where sensible, but letting the arp additionally specify octave span. That keeps "Close / Spread / Drop..." consistent across instruments without coupling the two performers.

6. **Triad/seventh schema.** Even if the UI is triads-only in MVP, I'd put `chordSize` on each harmony event from day one. That's tiny and avoids a schema change for the feature you already know you want.

I think that gets us to the point where the next useful artifact is an **implementation plan organized by engine/schema → Harmony resolver → new sequencers → console UI → removal of legacy code → tests**, with explicit files from your existing architecture for each step.
