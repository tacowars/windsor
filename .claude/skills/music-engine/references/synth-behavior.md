# Synth behavior that affects patch design

Source of truth: `packages/client/src/audio/patch.ts`, `audioConstants.ts`
and `worklet/fm-processor.js` in the active checkout. Inspect `Voice.updateControl`,
`Voice.render`, `normalisePatch`, `getMips` and the envelope/LFO classes when
changing behavior. These notes describe the implementation, not a promise
that a familiar control matches another synthesizer.

## Routing and levels

Operators are A–D. Read each algorithm's `mods` and `carriers`; not every
operator is audible directly. Modulator envelopes change spectral character,
while carrier envelopes shape the audible amplitude. Filter and pitch have
their own envelopes.

Before its amplitude envelope and other scaling, an operator's level is
**squared**. A change from 0.3 to 0.6 multiplies that contribution by four,
not two. FM index, feedback, carrier sums and filtering interact; adjust
patch volume against actual renders instead of inferring output headroom
from knob values. Native mixer gain and effects can still overload a sound
whose dry single-note output is safe.

A modulator's level is its **depth**: `level² × envelope × velocity × key
scale × LFO`, times 4 cycles of phase — so a modulator alone at Level 1 with
its envelope open shifts its target's phase by 4 cycles, ≈ 25 rad (#543).
Sidebands reach roughly `2 × (β + 1) × modulator frequency` with β in radians,
so a deep modulator on a high note or a high ratio still folds back past
Nyquist: the engine does not oversample. Expect grit near the top of the knob
and timbre below it, and read the factory bank as the scale of a normal sound —
164 of its 275 active modulators sit at or below 0.354, and only 5 at 1.
Factory presets authored before #543 carry their old level times √2; a stored
document does not, and plays its own numbers against the current engine.

Per-operator LFO depth multiplies amplitude by `max(0, 1 + lfoValue * depth)`.
Full-depth bipolar modulation can both silence and boost an operator.
The LFO value also includes the patch amount and mod-wheel depth; consider
wheel use when relevant to the patch or control being changed.

## Self-feedback

`feedback` is bipolar, −1…+1 (#529), and feeds an operator's own last output
(two-sample average, including its level² × envelope × velocity) back into its
phase. Positive runs `sin(φ + β·y)` up to 1.25 rad: sine towards a sawtooth.
Negative runs `sin(φ + β·y²)` up to 2.0 rad: odd harmonics only, sine towards a
softer square. Neither end reaches noise — use the Noise wave for that. Because
the fed-back signal carries the envelope, a decaying operator gets less bright
as it fades, and a quiet operator gets little feedback at all.

## Fixed frequency and pitch envelopes

With **Fixed off**, the operator's frequency follows note pitch (including
glide), the global pitch envelope, bend and pitch LFO, then its ratio and
detune. Pitch-envelope amount is in semitones. With **Fixed on**, the engine
uses `fixedHz * 2 ** (detune / 1200)`; it bypasses ratio and those global pitch
controls. A fixed-frequency modulator can still have an amplitude envelope,
changing the sound as its modulation depth decays.

This does not prevent kick/tom pitch sweeps. Use note-tracking operators for
the swept body, optionally with a fixed-frequency component for a separate
transient. If the requested sound needs the same Hz contour at every played
note, Fixed plus the global pitch envelope cannot currently deliver that;
either use a controlled note input for the patch or scope a DSP extension
explicitly. Do not silently change Fixed semantics for all existing songs.

Check the envelope's sign and stages: positive pitch amount falling from a
high envelope level toward zero drops toward the played pitch; negative
amount with the same contour rises toward it. A label such as “kick” does not
establish the contour's direction. Noise is primarily shaped by amplitude
and filtering; do not describe a noise filter sweep as a pitched oscillator
sweep. Filter envelope/LFO amounts are in octaves, not semitones.

## Timing and voice lifecycle

Amplitude/pitch/filter envelopes carry initial, peak, sustain and end levels,
segment curves, key scaling and loop modes. Read the implementation before
using looping or unusual endpoints; do not treat it as a generic four-stage
ADSR. Note-off during attack starts release rather than finishing the swell.
Use gates long enough to exercise the gesture and render the full tail.

Synth LFO rates are Hz and envelope times are seconds. Sequencer tick
divisions are a different timing layer; a rhythmic patch name does not imply
beat synchronization. A pulsing amplitude LFO does not emit note events.

`mono` means one note with **retrigger**: new notes fade existing voices.
It is not legato envelope suppression. `glide` can still move between notes.
Positive `spread` runs a detuned voice pair even in mono. Inspect lifecycle
tests for late note-off, stealing and cut fades before changing these paths.
Long release tails and repeated chords can consume the finite voice pool.
A held note whose carriers all sit in sustain at level 0 (and whose filter
has stopped ringing) goes **dormant** (#547): the part skips it, steals it
first and silently, and ends it on note-off. Sustain 0 therefore does not tie
up the pool under Hold. The plate likewise sleeps after ~1.6 s of silence in
and out, and never under HOLD.

`phaseFree` randomizes starting phase; noise, drift and pan randomization add
other stochastic surfaces. Use the harness's explicit seeds for reproducible
diagnosis, plus multiple seeds for coverage. Keep intended randomness in
the playable sound rather than disabling it merely to pass a measurement.

## Harmonic waveforms and compatibility

`WAVE.USER` reads harmonic amplitudes from `userPartials`, fundamental first;
the worklet sums them into a peak-normalised table and bandlimits it per
octave, with **Tone** trimming upper harmonics as for the other waves. `null`
plays a sine and `[]` plays silence. The wavetable cache is keyed by waveform,
quantized tone and the partial values themselves (#511), so equal spectra
share a table and any edit is heard; `userKey` is ignored by the worklet and
kept only so existing patches and documents load. The console draws partials
in each operator bay while its wave is User (16 / 32 / 64 bars, values 0–1);
a hand-written array may be longer or negative, and is played as written.

Bandlimited and deliberately unbandlimited “digital” waveforms are separate
choices. Choose intentional aliasing for a digital texture, not by assuming
all saw/square variants are equivalent.

Each worklet deliberately remains one import-free file: its URL is loaded
directly in development and production, and the standalone editor embeds the
same source. See `docs/log/2026-08-31-audio-worklet-single-file.md` before
changing that boundary. Patch defaults/enums/routing are mirrored across TS
and DSP; update the corresponding parity tests when changing that contract.

`makePatch` supplies defaults, and document normalization checks shapes and
finite values. Do not assume every finite numeric field is range-clamped:
inspect the actual normalizer/control/DSP path for the parameter in question.
For a new patch field, consider factory defaults, old documents, live updates,
editor controls, worklet defaults and the rebuilt standalone HTML together.
