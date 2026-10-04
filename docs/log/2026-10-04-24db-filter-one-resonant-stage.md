# The 24 dB filter has one resonant stage

- **Date:** 2026-10-04
- **Status:** accepted (windsor#595)
- **Links:** the SVF section, `packages/engine/src/worklet/fm/svf.ts` ·
  its tuning, `updateVoiceFilter` in `worklet/fm/voiceControl.ts` · the
  constant, `SVF24_SECOND_STAGE_Q` in `worklet/fm/fmConstants.ts` · the
  test, `synth/fmProcessorFilterSlope24.test.ts` · the format rule,
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

The voice filter's 24 dB mode (Lowpass, Highpass, Bandpass and Notch with
`slope24`) is two identical TPT state-variable sections in series. Until
this change both sections took the patch's Reso as their Q. One section's
gain at the cutoff is about Q, so the pair's was about Q², and the
resonant peak's boost in dB doubled: about +43 dB at Reso 12
(20 log10 144), against about +21.6 dB for the 12 dB mode at the same
Reso. A 24 dB part at high Reso ran so much hotter than its 12 dB
counterpart that tacowars had to pull the part's volume under 0.10 to use
it. The doubling was never chosen: it fell out of reusing the Reso for the
second section.

## Options tried

tacowars compared two fixes in local builds on 2026-10-04.

- **A: the second section at a fixed Q of 1/√2.** The first section keeps
  the Reso as its Q; the second is a Butterworth section that follows the
  cutoff. At high Reso the pair peaks at about Reso / √2, about 3 dB under
  the 12 dB mode's peak, and the slope stays 24 dB an octave. Every 24 dB
  patch changes, including at low Reso (below).
- **B: √Reso a section above Reso 1.** Both sections take √Reso as their
  Q once the Reso passes 1, and the Reso itself below that. The pair
  peaks at about Reso, level with the 12 dB mode, and every patch at
  Reso ≤ 1 renders bit-identically.

On the first listen tacowars heard no difference between them. On a
second listen A's gain was clearly more moderated, and A was the one.

## Decisions

1. **One resonant section (option A).** In the 24 dB mode the first
   section (`svfA`) takes the Reso as its Q, as before. The second
   (`svfB`) takes `SVF24_SECOND_STAGE_Q`, 1/√2, a tunable in
   `fmConstants.ts`. The choice is tacowars's ear: A's peak sits a few dB
   under the 12 dB mode's, which is what made it sound moderated where B
   sounded level.
2. **The second section still follows the cutoff.** Its coefficients are
   worked out per control block, as before; the per-sample path is
   unchanged.
3. **Only the 24 dB LP/HP/BP/Notch path changes.** The 12 dB mode, the
   Formant mode (which also uses `svfB`, with its own Q) and the Acid mode
   render bit for bit as before; the golden tables show it, with rows
   moving only for library patches with `slope24: true`.
4. **Every 24 dB patch sounds slightly different, and none is retuned.**
   At the library's usual Reso of 0.8–0.85 the second section's gain at
   the cutoff goes from about 0.85 to 0.71, about 1.6 dB darker right at
   the cutoff. No patch is retuned to compensate; tacowars judges that on
   the preview.
5. **No format bump.** This corrects an unintended gain; it does not
   change what a field means. `PATCH_FILE_FORMAT` and
   `ARRANGEMENT_VERSION` do not move. Saved songs and patches at 24 dB play
   with the new response, and, following the move-fast direction, no
   upgrade is provided to reproduce the old one.

## Consequences

- At Reso 4 and 12 the 24 dB lowpass peaks within 1 dB of Reso / √2, and
  well above the cutoff it falls at about 24 dB an octave; both are pinned
  by `fmProcessorFilterSlope24.test.ts`, which also sweeps a live Reso from
  0.5 to 12 and checks the output stays finite.
- The cost is the same as before and would have been the same under
  either option: the change is which Q the second section's control-rate
  coefficients are worked from, and the per-sample path does not change.
- A 24 dB part at high Reso no longer needs its volume pulled far down to
  sit beside a 12 dB part.
