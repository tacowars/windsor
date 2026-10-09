# A synced voice renders its operators at twice the rate

- **Date:** 2026-10-09
- **Status:** accepted (the decisions of windsor#656)
- **Links:** windsor#656 · the study, candidate AB2 + D of
  `docs/research/2026-10-09-sync-antialias-study/README.md` (windsor#652)
  · the direct shape it runs, `2026-10-09-sync-direct-shape` (windsor#655)
  · the wave tables it sizes by, `2026-10-09-wavetables-sized-to-their-harmonics`
  (windsor#650) · this build's measurements,
  `docs/research/2026-10-09-sync-antialias-build/README.md`

## Context

tacowars chose candidate AB2 + D of the study by ear on 2026-10-09, for
keeping the top end: the direct shape with its two-point polyBLEP, run
inside a voice at twice the rate, with the fine control interval for a
modulated ratio. windsor#655 built the direct shape and the interval at the
part's rate (A + D), which leaves `lead-sync-sweep` at −36.8 and −33.1 dB
of alias at MIDI 72 and 84 and its 15–20 kHz harmonics 2.5 to 4.9 dB under
the 16× reference's. This record is the other half: the rate.

## Decision

1. **Which voices run at twice the rate.** A voice whose patch has an
   operator with `sync` not `'off'`, unless the patch has an operator with
   feedback not 0 or a Noise operator (`patchOversamples`). Feedback's
   two-sample average and the noise draw would change the sound at another
   rate, so those voices stay at the part's rate on windsor#655's path.
   - The rate is chosen at the note-on and kept for the voice's life.
   - A live edit that turns sync on or off mid-note changes the sync at
     once, at the voice's rate; the rate follows from the next note-on. A
     voice at twice the rate keeps the generic passes after its sync goes
     off; it never takes the kernel.
   - A feedback lane that turns on mid-note on a voice at twice the rate
     plays there, its ramp timed in the doubled samples; so does a Noise
     operator a live edit adds, drawn once a doubled sample. That changes
     their sound against the part's rate, and is accepted.
2. **What runs at twice the rate**: the operators (their phases, amplitude
   ramps and knots, envelopes, width ramps, own filters, the resets and the
   direct shape's edges) and the carrier sum, over the voice's `opRate`.
   - The control update keeps its interval in the part's samples (32 or
     128), so it updates as often in time; the operators' ramps run over
     twice as many samples. windsor#655's fine interval holds the same way.
   - An operator's own filters are prewarped at the doubled rate, at the
     cutoff the part's rate would hold them to (0.45 of the part's rate), so
     they cut where a note at 1× cuts.
   - A corrected or direct-shape operator is sent a doubled sample late,
     half a sample at the part's rate where it was one.
3. **Decimate before the drive.** The carrier sum is decimated to the
   part's rate. The drive, the filter (the SVF, the Formant, the Acid
   ladder's chunk pass), the steal fade and the pan then run at the part's
   rate, as for any voice. The generic loop is now two passes over the
   voice's `oversample.sums`, the operators and the post stage, the same
   operations in the same order as the one loop they were, so every voice
   at the part's rate renders as before to the bit; a voice at twice the
   rate runs the first over `2n` and decimates between them.
4. **The decimator** is the drive oversampler's design, its taps shared,
   not restated: the 65-tap Blackman-windowed sinc at 0.235 of the doubled
   rate (`advancedDrive/driveOversample.ts`, `DRIVE_DSP`), its symmetric
   taps folded. Output `s` is the filter over the inputs up to the doubled
   sample at the part's instant `s`, so its delay is 16 samples at the part's
   rate exactly (0.333 ms at 48 kHz). The delay is not compensated: a voice
   at twice the rate sounds 16 samples behind the same note at 1×, an
   operator sent late 15.5. A voice is dormant or finished only once the
   decimator's line holds nothing over the dormancy floor.
5. **Tables at twice the rate.** A second wave set per operator, built at
   twice the part's rate at the patch message, never in a render, while a
   note of the patch would take it or a voice at twice the rate is sounding
   (`PartWaveSets`). It follows windsor#650's sizing rule at the doubled
   rate, an inverse FFT past 2 048 samples. The cache key carries the rate.
   Each table is scaled by the gain that normalised the part's own table of
   its octave, not by its own peak, so the harmonics both hold play at one
   level (the study measured up to 0.66 dB otherwise).

## Consequences

- `lead-sync-sweep` measures −54.7 dB at MIDI 72 and −53.8 dB at 84, the
  study's AB2 + D row within 0.1 dB, and its 10–20 kHz harmonics sit within
  1.3 dB of the 16× reference's. A synced Saw, Square or Pulse at MIDI 36,
  ratio 1, plays within 0.01 dB of the same note at the part's rate.
- One voice costs about twice the direct shape at the part's rate, about
  200 ns a sample against 94 on an M1 under Node; 16 voices cost the same
  per voice. The figures, the machine and the method are in the build's
  research note.
- A saw's set at 96 kHz takes about 1.4 to 1.7 ms to build and holds 240 KB,
  beside 1.0 to 1.2 ms and 184 KB at 48 kHz.
- Every factory preset but `lead-sync-sweep` and `lead-sync-detune`
  renders as before to the bit; those two rows of the golden tables change.
- A fed synced voice keeps windsor#655's figures. The study's decision 5
  table gives what a phase-modulated, squeezed or Tone-reduced synced
  operator gains at twice the rate: about 7 dB.
