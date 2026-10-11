/**
 * bloom's generator (`worklet/bloom/bloomGenerator.ts`, `bloomSynth.ts`,
 * `bloomTables.ts`, `bloomTone.ts`): each sounding band plays a band-limited
 * waveform at its phase, darkened by a one-pole whose corner follows the
 * band's level, and the layer is rolled off by a fixed pole. By design: the
 * sawtooth runs to an internal 24 kHz Nyquist, the fixed pole sits at
 * 10.7 kHz, the darkening is a one-pole in Hz per band.
 * Shape, Bright, Octave and Scale act here; Octave's ratios are this
 * file's. Scale's pitch classes come from the main thread as one pitch set
 * (`bloomPitches.ts`), so no scale is listed here.
 */
export const BLOOM_GENERATOR = {
  /** No partial is generated above this, Hz, nor above `nyquistShare` of the rate (at the band's centre × its ratio). */
  harmonicLimitHz: 24000,
  nyquistShare: 0.45,
  /** The layer's fixed roll-off: one pole, amplitude 1/|1 + j·f/rolloffHz|. */
  rolloffHz: 10700,
  /**
   * The darkening: each band through a one-pole
   * low-pass 1/|1 + j·f/fp|, normalised to 1 at the band's fundamental f₁,
   * fp = min(cornerMaxHz, √(F² + (cornerNoteShare·f₁)²)),
   * F = cornerScaleHz·√(L·(L + cornerKnee))·(1 + (L/cornerSwell)²), L the
   * band's amplitude after the shared gain, before the ceiling (band units: a
   * sine of amplitude A on a band's centre gives |z| = A). 0.23 dB rms against
   * the target curve. Also at most `cornerShare` of the rate.
   */
  cornerScaleHz: 293000,
  cornerKnee: 0.001524,
  cornerSwell: 0.02876,
  cornerNoteShare: 1.243,
  cornerMaxHz: 21600,
  cornerShare: 0.45,
  /**
   * A sounding band's darkening is recomputed only when its corner has moved
   * by more than this share since it was last set (or the band starts), so a
   * steady band costs only the corner's own arithmetic. The filter and the
   * phase lead stay each other's, so the fundamental is still exact.
   */
  cornerTolerance: 0.005,
  /** The darkening corner at −12 dBFS, where Shape and Bright keep the saw's power. */
  levelCornerHz: 10200,
  /**
   * The tables (`bloomTables.ts`): every partial count up to
   * `tableExactLevels`, then counts `tableLevelStep` apart (a band takes the
   * largest at or under its own, so it loses at most the top 9 % of its
   * partials, the faintest); each table holds at least `tableOversample`
   * points a cycle of its top partial, and at least `tableMinSize`.
   */
  tableExactLevels: 16,
  tableLevelStep: 1.1,
  tableOversample: 8,
  tableMinSize: 64,
  /**
   * The summed layer's fixed filter (`bloomTone.ts`): a linear-phase FIR,
   * `toneHalfTaps` a side at 48 kHz (scaled with the rate), fitted to the
   * roll-off and to undo the bands' digital poles near Nyquist; the
   * darkening corner its correction is learnt at.
   */
  toneHalfTaps: 6,
  toneTapsRate: 48000,
  toneReferenceHz: 1000,
  /**
   * Bright's tilt on the summed layer (`bloomTone.ts`): first-order shelves
   * every `tiltSpacing` octaves from `tiltLowHz` up to `nyquistShare` of the
   * rate, unity at `tiltPivotHz`; each band then takes (pivot / its
   * fundamental)^β, so every band's partial k moves by exactly k^β.
   */
  tiltLowHz: 8,
  tiltSpacing: 0.5,
  tiltPivotHz: 1000,
  /**
   * The most semitones a pitch set can move a band: a set of one pitch
   * class moves the class opposite it by 6 (down, on the tie). The pitch
   * tables are sized by it, so every set reads inside them.
   */
  pitchReach: 6,
  /** Octave, Key and Scale retune behind a dip: the layer fades out over this, retunes, fades back in. Seconds each way. */
  switchSeconds: 0.005,
  /**
   * Shape 4's pulse width (Shape 3 is the square, ½): the difference of two
   * saws `width` of a cycle apart. At 0.1 its first spectral null is k = 10.
   */
  pulseNarrowest: 0.1,
  /** Bright: dB to log2 of amplitude, log2(10)/20. */
  log2PerDecibel: 0.16609640474436813,
  /**
   * A fractional ratio's phasor: tan(ε/2) of the input's per-sample turn off
   * the band's centre past which the turn is a phase jump (an amplitude null
   * of two notes beating), not a frequency, and the phasor steps at the
   * centre's rate instead. 0.05 is ε ≈ 0.1 rad a sample (760 Hz at 48 kHz),
   * far outside any band's width.
   */
  deviationGuard: 0.05,
  /**
   * Series terms for atan (|x| ≤ `deviationGuard`: error under x^13/13,
   * 1e-18) and for sin/cos of R·ε (|R·ε| ≤ 0.43 at the original scales'
   * ratios: under 1e-16; ≤ 0.54 at any pitch set's, R up to 4·2^(5/12):
   * under 2e-15, far below a float's step); the pulse's sin/cos of πw
   * (≤ π/2) take `pulseTerms`.
   */
  atanTerms: 6,
  rotationTerms: 7,
  pulseTerms: 11,
};

/**
 * Octave's ratios as [numerator, denominator], in `BLOOM_OCTAVES` order
 * (−12, 0, +7, +12, +19, +24 semitones). Just: the fifth is 3/2 (+1.96 cents
 * on equal temperament) so +19 is exactly ×3 and its partials land on the
 * source's own harmonics. Denominators are 1 or 2 only (the generator takes a
 * half angle at most).
 */
export const BLOOM_OCTAVE_RATIOS: readonly (readonly [number, number])[] = [
  [1, 2],
  [1, 1],
  [3, 2],
  [2, 1],
  [3, 1],
  [4, 1],
];
