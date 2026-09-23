/** Compressor controls and DSP tunables, shared by the worklet and editor (#660). */
export const COMPRESSOR_NAME = 'a204-compressor';
export const COMPRESSOR_ATTACKS = [0.01, 0.1, 0.3, 1, 3, 10, 30] as const;
/** Zero means dual-time Auto release. Other entries are seconds. */
export const COMPRESSOR_RELEASES = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1.2] as const;
export const COMPRESSOR_RATIOS = [2, 4, 10] as const;
export const COMPRESSOR_BOUNDS = {
  threshold: [-40, 0],
  makeup: [0, 24],
  attack: [0.01, 30],
  ratio: [2, 10],
  release: [0, 1.2],
  highpass: [0, 1000],
  range: [0, 60],
  mix: [0, 1],
} as const;
export const COMPRESSOR_DEFAULTS = {
  threshold: -12,
  makeup: 0,
  attack: 10,
  ratio: 4,
  release: 0,
  highpass: 0,
  range: 60,
  mix: 1,
  enabled: true,
} as const;
export const COMPRESSOR_DSP = {
  dbToLog: Math.LN10 / 20,
  msToSeconds: 0.001,
  floor: 1e-12,
  kneeDb: 6,
  quadraticFactor: 4,
  smoothSeconds: 0.005,
  autoFastSeconds: 0.1,
  autoSlowSeconds: 1.2,
  autoChargeSeconds: 0.3,
  meterHz: 30,
  meterCeilingDb: 24,
} as const;
