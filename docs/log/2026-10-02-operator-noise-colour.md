# A Noise operator's own colour

- **Date:** 2026-10-02
- **Status:** accepted (the decisions of windsor#362, from windsor#361's
  recommendation)
- **Refines:** `docs/design/drum-bank.md`'s noise point, which said noise
  could be coloured by the voice's one filter only
- **Links:** windsor#362 · windsor#361 (PR #380) and its measurements in
  `docs/research/2026-10-01-tom-noise-colour-prototype/README.md` · this
  change's cost in `docs/research/2026-10-02-operator-noise-colour/README.md`
  · the snares' refit, windsor#365

## Context

The Noise wave is white, and a Noise operator ignores its modulators, so a
snare, clap or hat could shape its noise only with the voice's one
state-variable filter, which the tonal operators go through as well. The
shipped snares keep their snappy white above a near-open highpass, and
tacowars heard it: the 808's "missing some brightness and sizzle", the
909's "plain white noise". windsor#361 built a prototype with a lowpass and
a highpass on a Noise operator's own noise and fitted both snares with it:
either filter order took about a quarter off their scores, and the two-pole
form came closer on the noise's band shape in every fit (the 808's best
attainable shape error 2.76 → 1.41 dB). A resonance gained at most 0.3 dB
and fitted worse.

## Decision

1. **Fields.** An operator gains `noiseLp` and `noiseHp`, in Hz, 0 meaning
   off: a two-pole Butterworth lowpass and highpass (the voice `Svf`'s TPT
   form at damping √2, Q 0.707) on that operator's noise, lowpass then
   highpass, before its level and envelope. No Q field. Both are clamped to
   0–20 kHz (`NOISE_COLOUR_RANGE`); a cutoff that is on sounds between
   20 Hz (`NOISE_COLOUR_FLOOR_HZ`) and 0.45 of the sample rate. Every wave
   but Noise ignores them.
2. **Additive, bit-identical by default.** A patch without the fields, or
   with both at 0, renders the same bits as before: the FM goldens did not
   move. `makePatch` and the worklet's `normalisePatch` fill 0 from
   `OPERATOR_DEFAULTS`, so a library file or song saved before them loads
   with no correction, and patch files and songs keep them through every
   round trip (the shape-driven normalisers read the template). No format
   version changes (`2026-09-28-format-versions-refuse-never-destroy`).
3. **DSP.** Each voice holds a `NoiseColour` per operator
   (`worklet/fm/noiseColour.ts`), built with it; its state is reset at a
   note's start, and a section that turns on mid-note starts from rest.
   Both render loops pass a Noise operator's sample through it only while
   a section is on, behind one hoisted flag per operator, so the off path
   does no per-sample work, and the kernel and the generic loop stay
   bit-identical. The sample crosses the call in a field, never as an
   argument or a return, and nothing allocates (worklet rules 2 and 7).
4. **Tuned when the voice binds a patch.** The prewarp g = tan(π fc / fs)
   is computed in portable arithmetic (`worklet/fm/portableTangent.ts`,
   over the tape module's sine and cosine tables), so a coefficient is the
   same bits on arm64 and x64. The ticket asked for the coefficients per
   control block; they are set in `bindVoiceConstants` instead, which runs
   at a note-on, a live edit's rebind and a slide, the only times the fields
   can change. The effect is the same (a live knob is heard from the next
   block), and no block pays for it: the per-block version cost about
   0.6 ns a sample with the fields absent, the bind-time version nothing
   measurable.
5. **Cost.** On the held 909 tom voice (29 ns a sample under Node on the
   M1), the pair costs 4.2 ns, one section about 2.4 ns, close to the voice
   `Svf` section's 2.8; windsor#361's prototype cost 9.3 ns in the same run.
   With the fields absent the cost is within measurement noise.
6. **Editor.** On a Noise operator the operator bay shows `Noise LP` and
   `Noise HP` after Vel: zero-end log knobs (windsor#324), Off at the bottom,
   then 20 Hz to 20 kHz. Other waves hide them; a wave switch shows or hides
   them in place.
7. **No library patch changes here.** The snares, claps and hats are refit
   to the fields in tickets of their own (windsor#365 for the snares). The
   909 tom keeps its FM-coloured noise, which windsor#361 measured closer.

## Consequences

- A drum patch can shape its noise without taking the tones through the
  voice filter and without spending a second operator on FM colouring.
- A build from before this change refuses a patch file that uses the
  fields (an unknown key) and drops them from a song with a correction, as
  it would any new field.
- A Noise carrier with both sections on costs about 10 % more; nothing
  else does.
