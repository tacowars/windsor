/**
 * bloom's output (`worklet/bloom/bloomOutput.ts`): the bands summed to
 * stereo, Amount, Mix and the on/off switch, and the wet-path slot's sends
 * and split (`BLOOM_SLOT`). Spread acts here.
 */
export const BLOOM_OUTPUT = {
  /**
   * The generated layer's gain at Amount 100 %, fitted so a −12 dBFS sine at
   * 220 Hz gives E's fundamental at −3.3 dB re the input (the calibrated
   * target level).
   */
  gain: 7.957011761401484,
  /** Per-sample one-pole smoothing of Amount and Mix, seconds. */
  smoothSeconds: 0.02,
  /** A glide this close to its target lands on it. */
  snapFloor: 1e-6,
  /**
   * Spread's pan: equal power, √2·cos and √2·sin of (1 − Spread)·this, so
   * Spread 0 is 1 and 1 on both sides and Spread 1 is √2 on one side, 0 on the
   * other. Even bands (F2, G2 … from the lowest) lean left, odd ones right.
   */
  spreadAngle: Math.PI / 4,
};
