# The music fader is the bus's own gain, and the returns ride it

- Date: 2026-09-13
- Area: audio
- Links: issue #518 (decision 1) · docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md

## Decision

The settings panel's **Music** channel is `musicBus.output.gain` — the gain
node `createBus` has always built at the end of the music bus — and the two
return buses ("room", "echo") are created into that node instead of into the
FM engine's master. **SFX** is a single new `GainNode`, `sfxLevel`, that every
`createSfxPart` strip lands on dry before the master. The engine's master gain
stays at the 0.9 `fmEngine.ts` sets; there is no master fader.

Two consequences worth writing down:

- Turning the music down takes its room and its echo with it, because the
  plate and the delay now sum into the music fader. Turning it to zero leaves
  the plate still being fed — the sends tap each part post-fader and pre-bus —
  and none of it heard, which is what makes an unmute instant.
- A **SFX** strip that has a send (`MIX.place` carries `room: 0.08`) has its
  return contribution scaled by the *music* level. No `createSfxPart` call
  site exists on main, so nothing ships with that behaviour today.

## Why

Decision 1 of #518 asked for the gain to be placed "where the returns'
contribution is included, or the return buses scaled with it". The bus's
existing output gain is the only place that is both: it is downstream of the
highpass insert and it is where the returns can be summed, so one value moves
the dry music and its room together, atomically, with **no node added to the
dry path**. That last point is the standing constraint from the mixer record's
§3 — the fader is a k-rate multiply inside the worklet precisely so no
`GainNode` sits in the music's dry path — and this respects it: the node was
already there.

Scaling the return buses' own `level` instead would have worked, but it makes
the music level two writes that can disagree, overwrites a value the document
model's `returns` overlay also writes (`deskApply.ts`), and still scales an
SFX send's contribution, since one plate serves every part.

`audio/mixLevels.test.ts` renders the real routing headless and pins the whole
of it, including the case the panel exists to protect: at the shipped defaults
the master's samples are identical, bit for bit, to a page with no settings at
all.

## Punted / alternatives

- **A return per channel** would remove the SFX-send coupling entirely, at the
  cost of a second reverb plate on the audio thread. Not bought for a send
  that no live part uses; the day an SFX part with a send ships, this is the
  ticket to open.
- **Scaling each strip's `level`** (the fader inside the worklet) would have
  carried the sends for free, but it collides with `applyMixLive` — the dev
  console writes the same field — and needs per-part bookkeeping of a base
  level for parts that do not exist yet when the settings are read.
- **A master fader** was ruled out in the ticket: it would scale the limiter's
  headroom along with the programme.
