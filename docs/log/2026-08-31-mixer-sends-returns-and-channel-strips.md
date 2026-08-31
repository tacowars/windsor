# The mixer: one plate on a return, sends per part, a strip in code

- Date: 2026-08-31
- Links: follows #52 / PR #59 (Dattorro reverb) ·
  extends `docs/log/2026-08-31-dattorro-reverb-not-plateau.md` §2 ·
  extends `docs/design/audio-architecture.md` §3 ·
  scope exception on the terms of
  `docs/log/2026-08-31-audio-enters-tech-demo-scope.md`

A design conversation with Pat, recorded before any code exists. No
implementation was written; this record is the brief a later ticket works from.

PR #59 settled *that* a reverb space is shared rather than owned by a `Patch`.
It did not settle where the plate sits in the graph, where a send amount is
authored, or what the rest of a channel strip looks like. This record answers
those, and corrects one thing PR #59 is easy to misread about.

## The correction: what #59 actually shipped

The decided architecture was a per-part send. The merged graph is not that.
`attachReverb` (`packages/client/src/audio/audioBus.ts:55`) takes a single
`source` — the bus's own tail — and a single `wet` gain:

```
bus.input ─▶ [highpass] ─▶ [delay insert] ─┬────────────────────▶ bus.output ─▶ master
                                           └─▶ [plate 100% wet] ─▶ wetGain ─▶ bus.output
```

So the plate is an effect **owned by the music bus**, with one bus-wide amount
(currently `0.3`, `audioSystem.ts:44`). Every part connected to
`musicBus.input` receives the same send, because only one exists. The "amount
as a gain outside the plate" property #59 established is real and correct — it
was simply built one level too high to be a send.

This was invisible at merge time and remains harmless today, because nothing in
the client creates an audio part at all: no code calls `createMusicPart` or
`createSfxPart`, so with one bus and zero parts, bus-wide and per-part describe
the same graph. There is no existing mix to preserve and nothing to A/B
against.

## Decision

### 1. The plate leaves the bus and becomes a return

`createBus` stops owning a reverb. A plate becomes a **destination** that
anything can feed, and the single `wet` gain splits into two controls that a
desk keeps separate: a `sendGain` per part (how much of *me* goes to the room)
and a `returnGain` on the plate itself (how loud the room is).

```
part.output ─┬─ [rotate θ] ─▶ musicBus ─▶ [highpass] ─▶ master ─▶ limiter ─▶ destination
             ├─ reverbSend ─▶ [plate 100% wet] ─▶ return ─▶ master
             └─ delaySend  ─▶ [delay]          ─▶ return ─▶ master
```

A bus goes back to being what it should be: a dry summing point with inserts.
The pay-off is that a second plate is then cheap — another return entry, not
another bus, and not a second routing concept.

### 2. Mix data is a typed module beside `SPACES`

Levels, pans and sends live in one table keyed by part name, in code:

```ts
export const RETURNS = { room: { space: SPACES.hall, level: 0.9 } };

export const MIX = {
  pads:  { level: 0.8, pan: 0,   sends: { room: 0.45 } },
  bass:  { level: 0.9, pan: 0,   sends: { room: 0.05 } },
  place: { level: 0.9, pan: 0.3, sends: { room: 0.08 } },
} satisfies Record<string, ChannelStrip>;
```

One file is the desk: readable in one screen, diffable, typed, testable, inside
`npm run verify`. Adding a short plate for percussion later is one `RETURNS`
entry plus the sends that name it.

The cost accepted: mixing is a code edit rather than a knob. That is tolerable
now and only now — see §9.

### 3. `patch.volume` is normalisation; `part.gain` is the mix fader

Three gain stages already exist. The ruling assigns each exactly one job:

| Stage | Where | Means |
|---|---|---|
| `patch.volume` | per voice, `fm-processor.js:787` | how loud this preset is *designed* to be — trimmed by ear in the patch editor so presets peak alike |
| `gain` param | per part, `fm-processor.js:1006` | how loud it sits in **this** mix — the only fader `MIX` touches |
| `master` | `fmEngine.ts:40` | one duck for the whole synth |

Neither of the first two is redundant, and mixing never means editing sound
design. A useful consequence: `MIX.level` needs no new `GainNode`. The k-rate
`gain` param is already surfaced as `AudioPart.gain` (`audioPart.ts:40`, range
0–4), so a strip's fader is one multiply per block inside the worklet.

### 4. Strip pan is a rotation matrix, not `StereoPannerNode`

Every part's worklet output is **already stereo** — `pan`, `panKey`,
`panRandom` and `spread` place voices across the image *inside* the part
(`fm-processor.js:1160-1161`). Per the Web Audio spec, a `StereoPannerNode` fed
a stereo input does not reposition it; it switches to a balance law that
attenuates one side. Panning a wide pad right would not move it — it would mute
its left half and collapse it.

The strip therefore pans with a splitter → four gains → merger rotation:

```
L' = L·cos θ − R·sin θ
R' = L·sin θ + R·cos θ        θ = pan · π/4
```

Width is preserved and the centre actually moves. Roughly six native nodes per
part, all in the audio thread.

