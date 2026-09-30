# Expand Tape's character and transport controls

The first Tape insert landed in Windsor PR #143. The next request was a
balance of studio usefulness and creative wear, informed by full REELS and
the local AnalogTapeModel project.

## Controls and compatibility

Keep the original Studio, Ferric and Vintage profiles and append four original
Windsor EQ/hiss profiles: 15ips Studio, Chrome, Metal and VHS. These are broad
tonal interpretations, not measured machine models or copies of the full REELS
tables. The first three profiles and the saturation curve retain their CC0
REELS Lite provenance from `2026-09-30-reels-inspired-tape-insert`.

Expose separate Wow, Flutter and Dropouts amounts, plus two motion rates.
Wow rate controls the random target refresh frequency; Flutter rate scales
the original random 2–10 Hz refresh interval relative to its default of 7.
Neither readout promises a sinusoidal pitch modulation frequency. Rate edits
rescale a running interval, and all continuous controls are smoothed.
The transport remains shared between channels, preserving stereo imaging.

Keep the legacy `wear` field and add `split`, default false. Old documents
retain the original motion arithmetic and seeded stream. The three visible
amounts initially read Wear. Editing any one materializes all three values
and switches to independent control in a single document edit. The DSP
materializes its running smoothed Wear too, avoiding a modulation reset.
This is additive with behavior-preserving defaults, so neither file format
version changes. Presets and Randomize explicitly enable independent amounts.

Seven original editable starting points cover studio polish, warm reel,
chrome shimmer, metal punch, late-night cassette, VHS memory and damaged
field tape. Presets preserve Trim, Mix, bypass and seed. Randomize preserves
Trim, Mix and bypass, and rolls a new seed. It also replaces customized motion
rates with independent uniform draws: Wow Rate 0.2–1.2 Hz and Flutter Rate
4–12 Hz. These original Windsor ranges cover the starting points' motion
rates and favor usable creative variation; they are not physical calibration
claims. Regression tests cover customized extremes, seeded replay, separate
rate draws, RNG boundaries and preservation of the input and mix controls.
All settings remain song-owned on both track and master inserts.

## Cost and audible decisions

Cache gain powers when their smoothed inputs have not changed, precompute
model hiss offsets, and skip filter banks with zero crossfade weight. A
settled model runs only its own banks. During transitions, fading banks remain
active until their weight falls below 1e-12; reactivated banks start with
cleared history. This intentionally changes the transient during live model
switches versus keeping every inaudible bank warm. It introduces no hard
output switch: the same 10 ms weight smoother fades the new bank in.

Static legacy render parity and before/after measurements are reproducible in
`docs/research/2026-09-30-tape-expansion/`. These are source-DSP measurements
in Node, not browser deadline or underrun claims. Noise generation continues
with Hiss off to preserve the seeded transport stream. There is no new
allocation inside process/configure/tick.

New controls, profiles, presets and model-switch transients require human
audition. Existing FM/reverb goldens are not regenerated. DSP tests cover all
seven profiles at bounds and 44.1/48/96 kHz, isolated motion effects, rate
changes, materializing legacy Wear, rapid model switches and silence.

## Physical modeling reference and next step

References inspected:

- [Full REELS](https://elphnt.io/store/reels/) for feature scope; no full-version
  DSP or model data was supplied.
- `../AnalogTapeModel`, commit
  `604372e4ffd9690c3e283362e4598cb43edbb475`: README/LICENSE (GPL-3.0),
  `Plugin/Source/Processors/Hysteresis/HysteresisProcessing.{h,cpp}`,
  `Loss_Effects/LossFilter.cpp`, and `Timing_Effects/{Wow,Flutter}Process.{h,cpp}`.
  This PR copies no implementation or presets from that project.
- Jatin Chowdhury's [2019 DAFx paper](https://www.dafx.de/paper-archive/2019/DAFx2019_paper_3.pdf).

CHOW's stateful magnetic hysteresis, speed/spacing/thickness/gap-dependent
loss, and periodic plus variable transport are a stronger reference for a
physical mode than adding more EQ profiles. Windsor currently has a static
saturation curve, tonal Bias, filtered random transport and linear fractional
delay interpolation. It does not yet model magnetic history or physical bias.

The next DSP increment should be an explicit opt-in physical mode so existing
saved songs retain their sound. Priorities:

1. Oversampled nonlinear processing, with measured alias rejection and
   documented latency/dry alignment. Benchmark quality settings in an actual
   AudioWorklet before choosing a default.
2. Stateful hysteresis and independent magnetic saturation/bias controls,
   with solver stability, DC, silence recovery, harmonic and level sweeps at
   every supported sample rate. Preserve GPL attribution if adapting CHOW code.
3. Playback loss tied to speed and head geometry, including a speed-dependent
   head bump. Compare response curves rather than claiming a calibrated machine.
4. Periodic motor/reel motion mixed with seeded drift, stereo correlation,
   separate dropout depth/density and a tape-stop gesture. Compare interpolation
   methods on high-frequency sweeps and pitch sidebands.

The current upgrade establishes the controls and saves CPU without silently
replacing the first insert's core sound with an unvalidated physical solver.
