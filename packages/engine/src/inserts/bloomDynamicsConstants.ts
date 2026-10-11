/**
 * bloom's dynamics (`worklet/bloom/bloomDynamics.ts`): one compressor shared
 * by every band, read from the peak of the band-limited input, then a
 * ceiling on each band. Fitted to the target response: the static
 * law (ratio 1.8, threshold, expander), the hold, attack and release, the
 * detector's band limit and the ceiling's level. Density acts here.
 */
import { BLOOM_OUTPUT } from './bloomOutputConstants';

/**
 * The ceiling on E's fundamental at Amount 100 %: −12.8 dB re full scale
 * (the target ceiling), written as the amplitude 10^(−12.8/20) (a literal, so no `**`
 * runs on the worklet's load: rule 6).
 */
const CEILING = 0.2290867652767773;

export const BLOOM_DYNAMICS = {
  /** The detector's linear-phase low-pass (Blackman-windowed sinc): cutoff, and taps at 48 kHz (scaled with the rate, kept odd). */
  detectorHz: 1700,
  detectorTaps: 255,
  detectorTapsRate: 48000,
  /** Blackman window terms: a0 − a1 cos u + a2 cos 2u. */
  blackman: [0.42, 0.5, 0.08] as const,
  /** The peak is the maximum of |detector| over this window, seconds. */
  holdSeconds: 0.1,
  /** The shared gain's follower, seconds; the ceiling's per-band follower uses the same. */
  attackSeconds: 0.02,
  releaseSeconds: 0.1,
  /**
   * Static law: gain (1 + (e/T)²)^(−q/2) · e²/(e² + X²), q = 1 − 1/ratio: a
   * 1.8:1 ratio. Density sets q (ratio 1/(1 − Density)); a Density within
   * float32 rounding of 1 − 1/ratio is that exactly, so the default is bit-exact.
   */
  ratio: 1.8,
  threshold: 0.001,
  expander: 0.001,
  /**
   * Density's makeup: off the default, the gain × ((1 + (P/T)²))^((q − q₀)/2),
   * so a peak of `densityPivot` (−12 dBFS, the level the output gain was
   * calibrated at) gives the same layer at every Density; quieter notes then
   * come up (Density 1) or down (Density 0) from it, and the ceiling still
   * pins the loud ones.
   */
  densityPivot: 0.25,
  /** The per-band ceiling in band units: the target level divided by the output's gain. */
  ceiling: CEILING / BLOOM_OUTPUT.gain,
  /** Keeps the ceiling's division finite at rest. */
  ceilingGuard: 1e-30,
};