This also draws the line between the two pans: the ones in `Patch` are voice
placement *within* the channel (sound design); `MIX.pan` is where the channel
sits in the image (mix).

### 5. The delay becomes a second send/return

The delay is presently a parallel wet/dry blend inside the bus
(`audioBus.ts:120`) — an insert. Once reverb is a send, it is the odd one out.
It becomes its own return with per-part sends, so percussion can have echo
without the pads getting it. A desk with two aux sends.

### 6. One plate instantiated, N by construction

The return API supports several plates and `MIX` names which return each send
feeds — but exactly one (`SPACES.hall`) is created until a mix demands a
second. No unmeasured DSP runs for nothing: the ~1% of one core per instance
figure in `audioBus.ts`'s header is an M4 Pro development-machine sanity check,
**not** a target-machine result (CLAUDE.md invariant 3), and the Vega 7 has not
been asked.

### 7. Sends are post-fader by construction, pre-pan by choice

Post-fader is not a preference — it is forced. The level fader is the `gain`
param *inside* the worklet, so `part.output` is already post-fader and there is
no pre-fader tap to take. A genuine pre-fader send (fade a part to silence, its
tail keeps ringing) would need a second output on `fm-processor.js`. That is a
worklet and protocol change, and it was punted, not overlooked.

Pre-pan **was** a choice: the send taps `part.output` and the rotation matrix
sits in the dry path only. Fading a part out fades its tail with it, and every
part arrives at the plate centred, so the room stays symmetrical however the
mix is placed.

### 8. One strip shape, for SFX as well as music

`MIX` covers every part. SFX parts — which today bypass the music bus and go
straight to master (`audioSystem.ts:70`) — get the same strip with different
defaults: little or no send, and off the music bus's inserts. One mental model,
positional SFX get a real pan, and a UI blip that wants a touch of room can
have one without a second type.

### 9. The patch editor stays a sound-design tool

`tools/patch-editor/` keeps driving exactly one part and owning the patch,
including the §3 normalisation trim. `MIX` is hand-edited TypeScript, reviewed
in PRs like any other code.

Revisit when several parts are actually making noise together — which is not
today, because none are. Mixing by ear needs something to hear.

## Why

The through-line is that **a mix and a sound are different objects**, and every
decision above puts them in different places. `Patch` owns what an instrument
*is* (its timbre, its designed loudness, how its voices spread). `MIX` owns
where it sits *tonight* (level, placement, how much room). The reverb decision
in #59 started this by refusing to put a space inside a `Patch`; §3, §4 and §9
are the same cut applied to level, pan and tooling.

Sends and returns rather than per-part effects is the same principle again: one
room that several instruments share is what makes a mix sound like one place.
Per-patch reverb — already rejected in #59 — gives every instrument its own
room, and makes a per-track send amount meaningless.

Two constraints held throughout: **audio never feeds back into simulation
state** (CLAUDE.md invariant 1 — "audio observes; it never decides"), and
**Plateau is GPL-3**, so its source stays unread.

## Punted / alternatives

Each was put to Pat as an option and declined:

| Rejected | Why not |
|---|---|
| Keep the plate bus-owned, expose its input for extra taps | Two ways to reach one plate; the bus-wide and per-part amounts sum confusingly |
| One bus per space — a part "joins a room" by connecting | No continuous send amount at all; a part in two rooms means two connections |
| Send amount as an argument at part creation | The desk scatters across call sites; a level change touches gameplay code |
| Send amount as a `Patch` field, authored in the editor | The preset would decide the mix — two parts on one preset could not differ |
| A runtime JSON mix document | Needs a schema, loader and validation; largest build of the four, for authoring nobody can use yet |
| Freeze `patch.volume` at 1.0, strip owns all level | Presets could no longer carry designed loudness; every preset needs a `MIX` entry to be usable |
| `MIX.level` as a dB trim around `patch.volume` | Two multiplications to reason about when something is too loud |
| `StereoPannerNode` and accept balance semantics | Audibly wrong for exactly the wide parts most likely to be panned |
| Mid/side width + balance as two strip controls | More expressive than needed; a mix usually wants one control |
| Delay feeds the plate (tape echo into a room) | Loses independence — no dry delay |
| Delay as a per-part insert | N delay lines instead of one; least desk-like |
| Two plates (short + long) from the start | Two plates of DSP running before anything is measured on the target box |
| A plate per `SPACES` entry, created on demand | Mix authoring could silently spawn six plates' worth of DSP — wrong default on a Vega 7 |
| True pre-fader sends | Needs a second worklet output and a wider protocol (§7) |
| SFX stay dry and stripless, or get a reduced strip | Two strip shapes in the type, for no gain |
| Editor grows a mixer page emitting `MIX.ts` | Worth revisiting once several parts play together; needs something to hear first |
| A separate mixer tool, or in-game faders behind `?debug=1` | Same blocker — and in-game needs a path back out to `MIX.ts` |

Full Plateau parity (Tuned Mode, Clear, Diffuse-Input bypass, mod shape)
remains punted from #59. Nothing here blocks it.
