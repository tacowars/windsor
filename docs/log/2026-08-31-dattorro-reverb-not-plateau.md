# Dattorro reverb from the paper, not a Plateau port; space on a send, not in the patch

- Date: 2026-08-31
- Links: issue #52 · follows #33 / PR #39 (FM engine) ·
  extends `docs/design/audio-architecture.md` §3 ·
  scope exception on the terms of
  `docs/log/2026-08-31-audio-enters-tech-demo-scope.md`

The reference point tacowars gave was **Plateau** (Valley Audio, VCV Rack), and the
implementation tacowars linked was **`khoin/DattorroReverbNode`**. Those are not the
same thing, and they carry different licences. This record pins which one the
code descends from, why the difference matters legally, and the structural
choices that fell out — because "it's the Dattorro reverb" is the sentence a
future reader will assume covers all of it, and it does not.

## Decision

### 1. Public-domain source, paper-derived extensions, no GPL contact

`packages/client/src/audio/worklet/reverb-processor.js` derives from
`khoin/DattorroReverbNode`, which is released into the public domain. That is
the whole of its inherited lineage.

Plateau's characteristic controls are **not** in that node, and are what makes
Plateau sound like Plateau: Size, a tank low-cut beside the damping high-cut,
and Hold. Those are implemented here from Dattorro's 1997 paper and ordinary
one-pole filter design. **Valley Rack Free is GPL-3**, and its source was
deliberately not read or ported. This repo currently ships no LICENSE file at
all, so a GPL-3 derivation would have been a live problem rather than a
theoretical one.

The processor's header comment carries this, so it travels with the file rather
than only living here.

### 2. A space is not part of a patch

`ReverbSpace` (`reverbSpace.ts`) is its own type with its own presets. A
`Patch` does not contain reverb settings, and deliberately gains no `reverb`
block.

The alternative — reverb settings inside each patch — was weighed and rejected.
It is simpler and makes a patch file self-contained, but it gives every
instrument its own reverb instance and therefore its own room, which is the
opposite of what a mix needs: instruments sit together because they share one
space. It also makes a per-track send amount meaningless, and per-track sends
are the next piece of work.

So: one plate, shared; each part carries only how much of itself it sends. That
is an aux send, and it is the topology the mixer follow-up is built on. The
node itself runs fully wet (`dry` 0), with the amount as one gain outside it —
turning a send down silences that part's contribution without altering the
tail, which a wet/dry blend inside the plate could not do.

The editor and the game read the **same** `SPACES` table, through
`index-for-editor.ts` and the inlined schema bundle, exactly as they already
share the patch schema. `reverbSpace.test.ts` asserts the type cannot drift
from the processor's `parameterDescriptors` — same duplication, same guard, as
`patch.test.ts` gives the FM tables.

### 3. Three defects in the reference behaviour, fixed and pinned

All now have regression tests in `reverbProcessor.test.ts`.

| | Reference behaviour | Here |
|---|---|---|
| Output tap direction | tap index read from the *oldest* end, so `node48_54[266]` on a 4217-sample line is a delay of 3950, not 266 | read back from the write head |
| Tank all-pass ceiling | exposed to `0.999999`, where the tank stops decaying and **grows** — measured peak 54, still climbing 60 s after input stopped | capped at `MAX_TANK_DIFFUSION` = 0.8, past Dattorro's own 0.7 / 0.5 |
| Delay length under a Size sweep | n/a — the reference has no Size | lengths ramp **per sample**, not per block |

The tap direction is the one worth reading the paper over, and it was found by
the second review pass, not by listening. Dattorro writes taps as
`node48_54[266]`: a delay line spanning node 48 to node 54, indexed from node
48. Node numbers increase along the signal path — `node31_33` feeds
`node33_39`, sharing node 33 as one line's output and the next one's input — so
the index counts from the line's **input**, and is a delay.

Reading from the other end puts every tap near the far end of its line, which
deletes the early reflections. Measured on an impulse into Hall (size 1.4,
decay 0.78):

