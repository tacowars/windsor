/**
 * Density's loudness match (RV-3), Windsor's own measurements: each output's line-end sum's
 * energy, in taps (E), at nodes of Tone, Size and Decay. The tank scales each channel by
 * 1 / sqrt(1 + Σ (d × weight)² / E), so ends and taps together keep the level of the ends alone,
 * and reads E between the nodes trilinearly in the logs of the three, on 1 / E
 * (`worklet/retro/retroDensityLevel.ts`).
 *
 * Why it moves: a tap reads its line before the line's Tone lowpass and the end after it, so the
 * darker the Tone, the more of the input's top a tap keeps over the end beside it, and the smaller
 * E. At a short Decay, where one pass is most of the response, the four ends are unrelated echoes;
 * over many passes the feedback lines the left sum's signs up (a larger E) and sets the right's
 * against one another, most at a small Size and a dark Tone, where the tail is low notes that the
 * lines carry in step. Diffusion moves the match by under 0.2 dB, so it is not an axis.
 *
 * How it was measured (`docs/research/2026-10-10-retro-reverb-extensions/rv3-density-level.mjs`
 * on `c97b098`'s bundle, rv3.md): an impulse and three pooled 100 ms white-noise bursts, Mix 1,
 * Character 0, Diffusion 0.7, Density 0 and 1. Each node keeps the earlier fixed values (5.2 left,
 * 3.3 right) unless they leave a probe more than 0.7 dB off Density 0, and then moves just far
 * enough, so the auditioned settings (Size 0.5 to 3, Decay 1.4 and 2 s at Tone 4200) keep their
 * level within 0.2 dB. Rows are Size, columns Decay, one block per Tone.
 */
export const RETRO_REVERB_DENSITY_LEVEL = {
  tone: [800, 1500, 2500, 4200, 9000],
  size: [0.25, 0.5, 1, 3, 10],
  decay: [0.2, 0.5, 1.4, 2, 6, 20],
  left: [
    // Tone 800
    [
      [5.07, 5.2, 5.27, 5.53, 7.04, 11.06],
      [3.71, 4.95, 5.2, 5.2, 5.2, 5.68],
      [2.99, 3.73, 5.06, 5.2, 5.2, 5.2],
      [2.82, 2.91, 3.61, 4.01, 5.2, 5.2],
      [2.85, 2.85, 2.89, 2.98, 3.81, 5.16],
    ],
    // Tone 1500
    [
      [5.16, 5.2, 5.2, 5.2, 5.24, 7.06],
      [3.77, 4.9, 5.2, 5.2, 5.2, 5.2],
      [3.31, 4.08, 5.2, 5.2, 5.2, 5.4],
      [3.13, 3.22, 3.96, 4.37, 5.2, 5.2],
      [3.16, 3.16, 3.21, 3.31, 4.2, 5.2],
    ],
    // Tone 2500
    [
      [5.2, 5.2, 5.2, 5.2, 5.2, 5.64],
      [3.97, 5.09, 5.2, 5.2, 5.2, 5.2],
      [3.7, 4.51, 5.2, 5.2, 5.2, 5.53],
      [3.5, 3.6, 4.37, 4.79, 5.2, 5.2],
      [3.51, 3.51, 3.57, 3.68, 4.64, 5.2],
    ],
    // Tone 4200
    [
      [5.2, 5.2, 5.2, 5.2, 5.2, 5.2],
      [4.38, 5.2, 5.2, 5.2, 5.2, 5.2],
      [4.15, 5.01, 5.2, 5.2, 5.2, 5.45],
      [3.94, 4.05, 4.89, 5.2, 5.2, 5.2],
      [3.97, 3.97, 4.04, 4.16, 5.2, 5.2],
    ],
    // Tone 9000
    [
      [5.2, 5.2, 5.2, 5.2, 5.2, 5.2],
      [5.0, 5.2, 5.2, 5.2, 5.2, 5.2],
      [4.7, 5.2, 5.2, 5.2, 5.2, 5.32],
      [4.47, 4.6, 5.2, 5.2, 5.2, 5.2],
      [4.58, 4.58, 4.67, 4.82, 5.2, 5.2],
    ],
  ],
  right: [
    // Tone 800
    [
      [2.51, 2.56, 2.74, 2.85, 3.3, 3.48],
      [2.97, 3.03, 3.23, 3.3, 3.3, 3.3],
      [2.89, 2.9, 3.08, 3.19, 3.3, 3.3],
      [2.83, 2.83, 2.87, 2.91, 3.14, 3.3],
      [2.86, 2.86, 2.87, 2.88, 2.96, 3.16],
    ],
    // Tone 1500
    [
      [2.99, 3.07, 3.16, 3.2, 3.3, 3.3],
      [3.27, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.09, 3.08, 3.2, 3.29, 3.3, 3.3],
      [3.13, 3.12, 3.16, 3.19, 3.3, 3.3],
      [3.19, 3.19, 3.2, 3.21, 3.23, 3.3],
    ],
    // Tone 2500
    [
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
    ],
    // Tone 4200
    [
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
    ],
    // Tone 9000
    [
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.32, 3.32, 3.3, 3.3, 3.3, 3.3],
    ],
  ],
};
