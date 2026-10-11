/**
 * bloom's analysis bands (`worklet/bloom/bloomBands.ts`): 48 equal-tempered
 * semitones F2…E6 (A440), each a 2-pole complex Butterworth band-pass, and
 * the selection that lets a band sound only while the input's frequency is
 * inside its semitone. Fitted to the design's target response: the
 * half-bandwidth, the selection's edges and its smoothing. Low, High and
 * Focus act here.
 */
export const BLOOM_BANDS = {
  /** Bands, one per semitone from `BLOOM_LOWEST_NOTE`. */
  count: 48,
  /** Tuning: A4 in Hz and its MIDI note. Fixed in Hz at every sample rate. */
  a4Hz: 440,
  a4Note: 69,
  semitonesPerOctave: 12,
  /** Each band's −3 dB half-bandwidth: (fraction·f + hz)·Focus. */
  halfBandwidthFraction: 0.0192,
  halfBandwidthHz: 0.93,
  /** The Butterworth poles' angle off the real axis: ±π/4 for order 2 (cos = sin = √½). */
  poleAxis: Math.SQRT1_2,
  /** The instantaneous frequency's smoothing (a one-pole on z[n]·conj(z[n−1])), seconds. */
  selectSeconds: 0.004,
  /** The selection gate's fade, seconds. */
  gateSeconds: 0.002,
  /** A band whose gate is under this is skipped: silent. */
  gateFloor: 1e-6,
  /** A band whose magnitude is under this is skipped (its phase is undefined). */
  magnitudeFloor: 1e-30,
  /** Interior semitone edges sit this many cents above the quarter tones: a quarter tone belongs to the band below. */
  selectBiasCents: 1,
  /** The lowest band's lower edge and the highest band's upper edge, Hz. */
  gateLowHz: 70,
  gateHighHz: 1409,
  /**
   * The amplitude √(|z|² + eps²) and phase z/√(|z|² + eps²). 0: the phase
   * is unit and the amplitude |z|; quiet notes are darkened by the
   * synthesis's per-band one-pole instead (`BLOOM_GENERATOR` corner*),
   * whose corner reads this amplitude.
   */
  darkening: 0,
  centsPerOctave: 1200,
};
