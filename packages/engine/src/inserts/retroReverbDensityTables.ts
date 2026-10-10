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

/**
 * Density's loudness match for Low decay's low band (RV-5), Windsor's own measurements: the E
 * above, for the part of the output below Low cross, at nodes of Tone, Size and the low band's
 * own decay, Decay × Low decay (0.05 to 80 s). `worklet/retro/retroLowBand.ts` reads it as the
 * tank reads the table above.
 *
 * Why the low band has a table of its own: the band decays like today's tank at Decay × Low decay,
 * but it holds only the low notes, which the lines carry more nearly in step than the whole
 * signal, so the table above, read at the band's decay (held at its edges outside 0.2 to 20 s),
 * left an impulse at Density 1 up to 2.8 dB off Density 0 (Size 0.25, Tone 800, Decay 20 s, Low
 * decay 4, Low cross 80 Hz), most at a small Size and a dark Tone.
 *
 * How it was measured (`docs/research/2026-10-10-retro-reverb-extensions/rv5-density-level.mjs`,
 * rv5.md): each node at Low cross 300 Hz, with Low decay 4 and Decay D / 4 for a band decay D of
 * 0.8 s and over, else Low decay 0.25 and Decay 4D, and the probes, Mix, Character and Diffusion
 * of the table above, rendered for 3 s plus three quarters of D (60 s at most): over a long decay
 * the ends line up pass by pass, so a 6 s window read the whole tail 0.8 dB off (Size 0.25, Tone
 * 800, a band decay of 80 s). Each node starts from the table above at (Tone, Size, D) (its edge
 * outside 0.2 to 20 s) and keeps it unless a probe reads more than 0.7 dB off Density 0, then moves
 * just far enough, by bisection on the rendered level. Rows are Size, columns the band's decay, one block per Tone.
 */
export const RETRO_REVERB_DENSITY_LOW_LEVEL = {
  tone: [800, 1500, 2500, 4200, 9000],
  size: [0.25, 0.5, 1, 3, 10],
  decay: [0.05, 0.2, 0.5, 1.4, 2, 6, 20, 80],
  left: [
    // Tone 800
    [
      [1.95, 5.07, 5.2, 6.58, 7.1, 9.37, 12.83, 11.06],
      [2.04, 2.91, 4.95, 5.2, 5.2, 5.2, 6.17, 10.26],
      [2.65, 2.02, 2.94, 5.06, 5.2, 5.2, 5.2, 5.45],
      [2.82, 2.48, 2.2, 3.61, 4.01, 5.2, 5.2, 5.2],
      [2.85, 2.82, 2.79, 2.89, 2.98, 3.81, 5.16, 5.16],
    ],
    // Tone 1500
    [
      [1.84, 5.16, 5.2, 5.2, 5.2, 6.25, 9.17, 13.22],
      [1.95, 2.91, 4.9, 5.2, 5.2, 5.2, 5.2, 6.84],
      [2.95, 2.47, 4.04, 5.2, 5.2, 5.2, 5.4, 5.46],
      [3.13, 2.71, 2.45, 3.96, 4.37, 5.2, 5.2, 5.2],
      [3.16, 3.12, 3.1, 3.21, 3.31, 4.2, 5.2, 5.2],
    ],
    // Tone 2500
    [
      [2.42, 5.2, 5.2, 5.2, 5.2, 5.38, 7.18, 10.65],
      [2.08, 3.68, 5.09, 5.2, 5.2, 5.2, 5.2, 5.63],
      [3.35, 3.56, 4.51, 5.2, 5.2, 5.2, 5.53, 5.63],
      [3.49, 3.02, 2.9, 4.37, 4.79, 5.2, 5.2, 5.2],
      [3.51, 3.43, 3.46, 3.57, 3.68, 4.64, 5.2, 5.2],
    ],
    // Tone 4200
    [
      [5.2, 5.2, 5.2, 5.2, 5.2, 5.2, 6.33, 8.35],
      [2.41, 4.38, 5.2, 5.2, 5.2, 5.2, 5.2, 5.27],
      [3.8, 4.15, 5.01, 5.2, 5.2, 5.2, 5.45, 5.76],
      [3.92, 3.4, 4.05, 4.89, 5.2, 5.2, 5.2, 5.2],
      [3.97, 3.82, 3.96, 4.02, 4.16, 5.2, 5.2, 5.2],
    ],
    // Tone 9000
    [
      [5.2, 5.2, 5.2, 5.2, 5.2, 5.2, 5.93, 6.9],
      [3, 5, 5.2, 5.2, 5.2, 5.2, 5.2, 5.2],
      [4.32, 4.7, 5.2, 5.2, 5.2, 5.2, 5.32, 5.81],
      [4.47, 4.47, 4.6, 5.2, 5.2, 5.2, 5.2, 5.2],
      [4.58, 4.35, 4.58, 4.62, 4.79, 5.2, 5.2, 5.2],
    ],
  ],
  right: [
    // Tone 800
    [
      [2.51, 2.43, 2.23, 2.74, 2.85, 3.3, 3.75, 9.55],
      [2.9, 2.79, 2.83, 3.23, 3.3, 3.3, 3.3, 3.3],
      [2.88, 2.56, 2.37, 3.08, 3.19, 3.3, 3.3, 3.3],
      [2.83, 2.8, 2.73, 2.87, 2.91, 3.14, 3.3, 3.3],
      [2.86, 2.85, 2.85, 2.86, 2.87, 2.96, 3.16, 3.16],
    ],
    // Tone 1500
    [
      [2.99, 2.99, 3.07, 3.16, 3.2, 3.3, 3.3, 4.34],
      [3.18, 3.08, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.09, 2.69, 2.45, 3.2, 3.29, 3.3, 3.3, 3.3],
      [3.13, 3.1, 3.03, 3.14, 3.19, 3.3, 3.3, 3.3],
      [3.19, 3.18, 3.17, 3.19, 3.2, 3.23, 3.3, 3.3],
    ],
    // Tone 2500
    [
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.29, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
    ],
    // Tone 4200
    [
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
    ],
    // Tone 9000
    [
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3],
      [3.35, 3.33, 3.32, 3.33, 3.31, 3.3, 3.3, 3.3],
    ],
  ],
};
