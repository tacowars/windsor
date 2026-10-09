# Synth behavior that affects patch design

Source of truth: `packages/engine/src/patch/patch.ts`, `audioConstants.ts`
and `worklet/fm/` (the FM worklet's source, with its defaults and ranges in
`patchDefaults.ts`) in the active checkout. Inspect `Voice.updateControl`,
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
and timbre below it; most factory modulators sit well below half travel, and
a modulator near 1 is a deliberate choice, not a starting point. Factory
patches authored before #543 carry their old level times √2; a stored document
does not, and plays its own numbers against the current engine.

Per-operator LFO depth multiplies amplitude by `max(0, 1 + lfoValue * depth)`.
Full-depth bipolar modulation can both silence and boost an operator.
The LFO value also includes the patch amount and mod-wheel depth; consider
wheel use when relevant to the patch or control being changed. The wheel has
two destinations, each a depth rather than a switch (#586): `lfo.modWheelDepth`
(0..1, default 1) scales the LFO amount, and `filter.modWheelDepth` (octaves,
−6..6, default 0) adds to the filter envelope amount —
`octaves = filtEnv × (envAmount + wheel × filter.modWheelDepth) + …`. Depth 0 on
either side is off; both at once, or opposite signs, are allowed.

## Self-feedback

`feedback` is bipolar, −1…+1 (#529), and feeds an operator's own last output
(two-sample average, including its level² × envelope × velocity) back into its
phase. Positive runs `sin(φ + β·y)` up to 1.25 rad: sine towards a sawtooth.
Negative runs `sin(φ + β·y²)` up to 2.0 rad: odd harmonics only, sine towards a
softer square. Neither end reaches noise — use the Noise wave for that. Because
the fed-back signal carries the envelope, a decaying operator gets less bright
as it fades, and a quiet operator gets little feedback at all. Negative
feedback is also how the drum bank rounds a triangle towards a sine, the way
back-to-back diodes do in a 909: `docs/design/drum-bank.md` records that trick
and the others the bank leans on — the clap's burst gate built from a
retriggered saw-down LFO, the trigger envelopes, the noise algorithms — with
the patch files as the source of the numbers. Read it there rather than
restating it here.

## Fixed frequency and pitch envelopes

With **Fixed off**, the operator's frequency follows note pitch (including
glide), the global pitch envelope, bend and pitch LFO, then its ratio and
detune. The console shows that ratio as Operator does, as **Coarse** (the whole
multiple) plus **Fine** (the fraction) over the one stored field, while **Level**
is the modulation index — the two are not the same control (#587). The console
floors the stored ratio at `RATIO_RANGE.min`, four octaves below the note (#618,
record `2026-09-18-618-console-ratio-floor-and-the-tools-lint-fence`); the
engine and `patchNormalise.ts` are unclamped, so a hand-written or older file
may sit below the floor and plays as written. The ratio is a voice target
(`ops.<i>.ratio`, windsor#646): a step lane, a song lane or a macro moves it
in octaves over `RATIO_RANGE` (1/16 to 24), and each LFO's `toRatio` (one
depth per operator, octaves at full swing, −4 to 4) multiplies the frequency
by `2^(lfo × depth)` on top. A fixed-frequency operator ignores all three, as
it ignores its ratio.

**Hard sync** (windsor#646, record `2026-10-09-operator-hard-sync`):
`Operator.sync` restarts the operator's own phase each time its master's
own phase wraps, `'note'` (the played note's period) or another operator's
letter (whatever that one's level, wave or fixed mode, so a silent master at
level 0 still syncs). Synced to the note any ratio is harmonic: 2.37 is a
pitched, formant-like tone, not a bell, and sweeping the ratio (an LFO's
`toRatio`, a lane) is the tearing sync sweep. Synced to a detuned operator,
the operator repeats at that operator's period. FM it receives still applies
over the restarted phase; FM on a master does not move its wraps. Chains
(C → B → note) reset together; a cycle or self-sync is off. A synced
operator renders through the generic loop, about 2.5–3.3× the kernel's
cost per voice, and a corrected wave reaches what it feeds a sample late.
A synced Noise operator does nothing. A two-sample polyBLEP smooths the
reset of a Sine, Triangle or User wave by 12–20 dB
(`docs/research/2026-10-09-operator-hard-sync/`). A synced Saw, Square or
Pulse that nothing modulates in its algorithm (a silent modulator counts),
in a patch at Tone 1, with no feedback and a Saw or Square at width 1,
computes its wave directly with a polyBLEP at every edge (windsor#655,
record `2026-10-09-sync-direct-shape`): about 5 dB less alias on
`lead-sync-sweep`, its peak 15 % under the table's at the same harmonics.
Any other synced Saw, Square or Pulse takes the reset uncorrected, as Saw D
does. A voice whose ratio an LFO or a lane moves keeps the fine control
interval. Factory examples: `lead-sync-sweep`, `lead-sync-detune`.
Pitch-envelope amount is in semitones. With **Fixed on**, the engine
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

## Drive, filter and operator filters

The voice's signal runs carriers → **drive** → filter (if on) → steal fade
(windsor#300, record `2026-10-01-voice-drive-stage`; `worklet/fm/voiceDrive.ts`).
The drive is its own patch block, `drive = { on, gain, shape, bias, tone }`,
and no longer needs the filter: a filter-off patch can be driven. The stage
is `shape(gain · x + bias) − shape(bias)`, then a one-pole lowpass. `gain` is
the input gain (1 is unity); `bias` shifts the curve's operating point, which
is how the stage makes even harmonics, the lopsided body a kick wants, and
subtracting `shape(bias)` keeps silence silent. `tone` runs from about 1 kHz
at 0 to bypassed at exactly 1. The shapes are `soft` (the filter's old soft
clip, the default), `hard`, `diode`, `tube` and `fold`; the voice does not
oversample, so `hard` and `fold` alias by design. `on` false, or unity gain
with no bias, costs nothing (windsor#309). The shaper's input is the
carriers' sum, so higher carrier levels drive it harder at the same gain.

The filter has Off, Lowpass, Highpass, Bandpass, Notch and **Formant**
(windsor#331, record `2026-10-02-formant-filter-mode`;
`worklet/fm/voiceFormant.ts`, `formantTables.ts`). Formant runs three
bandpass peaks in parallel at a vowel's first three formants, which stay put
while the pitch moves, as a sung vowel's do; one bandpass moving with the
note does not sound like a vowel. `filter.vowel` reads 0 a, 1 e, 2 i, 3 o,
4 u, a fraction morphing between neighbours, and a song lane or a step can
move it. The filter's modulation (envelope, wheel, both LFOs, key track)
shifts all three peaks together in octaves; the Cutoff knob, a cutoff lane
and `slope24` are not heard in this mode. The three share one Q from
`resonance` (8 per unit, capped at 40), and each peak stands at its vowel's
level whatever the resonance, so resonance narrows the vowel rather than
making it louder. Key track 0 keeps the peaks where the table puts them on
every note.

Every operator has its own **LP** and **HP** (windsor#362, every wave
since windsor#590, record `2026-10-04-operator-filters-on-every-wave`;
`worklet/fm/operatorFilter.ts`): `opLp` and `opHp`, in Hz, a two-pole
Butterworth lowpass then highpass on that operator's wave, before its level
and envelope, with no resonance; 0 is off. A cutoff that is on sounds
between 20 Hz and 0.45 of the sample rate. `opTrack` (**Key Trk**, -1 to 2)
moves both cutoffs as the voice filter's key tracking moves its cutoff:
`cutoff × 2^(opTrack × (note − 60) / 12)`, from the played note, a Fixed
operator's too, so 1 keeps a tone control in step with the pitch and 0
holds a fixed band. They band a snare's or a hat's noise, give a Square or
Pulse the 808 cowbell, cymbal and hat band, or round a Saw per oscillator,
ahead of the voice filter, which stays free for the whole voice;
windsor#361 measured that a resonant section fitted the snares worse, so
there is no Q. The operator's feedback reads its wave before the filter,
so a saw with feedback sounds the same with its filter on, and only what
it sends on (to the operators it modulates and the carrier mix) is
filtered. They are tuned when the voice binds the patch or a slide's new
note, so a live edit is heard from the next block. A section costs CPU
while it is on: about 11 ns a sample on a lone Saw carrier in Node on an
M1, against 20.5 ns for the voice (the record has the measurements).

## Macros

A patch may carry up to eight **macros** (windsor#559, record
`2026-10-04-patch-macro-knobs`; `worklet/fm/voiceMacros.ts`,
`macroMappings.ts`, `macroShape.ts`): each a name, a value 0..1 and up to
eight mappings, each mapping a voice target, the target's value at the
macro's 0 and 1 (`min`, `max`, in the target's own units), a curve and an
invert. The macro's output becomes the mapped target's base: the patch's
own number for that target is no longer heard, and a song lane or a step
push on the macro moves every target it maps. Inverted is `1 − x` first;
then Linear, Exp `x³`, Log `1 − (1 − x)³` or S `x²(3 − 2x)`. A ratio target
(a cutoff, a decay time, an LFO rate) sweeps geometrically, in octaves,
with an end below the row's floor raised to it (a decay mapped from 0 plays
1 ms at the bottom); an add target sweeps linearly. Each target takes one
mapping across all the macros, and the first wins; a macro cannot map
another macro. A direct song lane on a mapped target is kept and does
nothing while the mapping exists, and a step push on it still stacks. A
macro is not among the targets a slide keeps, so a macro mapped to feedback
or a decay curve moves it on a slide, which may click. The use it was built for
is an accent under one name: a carrier level, the cutoff and a decay time
pushed together by one step lane, each held inside the range its mapping
gives it.

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
up the pool under Hold. The plate likewise sleeps once its input and its tail
have both been silent for longer than anything can recirculate unseen
(`worklet/reverb/reverbConstants.ts`), and never under HOLD.

Every voice renders through one fixed-index kernel for all eleven algorithms
(#548): silent operators are skipped and the per-note `Math.pow` values are
precomputed. The older generic loop is kept as the bit-identical reference
behind the engine option `specialise: false`. A voice's Noise operators
share one noise stream, and both loops draw a sample's noise D..A
(windsor#389, `2026-10-02-noise-draws-descend-in-both-loops`), so any number
of Noise operators on any algorithm, Additive (7) included, takes the
kernel: a two-Noise snare costs about what a one-Noise voice does
(`docs/research/2026-10-02-noise-operator-cost/`). A Noise operator draws
every sample at any level, 0 included, so a silent one still moves the
others' noise. A DSP change is proved against that reference, not against a
recording.

A part playing the chord sequencer is handed whole chords, not single notes
(#606, record `2026-09-17-606-chord-sequencer-degrees-per-part-voicing`): the
scale's diatonic stack for the written degree (`chordTheory.ts`), then
inverted, voiced, transposed and range-checked by `chordVoicing.ts`. Inversion
rotates with octave carry, so a high inversion lifts the whole chord; the
voicing is one per part, not per step; a voicing never sends more than
`CHORD_VOICING_NOTES_MAX` notes however much it doubles; and a note that falls
outside MIDI 0–127 is **dropped, not clamped**, since a clamped note would
double its neighbour at the wrong pitch. Design a chord patch against the
register the part's voicing actually spreads it over — a wide voicing on a low
register loses its bottom notes and its voice count with them, and a patch
that only sounds right in one octave will not hold across a progression.

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
share a table and any edit is heard; the old per-patch cache key retired
with patch format 2. The console draws partials
in each operator bay while its wave is User (16 / 32 / 64 bars, values 0–1);
a hand-written array may be longer or negative, and is played as written.

Bandlimited and deliberately unbandlimited “digital” waveforms are separate
choices. Choose intentional aliasing for a digital texture, not by assuming
all saw/square variants are equivalent.

Each worklet is written as a TypeScript source folder under `worklet/` and
bundled by `scripts/build-worklets.mjs` into one import-free file in
`worklet/generated/`, whose URL the engine loads (#643). The bundles are
generated: edit the source, rebuild, and commit both. The patch defaults,
enums and routing live once in `worklet/fm/` (`patchDefaults.ts`,
`modeIds.ts`, `algorithms.ts`): `patch.ts` re-exports the ids and the
algorithm table, and `makePatch()` writes the defaults; update the
parity tests beside them when changing that contract.

`makePatch` supplies defaults, and document normalization checks shapes and
finite values. Do not assume every finite numeric field is range-clamped:
inspect the actual normalizer/control/DSP path for the parameter in question.
For a new patch field, consider factory defaults, old documents, live updates,
editor controls, worklet defaults and the rebuilt worklet bundle together.
