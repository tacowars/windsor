# Advanced Drive — #701

Original DSP inspired by Roar's stage/routing workflow, not an emulation.
The [research brief](../2026-09-26-drive-roar.md) records the references and
Pat's three scope decisions. Existing `kind: drive` songs keep the original
native implementation; the editor calls it Classic Drive. The new kind is
`advanced-drive`, available on parts and master.

## Sound and routing

The global input drive and pivoted tilt feed three saved stage settings.
Each stage offers independent enable, shaping enable, shaper, amount, bias,
level, filtering enable, filter type, cutoff, Q, peak gain and pre/post order.
Disabled stages pass their input unchanged. Inactive stages are retained.

- Single uses stage 1.
- Serial feeds stage 1 into stage 2. Blend 0 hears stage 1, blend 1 hears both.
- Parallel feeds both stages independently. Blend 0 hears stage 1, blend 1
  hears stage 2. Its linear blend preserves identical signals at unity.
- Three-band uses fourth-order Linkwitz–Riley crossovers. The low branch gets
  the upper split's all-pass response. The dry reference gets both all-pass
  responses so partial mix does not cancel crossover frequencies. Band stage
  level adjusts balance. The normaliser maintains high >= 1.25 × low.
- Mid/Side encodes half-sum/half-difference, processes them independently in
  stages 1/2, and decodes at unity. Stage levels adjust centre and width;
  there is no crossfade that would attenuate the centre by default.

Tone compensation applies the algebraic inverse of the input tilt after
processing. It cancels on a linear path while permitting frequency-selective
excitation of the shapers. Output trim affects wet only; Mix follows it.
The compressor is a separate insert, as selected in the design conversation.

The shapers are original soft-sine, hard-clip, smooth diode-inspired,
asymmetric tube-inspired, half/full rectifying, triangular folding and
amplitude-quantising functions. Amount zero is identity. Amount drives the
curve and blends its influence; Bias offsets the curve with zero-input
subtraction, so silence never creates a sustained tone. A continuous DC rejector acts on the nonlinear residual, preserving the
clean path while its tail decays through Amount zero crossings. “Diode” and “tube” identify tonal intentions, not circuit
simulations. The filter uses the [W3C/RBJ biquad equations](https://www.w3.org/TR/audio-eq-cookbook/),
with constant-peak band-pass and explicit peak gain; Q is linear.

One envelope follower measures the greater stereo input magnitude, before
input drive, with sensitivity, attack and release. One LFO has sine,
triangle, square and rising/falling ramps, a free rate or song-tempo division.
Both have signed per-stage amounts for shaper Amount, Bias and cutoff
(octaves). No external sidechain, MIDI tracking, feedback loop or full matrix.
LFO phase runs while bypassed; tempo changes preserve its phase.

## Audio and editor implementation

One stereo worklet owns all state. Nonlinear routing runs at 2x, with
65-tap Blackman-windowed sinc interpolation and decimation. The active dry
path shares that filtering: **active latency is 32 host samples**, including
at Mix 0. Three-band dry also includes crossover phase rotation. Settled
bypass returns the exact original undelayed samples. This insert does not
add automatic latency compensation to other tracks. Oversampling reduces
aliasing; it is not an assertion of alias-free folding or crushing.

Continuous controls smooth over 20 ms. Filter/modulation coefficients update
every eight host samples. Discrete topology changes fade through dry over
8 ms each way, resetting the stage/filter state at the fade midpoint. The
oscillator and follower continue. Bypass crossfades between active and dry.
State and filter outputs have finite guards; this is not a mastering limiter.
Allocate graph/filter/ring storage at construction, never per rendered sample.

The editor's curves call the engine's shaper and filter coefficient functions.
They show the base settings; filter response is labelled as a 48 kHz reference,
and the transfer curve precedes modulation, output gain and DC rejection.
All sound controls and presets write full insert values into the song.
Stage selection is local editor state. Presets preserve Mix, Output and enable.

## Audition

Open this worktree's `tools/patch-editor/patch-editor.html` in Chrome, enable
audio, load a patch in Parts, then add **Advanced Drive** in Mixer.

1. `saw-arp`, MIDI C2–G2 (36–43), **Biased acid**. Compare Stage 2's pre/post
   switch and resonance. Vary velocity to hear its envelope cutoff movement.
2. `tr909-kick`, MIDI C2, **Parallel drum crunch**. Sweep Blend from the
   aggressive diode path to the lighter second path; compare bypass at a
   matched listening level. Add the existing compressor afterward if wanted.
3. `saw-arp`, **Serial diode treatment**. Adjust Stage 2 Bias and compare
   Blend endpoints. This is an original recipe, not the pictured Ableton preset.
4. Bass or a drum pattern, **Warm bass / torn highs**. Sweep crossovers and
   adjust the High level; listen for the preserved low band.
5. `pad-drift`, hold C3–G3–C4 for at least six seconds, **Moving stereo edges**.
   A mono source has no side signal: use a stereo/unison patch to hear side
   processing. Change song tempo or disable Sync to compare free movement.

Export/import the song to preserve every stage, including hidden ones.
Pat's listening verdict remains pending; render tests are not that verdict.

## Evidence

`browser.json` records checks of the generated editor in isolated Chrome:
actual worklet parameter values after preset, route, stage and modulation
edits, plus the complete warning/error list. `editor.png` records the card.
This standalone editor has no Babylon backend or world state; game movement
and renderer-stat evidence do not exercise its controls.

Tests render the shipped processor at 44.1/48/96 kHz, check crossover
reconstruction and partial mix, route endpoints, mid/side centre, filter
responses, high-frequency alias reduction, silence/DC decay, transitions,
modulation/tempo, disposal, song round trips, and real synth bass/pad/drums.
No target-machine performance claim is made.
