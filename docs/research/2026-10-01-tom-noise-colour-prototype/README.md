# Per-operator noise colour: a prototype, measured on the 909 tom

windsor#318, decision 3. The first pass's main limit on the 909 mid tom was
its noise: the voice has one filter, shared by the tones and the noise, so
the noise could not be coloured on its own
(`docs/research/2026-10-01-tr-percussion-fit/README.md`). The ticket asked
to try what the engine already has first, and to prototype the smallest
engine change only if that fell short by a measured amount. This folder
holds the prototype and what it measured. It is research only: nothing here
is shipping code, and the shipped bundle is untouched.

Everything was measured on an Apple M1 (macOS 26.5), Node 24.21, Python
3.14.5, against `origin/main` at `66685a1`.

## The prototype

`build.py` copies `packages/engine/src/worklet/generated/fm-processor.js`
into a mirror of the sound-match toolkit (default
`<tmp>/sound-match/noise-colour/`) and patches the copy: a Noise operator
takes two new fields, `noiseLp` and `noiseHp` (Hz, 0 or absent is off), a
one-pole lowpass and a one-pole highpass on that operator's own noise,
before its level and envelope. A patch without the fields renders bit for
bit as the shipped bundle does (checked on `tr909-tom-mid`, seed 3). The
toolkit's own `fit.py` and `compare.py` run against the copy from the
mirror:

```bash
python build.py /tmp/noise-colour          # any folder outside the repository
cd /tmp/noise-colour/scripts/sound-match
python fit.py <repo>/docs/research/2026-10-01-tr-percussion-fit/specs/tr909-tom-mid.pass2d-noise.json
```

## The experiment

The tones stay the shipped `tr909-tom-mid`'s. Only the noise and what
colours it move, one fit per structure, each CMA-ES (σ 0.15, 800
evaluations, seeds 1–4, `pitch` and `harm` weights 0 as in the first
pass). The specs are in `../2026-10-01-tr-percussion-fit/specs/`:

| Structure | Spec | What colours the noise |
|---|---|---|
| e, what exists | `tr909-tom-mid.pass2e-noise.json` | the shared lowpass, its envelope, and the drive's tone pole |
| b, what exists | `tr909-tom-mid.pass2b-noise.json` | FM: algorithm 6, a fixed sine carrier (C) spread into a band by a Noise modulator (D); the lower tone moves to B |
| d, the prototype | `tr909-tom-mid.pass2d-noise.json` | e, plus the noise operator's own lowpass and highpass |

The readings are `tom909.py`'s (the toolkit's region band level, 2–6 kHz,
candidate minus recording, mean of seeds 1–4) and the fit's objective.

| Structure | objective | 2–6 kHz, 0–5 ms | 2–6 kHz, 30–150 ms |
|---|---|---|---|
| shipped | 0.9230 | −2.3 dB | +5.6 dB |
| e, shared filter and drive tone | 0.8986 | +2.5 dB | +3.5 dB |
| d, the prototype | 0.8989 | +2.5 dB | +2.1 dB |
| b, FM-coloured noise | **0.8713** | **+0.3 dB** | **−0.3 dB** |

The fits found the same shape in e and d: a burst whose top falls with the
filter envelope (3.1–3.4 octaves of sweep over 5–13 ms). In d the
noise's own lowpass settled at 9.1 kHz and its highpass at 21 Hz, which is
off: the prototype's one-pole slopes add little that the filter envelope
does not already give.

## The finding

The engine already closes the gap. FM-coloured noise, a sine carrier at
4.8 kHz spread by a Noise modulator, brings both 2–6 kHz readings within
0.3 dB of the recording, where the prototype leaves them 2.1–2.5 dB high
and scores no better than the shared filter (0.8989 against 0.8986). The
shipped second pass uses structure b (the research note's "Second pass").

## The proposed engine ticket

Measured gain on the 909 tom: none on the objective (+0.0003), 1.4 dB
closer at 30–150 ms in 2–6 kHz against the shared-filter structure, and
2.4 dB further than FM-coloured noise. **Recommendation: do not schedule it
for the TR work.** If a later sound needs a coloured noise and a free
operator pair at once, this is the ticket:

> **Per-operator noise colour.** A Noise operator gains `noiseLp` and
> `noiseHp` (Hz, 0 off), a one-pole lowpass and highpass on its own noise
> before its level and envelope, so noise can be coloured without the
> voice filter and without spending a second operator on FM colouring.
> The coefficients are set per control block from the fields (portable
> arithmetic for the prewarp, as `voiceDrive.ts` does for its tone), the
> state lives in the voice's preallocated arrays, and both render loops
> carry it inline. Additive fields whose default (0) reproduces the old
> noise bit for bit, so no format bump. Measure first on the sound that
> asks for it: on the 909 mid tom it gained nothing that FM colouring did
> not (`docs/research/2026-10-01-tom-noise-colour-prototype/`).

The other change decision 3 named, a per-operator pitch-envelope depth, was
not prototyped: the noise did not need it, and the glide (the research
note's "The 909 tom's glide") is a shared one in the recording, which the
global pitch envelope already models.