| | mirrored | as the paper has it |
|---|---|---|
| onset | 32 ms — eleven blocks of pure silence first | **8 ms** |
| samples above 0.002 in the first 100 ms | 94 | **1020** |
| time to 10% of total energy | 0.143 s | 0.107 s |
| RMS at 0.5 s | 3.02e-3 | 2.99e-3 |
| RMS at 2 s | 5.62e-4 | 5.45e-4 |

The late tail is the same to within a percent, which is exactly why this
survived a listening test: what was missing was the early field, and a plate
with a 32 ms hole at the front still sounds like a good reverb — just a
detached one. 1.3.6 calls the output tap structure "characteristic of the plate
emulation class", so this is the part of the topology least safe to get
backwards.

The Size sweep needs its mechanism recorded too, because the obvious fix is the
wrong one. Sweeping Size 0.3 → 3 over two seconds moves the longest tank line's read
point about **26 samples per 128-sample block**. That is not a rounding
artefact, so making the delay reads fractional — which was the first attempt —
does not fix it: interpolation smooths *within* a length, and the discontinuity
is *across* the block boundary where the length jumps. Measured step stayed at
0.375 against a 0.036 natural slew, roughly ten times the signal. Ramping the
lengths across the block took it to 0.034, below the signal's own slew. What
remains is Doppler shift, which is what sweeping a delay line is supposed to
sound like.

The fractional reads were kept anyway: they are what lets Size sit at a
continuous value rather than quantising the room to whole samples.

### 4. The convolver is removed, not left beside it

`generateImpulseResponse` and the `ConvolverNode` path are gone from
`audioBus.ts`, and `BusOptions` loses `reverbSeconds` / `reverbDecay` for
`reverbSpace`.

This was safe to do outright, which is worth recording: the convolver had never
been heard by anyone. Nothing in the client calls `createMusicPart` or
`createSfxPart`, so no part was ever routed to the music bus that carried it.
It was constructed and connected to nothing.

## Why

- **The licence, first.** The nearest-sounding implementation and the
  best-sounding reference are different projects on incompatible terms. Writing
  down which one the code touched is the difference between a future
  relicensing question taking five minutes and taking a source audit.
- **The send topology is the expensive decision, not the DSP.** The plate could
  be swapped for another algorithm in an afternoon. Where the settings *live*
  reaches into the patch schema, the preset files, the editor, and the mixer
  that does not exist yet — and is the one that is painful to reverse once
  patches carry a `reverb` block.
- **The Size mechanism is recorded because the first fix failed.** A reader who
  sees per-sample length ramping and thinks "fractional reads would be simpler"
  needs to know that was tried and measured.

## Punted / alternatives

- **Full Plateau panel parity** — Tuned Mode (all-passes tuned to 1V/oct so the
  tank plays as a pitched resonator), Clear, Diffuse-Input bypass, mod shape.
  Offered and not taken for the first pass; none of it is blocked by anything
  here.
- **Per-*note* sends** — would move the send inside the FM worklet, since a
  part is one node with internal polyphony. Much larger, and not what "per
  voice" meant in the request: sends are per part / per track.
- **Keeping the convolver selectable alongside** — offered and declined. It
  would have cost `BusOptions` surface for a fallback nobody had heard.
- **Input diffusers scaled by Size** — currently fixed. Input smear is not room
  size, and Dattorro treats them as separate; easy to change if the smallest
  rooms end up sounding over-diffused.
- **Per-sample Size smoothing** (rather than per-block smoothing with
  per-sample length ramps) — would recompute 12 lengths and 14 taps per sample
  for an audible difference nobody has demonstrated. The ramp already removes
  the artefact.
- **Target-machine measurement** — deliberately not done. The figures in #52
  are development-machine, and CLAUDE.md invariant 3 means they are not a
  milestone result. No milestone criterion depends on the reverb; when one
  does, it gets measured on the Ryzen 5600G like everything else.
