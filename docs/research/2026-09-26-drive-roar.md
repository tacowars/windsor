# Advanced drive: Roar reference and implementation brief

Status: scope settled with Pat on 2026-09-26; implementation ticket #701.
Five core routes, envelope follower plus one LFO, and the core palette are
selected. Feedback/delay and experimental additions are deferred.
The shipped semantics and audition steps are in
[the implementation notes](2026-09-26-701-drive/README.md).

## Reference and intent

Pat supplied six Roar screenshots, including Acid Distortion, Drum Break
Duster and Diode Treatment, and requested a more capable drive insert with
shapers, filters and configurable signal paths. This is an original effect
inspired by that workflow; no claim of matching Ableton's DSP or presets.

The supplied [Sound On Sound article](https://www.soundonsound.com/techniques/ableton-live-12-roar)
returned HTTP 403. The reference checked was
[Ableton's Roar manual](https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/#roar),
sections 29.33.1–29.33.5.

Roar combines up to three stages. Serial blends stage 1 with the result of
stages 1 and 2; parallel blends two independent results; multiband separates
three frequency ranges; mid/side processes centre and stereo difference
separately. Each stage has a shaper, bias, level and a resonant filter that
can precede or follow shaping. Input tone can be compensated after the
stages. Its feedback and delay routes process recirculating or delayed
audio, with compression affecting feedback. Modulation comprises two LFOs,
an input envelope follower and noise, assigned through a matrix.

The screenshots show why diode-style shaping, bias and pre-filter resonance
belong in the core. Their visible feedback amounts are zero; their sound
design does not by itself establish a need for feedback routing. Their
compressor settings are nonzero, so comparable recipes need compression,
whether integrated or supplied by the existing insert. Hidden stage and
modulation settings are unknown; the screenshots are not complete presets.

## Existing implementation

`packages/client/src/audio/inserts/driveInsert.ts` owns both schema and
runtime. Its saved fields are `kind`, `drive`, `tone` and `mix`. A fixed
native WaveShaper uses tanh, 2x oversampling, a post-shaper low-pass and
reference-level gain compensation. `driveInsert.test.ts` checks its graph,
normalisation, harmonics and output bounds. The console's `driveCard.ts`
exposes three knobs through the generic insert controls.

The insert registry, whole-list live edits and song normalisation already
support part and master inserts. Phaser and delay provide precedents for a
dedicated worklet, editor controls, editable preset banks, DSP harnesses and
song-tempo propagation. The main audio architecture document predates several
of those inserts; the implementation and worklet instructions establish the
current seams.

## Proposed core

- Global input drive, tilt tone with adjustable pivot and optional inverse
  output tone compensation, wet output trim, mix and enable.
- Single, serial, parallel, three-band and mid/side routing. Adjustable
  crossovers in multiband; blend for serial and parallel. Mid/side keeps
  independent stage levels with unity centre/difference reconstruction.
- Each stage: enable, shaper enable/type/amount/bias, level, filter
  enable/type/cutoff/resonance, peak gain where applicable, pre/post order.
- Initial shaping palette: smooth sine saturation, hard clipping,
  diode-inspired and tube-inspired curves, half/full rectification,
  triangular folding and bitcrushing. These names describe original
  algorithms, not circuit models unless a circuit is actually implemented.
- Initial filtering palette: resonant low-pass, high-pass, band-pass,
  notch and peak. Filter parameters have their own documented units; the
  reference's percentages do not establish our parameter mappings.
- An expandable editor with a route diagram, stage/band tabs, transfer curve
  and filter response. Draw curves from the same pure functions or
  coefficients that implement the sound. Time-varying algorithms must be
  labelled as such rather than represented by a misleading static curve.
- Original editable starting points: biased acid, parallel drum crunch,
  serial diode treatment, restrained low-band warmth and aggressive upper
  bands. Describe these as recipes inspired by the examples; tune against
  our bass, drum and chord patches.

## Scope decisions

1. **Resolved:** implement Single, Serial, Parallel, three-band and Mid/Side;
   defer internal feedback/delay routes. Pat selected this scope in the
   design conversation. A separate delay after the drive is useful but
   cannot substitute for selected shapers inside a feedback loop.
2. **Resolved:** include an input envelope follower and one LFO. Pat selected
   this scope in the design conversation. Provide bipolar amounts to each
   stage's shaper amount, bias and cutoff, envelope attack/release and
   sensitivity, and a free or tempo-synced LFO.
3. **Resolved:** use the core shaper/filter palette listed above. Defer
   morph, comb, resampling and dispersion filters, and experimental shapers.

Recommendation: the five core routes, envelope follower plus one LFO, and
the initial palette. Use the existing compressor after this insert for the
first recipes. If feedback is included, revisit internal compression as
part of that loop; an external compressor would not have the same effect.
MIDI sidechain is excluded by the brief. External audio sidechain is not
needed for an envelope follower driven by the insert's own input.

## Engineering proposal

Keep existing `kind: 'drive'` songs on the current native implementation.
Add the advanced effect as a distinct kind, with a clear editor name and
the old effect labelled Classic Drive. This preserves saved sound exactly
without claiming a new algorithm is a transparent migration. Both remain
available; no existing song or untracked arrangement is rewritten.

Use one stereo worklet per advanced insert, preallocating stage, filter,
crossover and smoothing state. Route changes remain parameter updates on
that node, with a short transition and explicit state policy, not mixer
graph reconstruction or a transport restart. Inactive stage settings must
survive route changes and export/import. New nested stage editing must
create independent values; the generic add-insert helper currently performs
only a shallow copy of defaults.

Oversample nonlinear processing with actual interpolation and antialias
filtering. Settle factor and filter design with spectral tests; do not
claim a quality or CPU result before measuring. DC rejection follows biased
and rectifying stages. Bit/sample reduction deliberately produces artifacts
and needs separate expectations from smooth saturation. Smooth continuous
controls; transition discrete shapers and filter orders explicitly.

Design the three-way crossover and dry reference together. Unity band
gains and bypassed stages must reconstruct a flat magnitude response, and
partial dry/wet must not introduce unintended crossover cancellation.
Possible IIR designs need phase compensation across split branches and
the wet/dry paths. The tests must establish the result rather than assume
that cascaded low/high-pass filters sum correctly. Full bypass is exact
dry; document any latency and align wet/dry accordingly.

Define all bounds, defaults and enum values once in engine tables. The
normaliser reports invalid fields and maintains ordered crossovers. Presets
write complete sound settings while preserving mix, output trim and enabled
state. The console uses the engine export surface and writes all changes
through the song document. Synced modulation uses the existing tempo registry;
tempo is not saved independently in the insert.

## Verification criteria for the implementation ticket

- Render the shipped worklet, including real synth bass, chords and drums;
  test silence, finite output, DC decay, mono/stereo inputs, bypass and mix
  endpoints at supported sample rates.
- Prove serial order and blend endpoints, parallel independence, mid/side
  encode/decode and centre preservation, multiband isolation and flat
  recombination. Include partial dry/wet frequency sweeps.
- Measure expected harmonic/asymmetry changes, filter cutoff/resonance and
  pre/post differences. Include high-frequency nonlinear alias tests.
- Exercise live drive, bias, cutoff, mode and crossover changes under
  sustained input; check transition discontinuities and stale state.
- Verify normalisation, independent instances, hidden-stage retention,
  part/master live edits, presets and exact export/import round trips.
- If modulation is chosen, verify dynamics response and free/synced rates;
  if feedback is chosen, verify recurrence, decay/gating, parameter changes
  and bounded internal state under worst-case gain/filter settings.
- Rebuild worklets and the tracked console; run the repository finish gate.
  Inspect the console controls and retain evidence for any visual criteria.
- Hand Pat exact recipe/audition steps. Automated checks cannot supply the
  listening verdict. No performance figure is claimed in this brief.
