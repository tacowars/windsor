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
/** The plate's output floor, as a gain's distance from its rest (record 2026-09-15). */
const SLEEP_GAIN_FLOOR = 1e-7;
/**
 * Sleep (windsor#793), the plate's pattern (record
 * `2026-09-15-silent-voices-and-plate-sleep-floors`). An input sample (the
 * program's, and the key's when it is external) within `inputFloor` of 0 is
 * silence. The compressor's output is its input times its gain, so on silence
 * all it holds is the envelope: once that has released to `reductionFloorDb`
 * (a gain within the plate's output floor, 1e-7, of its rest) and the
 * detector's highpass has settled, a silent block puts it to sleep, and a
 * woken compressor renders what one that never slept would, to that floor.
 * So its tail is its release: `tailSeconds` is the slowest (Release 1.2 s, or
 * Auto's slow envelope) from the deepest reduction (Range 60 dB) to the floor.
 */
export const COMPRESSOR_SLEEP = {
  inputFloor: 1e-9,
  reductionFloorDb: SLEEP_GAIN_FLOOR / COMPRESSOR_DSP.dbToLog,
  tailSeconds:
    Math.max(COMPRESSOR_DSP.autoSlowSeconds, COMPRESSOR_BOUNDS.release[1]) *
    Math.log((COMPRESSOR_BOUNDS.range[1] * COMPRESSOR_DSP.dbToLog) / SLEEP_GAIN_FLOOR),
} as const;
