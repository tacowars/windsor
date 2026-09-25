/** Song controls and original DSP tuning for the stereo/dub delay. Times are milliseconds. */
export const DELAY_NAME = 'dub-delay';
export const DELAY_MODES = ['stereo', 'ping-pong', 'mid-side'] as const;
export const DELAY_MODE_IDS = { stereo: 0, 'ping-pong': 1, 'mid-side': 2 } as const;
export const DELAY_DIVISIONS = {
  '1/32': 0.125,
  '1/32T': 1 / 12,
  '1/32D': 0.1875,
  '1/16': 0.25,
  '1/16T': 1 / 6,
  '1/16D': 0.375,
  '1/8': 0.5,
  '1/8T': 1 / 3,
  '1/8D': 0.75,
  '1/4': 1,
  '1/4T': 2 / 3,
  '1/4D': 1.5,
  '1/2': 2,
  '1/2T': 4 / 3,
  '1/2D': 3,
  '1/1': 4,
} as const;
export const DELAY_BOUNDS = {
  leftMs: [1, 8000],
  rightMs: [1, 8000],
  feedback: [0, 1.2],
  highpass: [20, 4000],
  lowpass: [200, 20000],
  drive: [0, 24],
  mix: [0, 1],
  outputDb: [-24, 12],
} as const;
export const DELAY_DEFAULTS = {
  leftMs: 375,
  rightMs: 500,
  feedback: 0.45,
  highpass: 80,
  lowpass: 12000,
  drive: 0,
  mix: 0.3,
  outputDb: 0,
  enabled: true,
};
export const DELAY_DSP = {
  defaultBpm: 120,
  filterStates: 8,
  polesPerChannel: 4,
  dbBase: 10,
  // Four beats at 20 BPM. Slower imported sync times clamp; free mode has its own bound.
  maxSeconds: 12,
  secondsPerMinute: 60,
  milliseconds: 1000,
  smoothSeconds: 0.03,
  timeSmoothSeconds: 0.06,
  dbDivisor: 20,
  feedbackCeiling: 2,
  cutoffRateRatio: 0.45,
} as const;
